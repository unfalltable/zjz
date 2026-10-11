import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@backend/auth";
import { HttpError } from "./json";

/** Private admin surface only; never trust an owner ID supplied by a caller. */
export async function requireStoreOperator(request?: Request): Promise<string> {
  const runtime = env as unknown as Record<string, string | undefined>;
  if (runtime.APP_SURFACE !== "admin") throw new HttpError(404, "Not found.");
  if (request && (request.headers.get("sec-fetch-site") === "cross-site" ||
    (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin))) {
    throw new HttpError(403, "Cross-site access is not allowed.");
  }
  const user = await getChatGPTUser();
  if (!user) throw new HttpError(401, "Sign in to the private administration workspace.");
  const ownerId = runtime.STORE_OWNER_ID?.trim();
  if (!ownerId || user.userId !== ownerId) throw new HttpError(403, "This account cannot manage the store.");
  if (!request && runtime.MIOVA_MAINTENANCE === "true") throw new HttpError(503, "Deployment maintenance: changes are temporarily paused.");
  return ownerId;
}
