import { reviewAttachment } from "./handler.mjs";

// The unguessable review token is the credential; this endpoint needs no login JWT.
Deno.serve(request => reviewAttachment(request, Deno.env.toObject()));
