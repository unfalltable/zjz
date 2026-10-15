import { env } from "cloudflare:workers";
import { requireStoreOperator } from "./admin-access";
import { errorResponse, HttpError, json } from "./json";
import { MediaStorageError, saveProductImage, readProductImage } from "@backend/media-storage";
import { isManagedProductImageForOwner } from "@shared/assets";

const maxFileBytes = 10 * 1024 * 1024;
const maxBodyBytes = maxFileBytes + 64 * 1024;
const uploadAttempts = new Map<string, { count: number; since: number }>();
let activeUploads = 0;

function mediaErrorResponse(error: unknown): Response {
  if (error instanceof MediaStorageError) return json({ ok: false, code: error.code, message: error.message }, error.status);
  return errorResponse(error);
}

async function boundedMultipart(request: Request): Promise<FormData> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;\s*boundary=(?:"[A-Za-z0-9'()+_,./:=?-]{1,70}"|[A-Za-z0-9'()+_,./:=?-]{1,70})\s*$/i.test(type)) {
    throw new HttpError(415, "Use multipart/form-data with one file field.");
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBodyBytes)) throw new HttpError(413, "The upload request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Choose an image to upload.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const deadline = Date.now() + 15_000;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([reader.read(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HttpError(408, "The image upload timed out. Please try again.")), Math.max(1, deadline - Date.now()));
      })]).finally(() => clearTimeout(timer));
      if (result.done) break;
      length += result.value.byteLength;
      if (length > maxBodyBytes) throw new HttpError(413, "The upload request is too large.");
      chunks.push(result.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return await new Response(bytes, { headers: { "content-type": type } }).formData(); }
  catch { throw new HttpError(400, "The image upload form is invalid."); }
}

/** Private, authenticated upload. The caller cannot select an owner or filesystem path. */
export async function POST(request: Request): Promise<Response> {
  let acquired = false;
  try {
    const ownerId = await requireStoreOperator(request);
    const runtime = env as unknown as Record<string, string | undefined>;
    if (runtime.MIOVA_MAINTENANCE === "true") throw new HttpError(503, "Deployment maintenance: image uploads are temporarily paused.");
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new HttpError(403, "Upload images from the private administration workspace.");
    if (!runtime.MIOVA_MEDIA_PATH) throw new HttpError(503, "Product image upload is not configured for this deployment.");
    const now = Date.now();
    const attempts = uploadAttempts.get(ownerId);
    if (attempts && now - attempts.since < 60_000 && attempts.count >= 20) throw new HttpError(429, "Too many image uploads. Wait a minute and try again.");
    if (activeUploads >= 2) throw new HttpError(429, "Other images are uploading. Please try again shortly.");
    uploadAttempts.set(ownerId, attempts && now - attempts.since < 60_000 ? { ...attempts, count: attempts.count + 1 } : { since: now, count: 1 });
    if (uploadAttempts.size > 1000) for (const [owner, value] of uploadAttempts) if (now - value.since >= 60_000) uploadAttempts.delete(owner);
    activeUploads++; acquired = true;
    const form = await boundedMultipart(request);
    const entries = Array.from(form.entries());
    const file = form.get("file");
    if (entries.length !== 1 || entries[0][0] !== "file" || !file || typeof file === "string") throw new HttpError(422, "Upload exactly one image using the file field.");
    if (!file.size || file.size > maxFileBytes) throw new HttpError(413, "Each product image must be 10 MiB or smaller.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new HttpError(415, "Use a JPEG, PNG or WebP image, not SVG or an animated format.");
    const image = await saveProductImage(ownerId, new Uint8Array(await file.arrayBuffer()), file.type, runtime.MIOVA_MEDIA_PATH);
    return json({ ok: true, image }, 201);
  } catch (error) { return mediaErrorResponse(error); }
  finally { if (acquired) activeUploads--; }
}

/** Public immutable, re-encoded product bytes only. No arbitrary filesystem or remote proxy. */
export async function GET(request: Request, filename: string): Promise<Response> {
  try {
    const runtime = env as unknown as Record<string, string | undefined>;
    const ownerId = runtime.STORE_OWNER_ID?.trim();
    if (!ownerId || !(await isManagedProductImageForOwner(`/media/${filename}`, ownerId))) throw new HttpError(404, "Image not found.");
    if (!runtime.MIOVA_MEDIA_PATH) throw new HttpError(503, "Product image storage is not configured for this deployment.");
    const image = await readProductImage(ownerId, filename, runtime.MIOVA_MEDIA_PATH);
    if (!image) throw new HttpError(404, "Image not found.");
    const headers = { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
      "ETag": image.etag, "Cross-Origin-Resource-Policy": "cross-origin" };
    if (request.headers.get("if-none-match")?.split(",").map((item) => item.trim()).includes(image.etag)) return new Response(null, { status: 304, headers });
    return new Response(image.bytes as BodyInit, { headers: { ...headers, "Content-Length": String(image.bytes.byteLength) } });
  } catch (error) { return mediaErrorResponse(error); }
}
