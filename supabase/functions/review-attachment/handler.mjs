const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function reviewAttachment(request, env, send = fetch) {
  const fail = (status, message) => Response.json({ message }, { status, headers: cors });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return fail(405, "Use POST");
  const origin = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) return fail(503, "Download unavailable");
  try {
    // Limit the actual body as well as Content-Length; chunked requests have no length.
    const reader = request.body?.getReader();
    if (!reader) return fail(400, "Invalid request");
    let bytes = new Uint8Array();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes.length + value.length > 1024) { await reader.cancel(); return fail(413, "Request too large"); }
      const next = new Uint8Array(bytes.length + value.length);
      next.set(bytes); next.set(value, bytes.length); bytes = next;
    }
    let input;
    try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return fail(400, "Invalid request"); }
    const { token, id } = input || {};
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token) || typeof id !== "string" ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) return fail(400, "Invalid request");
    const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
    const allowed = async () => {
      const result = await send(origin + "/rest/v1/rpc/qmargin_b74_review_attachment", {
        method: "POST", headers, body: JSON.stringify({ p_token: token, p_file: id }),
        signal: AbortSignal.timeout(10000), cache: "no-store", redirect: "error",
      });
      if (!result.ok) throw new Error("Authorization unavailable");
      return await result.json() === true;
    };
    if (!await allowed()) return fail(404, "Attachment unavailable");
    const file = await send(origin + "/storage/v1/object/authenticated/qmargin-b74-attachments/" + id, {
      headers, signal: AbortSignal.timeout(120000), cache: "no-store", redirect: "error",
    });
    if (!file.ok) { await file.body?.cancel(); return fail(file.status === 404 ? 404 : 503, "Attachment unavailable"); }
    // Check again in case the review expired or changed while Storage was opening.
    if (!await allowed()) { await file.body?.cancel(); return fail(404, "Attachment unavailable"); }
    return new Response(file.body, { headers: {
      ...cors, "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="attachment"',
    } });
  } catch {
    return fail(503, "Download unavailable");
  }
}
