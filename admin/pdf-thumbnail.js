import { getDocument, GlobalWorkerOptions, version } from "./pdf-engine.js";

GlobalWorkerOptions.workerSrc = new URL("./pdf-worker.js?v=" + version, import.meta.url).href;

export async function pdfThumbnail(file) {
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false, useWasm: false, enableXfa: false, disableFontFace: true,
  });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const full = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 340 / Math.max(full.width, full.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
    return canvas.toDataURL("image/jpeg", .8);
  } finally { await task.destroy(); }
}
