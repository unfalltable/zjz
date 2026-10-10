import { createHash, timingSafeEqual } from "node:crypto";

const sha256Hex = /^[0-9a-f]{64}$/i;
const ownerIdentifier = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const adminEmail = /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Authenticate the private Node administration surface only. All identity is
 * configured on the server; incoming Sites identity headers are never trusted.
 * This function deliberately accepts no request-header object, so another
 * authentication mechanism cannot accidentally become a fallback.
 *
 * @param {string | null | undefined} authorization
 * @param {Record<string, string | undefined>} configuration
 * @returns {{ userId: string, displayName: string, email: string, fullName: string | null } | null}
 */
export function verifySelfhostAdmin(authorization, configuration) {
  if (configuration.APP_SURFACE !== "admin") return null;

  const username = configuration.MIOVA_ADMIN_USERNAME;
  const passwordHash = configuration.MIOVA_ADMIN_PASSWORD_SHA256;
  const userId = configuration.STORE_OWNER_ID;
  const email = configuration.MIOVA_ADMIN_EMAIL;
  if (
    !username || username.length > 256 || /[:\x00-\x1f\x7f]/.test(username) ||
    username !== username.trim() ||
    !passwordHash || !sha256Hex.test(passwordHash) ||
    !userId || !ownerIdentifier.test(userId) ||
    !email || email.length > 254 || !adminEmail.test(email)
  ) return null;

  if (!authorization || authorization.length > 4096) return null;
  const match = /^Basic[ \t]+([A-Za-z0-9+/]+={0,2})$/i.exec(authorization);
  if (!match) return null;

  const bytes = Buffer.from(match[1], "base64");
  // Buffer's base64 decoder is permissive. Reject noncanonical encodings before
  // parsing, including stray padding and truncated input.
  if (bytes.toString("base64") !== match[1]) return null;

  let credentials;
  try {
    credentials = utf8Decoder.decode(bytes);
  } catch {
    return null;
  }
  if (/[\x00-\x1f\x7f]/.test(credentials)) return null;
  const separator = credentials.indexOf(":");
  if (separator <= 0) return null;
  const suppliedUsername = credentials.slice(0, separator);
  const suppliedPassword = credentials.slice(separator + 1);
  if (!suppliedPassword || suppliedUsername.length > 256 || suppliedPassword.length > 1024) return null;

  // Compare fixed-length digests rather than leaking differing input lengths.
  const validUsername = timingSafeEqual(digest(suppliedUsername), digest(username));
  const validPassword = timingSafeEqual(digest(suppliedPassword), Buffer.from(passwordHash, "hex"));
  if (!validUsername || !validPassword) return null;

  const configuredName = configuration.MIOVA_ADMIN_DISPLAY_NAME?.trim();
  const fullName = configuredName && configuredName.length <= 160 && !/[\x00-\x1f\x7f]/.test(configuredName)
    ? configuredName : null;
  return { userId, displayName: fullName ?? "Store administrator", email, fullName };
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * A failed private login leads to the existing locked operations page. Unlike
 * Sites authentication, a standalone server has no ChatGPT callback endpoint.
 * The deployment's loopback-only proxy issues the Basic challenge.
 * @returns {string}
 */
export function selfhostSignInPath() {
  return "/ops?selfhost_auth=required";
}

/**
 * Basic credentials are scoped to the browser session and cannot be reliably
 * cleared by a redirect. The UI must describe closing that session, not promise
 * that visiting this informational path revokes credentials.
 * @returns {string}
 */
export function selfhostSignOutPath() {
  return "/ops?selfhost_auth=close-session";
}
