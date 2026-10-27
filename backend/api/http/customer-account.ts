import { env } from "cloudflare:workers";
import { z } from "zod";

type Runtime = Record<string, string | undefined>;
type Transport = typeof fetch;
const cookieName = "miova_customer_session";
const stateCookie = "account_oauth_state";
const postPaths = new Set([
  "captcha/image", "captcha/image/verify", "captcha/slider", "captcha/slider/verify",
  "email/send-code", "phone/send-code", "email/login/send-code", "phone/login/send-code", "backup-email/send-code",
  "email/register", "phone/register", "login/password", "login/email/code", "login/phone/code",
  "me", "nickname", "avatar", "restrictions", "token/check", "token/refresh", "logout",
  "backup-email/bind", "backup-email/delete", "password/change", "password/reset",
  "email/bind", "phone/bind", "email/unbind", "phone/unbind", "oauth/bind", "oauth/unbind", "delete/apply",
]);
const getPaths = new Set(["config", "google/login", "google/callback", "apple/login"]);
const callbacks = new Set(["google/callback", "apple/callback"]);
const sensitiveKeys = new Set(["token", "accesstoken", "refreshtoken", "idtoken", "sessiontoken", "password", "passwordhash", "authversion", "googlesub", "applesub", "stack", "error", "clientsecret", "secret"]);
const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
function reply(message: string, status: number, code: string) { return Response.json({ success: false, message, code }, { status, headers: responseHeaders }); }
function clean(value: unknown, depth = 0): unknown {
  if (depth > 12) return null;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => clean(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitiveKeys.has(key.toLowerCase().replace(/[_-]/g, "")) && !["__proto__", "constructor", "prototype"].includes(key)).map(([key, item]) => [key, clean(item, depth + 1)]));
  return value;
}
async function readBounded(body: ReadableStream<Uint8Array> | null, max: number) {
  if (!body) return new Uint8Array();
  const reader = body.getReader(); const parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > max) throw new Error("body_too_large"); parts.push(next.value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
function allowedCookie(request: Request) {
  const parsed = new Map((request.headers.get("cookie") ?? "").split(";").map(entry => { const i = entry.indexOf("="); return [entry.slice(0, i).trim(), entry.slice(i + 1)] as const; }));
  const cookies: string[] = [];
  const session = parsed.get(cookieName); const state = parsed.get(stateCookie);
  if (session && /^[a-f0-9]{64}$/i.test(session)) cookies.push(`token=${session}`);
  if (state && /^[a-f0-9]{32,128}$/i.test(state)) cookies.push(`${stateCookie}=${state}`);
  return cookies.join("; ");
}
function copyCookies(upstream: Response, outgoing: Headers, request: Request, allowIssue: boolean, allowSession = allowIssue) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";
  const values = upstream.headers.getSetCookie();
  for (const raw of values) {
    const pair = /^([^=;]+)=([^;]*)/.exec(raw);
    if (!pair || !["token", stateCookie].includes(pair[1])) continue;
    const isSession = pair[1] === "token";
    if (pair[2] && (!allowIssue || (isSession && !allowSession))) continue;
    if (pair[2] && !(isSession ? /^[a-f0-9]{64}$/i : /^[a-f0-9]{32,128}$/i).test(pair[2])) continue;
    const age = /(?:^|;)\s*Max-Age=(-?\d+)/i.exec(raw);
    const seconds = pair[2] ? Math.min(isSession ? 2592000 : 600, age ? Math.max(0, Number(age[1])) : (isSession ? 2592000 : 600)) : 0;
    outgoing.append("Set-Cookie", `${isSession ? cookieName : stateCookie}=${pair[2]}; Path=${isSession ? "/" : "/api/account"}; HttpOnly; SameSite=${!isSession && secure ? "None" : "Lax"}; Max-Age=${seconds}${secure ? "; Secure" : ""}`);
  }
}

/** Browser-only gateway. Native clients use the independently authenticated account API. */
export function createCustomerAccountGateway(runtime: Runtime, transport: Transport = fetch) {
  return async function handle(request: Request, path: string): Promise<Response> {
    const method = request.method.toUpperCase();
    const avatar = /^avatar\/files\/[a-f0-9]{32}\.webp$/.test(path);
    if (!((method === "GET" && (getPaths.has(path) || avatar)) || (method === "POST" && (postPaths.has(path) || path === "apple/callback")))) return reply("Not found.", 404, "not_found");
    if (runtime.APP_SURFACE !== "web" || runtime.MIOVA_RUNTIME !== "node") return reply("Customer accounts are not configured on this deployment.", 503, "account_not_configured");
    if (runtime.MIOVA_MAINTENANCE === "true") return reply("Account changes are paused during deployment.", 503, "maintenance");
    let base: URL;
    try {
      base = new URL(runtime.ACCOUNT_API_URL ?? "");
      if (base.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("invalid_account_api");
    } catch { return reply("Customer accounts are not configured on this deployment.", 503, "account_not_configured"); }
    const incoming = new URL(request.url);
    if (incoming.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(incoming.hostname)) return reply("HTTPS is required.", 403, "https_required");
    const oauthCallback = callbacks.has(path);
    const origin = request.headers.get("origin");
    const appleCallback = path === "apple/callback" && method === "POST";
    if (method === "POST" && !appleCallback && (origin !== incoming.origin || request.headers.get("sec-fetch-site") === "cross-site")) return reply("Cross-site account requests are not allowed.", 403, "origin_rejected");
    if (appleCallback && origin && ![incoming.origin, "https://appleid.apple.com"].includes(origin)) return reply("Invalid sign-in callback.", 403, "origin_rejected");
    const upstreamUrl = new URL(`/api/account/${path}`, base);
    if (oauthCallback) {
      if (incoming.search.length > 8192) return reply("Invalid sign-in callback.", 400, "invalid_callback");
      for (const name of ["code", "state", "error", "error_description", "scope", "authuser", "prompt"]) { const value = incoming.searchParams.get(name); if (value) upstreamUrl.searchParams.set(name, value); }
    }
    const headers = new Headers({ Accept: avatar ? "image/webp" : "application/json" });
    headers.set("Origin", incoming.origin);
    // Enable only behind the supplied Nginx configuration, which OVERWRITES this
    // header, while both Node services remain loopback-only. Never forward XFF.
    const trustedIp = request.headers.get("x-real-ip");
    if (runtime.ACCOUNT_TRUST_NGINX_IP === "true" && trustedIp && z.string().ip().safeParse(trustedIp).success) headers.set("X-Forwarded-For", trustedIp);
    const cookie = allowedCookie(request); if (cookie) headers.set("Cookie", cookie);
    // No Authorization, forwarded IP, Basic admin identity or Sites identity is forwarded.
    let body: BodyInit | undefined;
    let contactedUpstream = false;
    try {
      if (method === "POST") {
        const contentType = request.headers.get("content-type") ?? "";
        const limit = path === "avatar" ? 5 * 1024 * 1024 + 65536 : 32768;
        const bytes = await readBounded(request.body, limit);
        if (path === "avatar") {
          if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) return reply("Use an avatar image upload.", 415, "invalid_content_type");
          const form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
          const file = form.get("avatar");
          if (!(file instanceof File) || file.size > 5 * 1024 * 1024) return reply("Use an image smaller than 5 MB.", 400, "invalid_avatar");
          const output = new FormData(); output.set("avatar", file); body = output;
        } else if (appleCallback) {
          if (!contentType.startsWith("application/x-www-form-urlencoded")) return reply("Invalid callback format.", 415, "invalid_content_type");
          const input = new URLSearchParams(new TextDecoder().decode(bytes)); const output = new URLSearchParams();
          for (const name of ["code", "state", "id_token", "error", "user"]) { const value = input.get(name); if (value) output.set(name, value); }
          body = output; headers.set("Content-Type", "application/x-www-form-urlencoded");
        } else {
          if (contentType.split(";")[0].trim().toLowerCase() !== "application/json") return reply("Use application/json.", 415, "invalid_content_type");
          const input: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (!input || typeof input !== "object" || Array.isArray(input)) return reply("Invalid request.", 400, "invalid_request");
          const fields = Object.fromEntries(Object.entries(input).filter(([key]) => !["token", "user_id", "userId", "ownerId", "owner_id", "platform", "__proto__", "constructor", "prototype"].includes(key)));
          body = JSON.stringify({ ...fields, platform: "web" }); headers.set("Content-Type", "application/json");
        }
      }
      contactedUpstream = true;
      const upstream = await transport(upstreamUrl, { method, headers, body, redirect: "manual", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
      const outgoing = new Headers(responseHeaders);
      if (upstream.status >= 500) return reply("Account service is temporarily unavailable. Please try again later.", 503, "account_unavailable");
      if (upstream.status >= 300 && upstream.status < 400) {
        const raw = upstream.headers.get("location");
        if (!raw) return reply("Sign-in provider unavailable.", 502, "invalid_redirect");
        const location = new URL(raw, incoming.origin);
        const official = path === "google/login" ? location.protocol === "https:" && location.hostname === "accounts.google.com" : path === "apple/login" ? location.protocol === "https:" && location.hostname === "appleid.apple.com" : false;
        const returned = oauthCallback && location.origin === incoming.origin && location.pathname === "/account" && !location.search && !location.hash;
        if (location.username || location.password || !(official || returned)) return reply("Invalid sign-in redirect.", 502, "invalid_redirect");
        copyCookies(upstream, outgoing, request, true, returned);
        outgoing.set("Location", location.href); return new Response(null, { status: 303, headers: outgoing });
      }
      const response = await readBounded(upstream.body, avatar ? 5 * 1024 * 1024 : 2 * 1024 * 1024);
      if (avatar && upstream.status === 200) {
        if (upstream.headers.get("content-type")?.split(";")[0] !== "image/webp" || new TextDecoder().decode(response.slice(0, 4)) !== "RIFF" || new TextDecoder().decode(response.slice(8, 12)) !== "WEBP") return reply("Avatar unavailable.", 502, "invalid_avatar");
        outgoing.set("Content-Type", "image/webp"); outgoing.set("Cache-Control", "public, max-age=86400, immutable");
        return new Response(response, { status: 200, headers: outgoing });
      }
      const parsed: unknown = JSON.parse(new TextDecoder().decode(response));
      if (!parsed || typeof parsed !== "object" || typeof (parsed as { success?: unknown }).success !== "boolean") return reply("Account service unavailable.", 502, "invalid_upstream");
      copyCookies(upstream, outgoing, request, upstream.ok && (parsed as { success: boolean }).success);
      outgoing.set("Content-Type", "application/json; charset=utf-8");
      if (path === "config" && upstream.ok && (parsed as { success: boolean }).success) {
        const config = (parsed as { data?: Record<string, unknown> }).data;
        const names = ["email", "sms", "google", "apple", "password"];
        if (!config || names.some(name => typeof config[name] !== "boolean")) return reply("Account service returned an invalid configuration.", 502, "invalid_upstream");
        // `password` here is a boolean capability, never a password value. Do not
        // apply the credential-field stripper to this explicit public contract.
        const data: Record<string, unknown> = Object.fromEntries(names.map(name => [name, config[name]]));
        if (typeof config.avatar === "boolean") data.avatar = config.avatar;
        const codes = config.codes as Record<string, unknown> | undefined;
        if (codes && typeof codes === "object") data.codes = Object.fromEntries(["email", "sms", "google", "apple"].filter(name => ["configured", "not_configured"].includes(String(codes[name]))).map(name => [name, codes[name]]));
        return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: outgoing });
      }
      return new Response(JSON.stringify(clean(parsed)), { status: upstream.status, headers: outgoing });
    } catch (error) {
      if (error instanceof Error && error.message === "body_too_large") return reply(contactedUpstream ? "Account service returned an invalid response." : "Request is too large.", contactedUpstream ? 502 : 413, contactedUpstream ? "invalid_upstream" : "body_too_large");
      if (error instanceof SyntaxError) return reply(contactedUpstream ? "Account service returned an invalid response." : "Invalid account request.", contactedUpstream ? 502 : 400, "invalid_json");
      return reply("Account service is temporarily unavailable. Please try again later.", 503, "account_unavailable");
    }
  };
}

export async function handleCustomerAccount(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return createCustomerAccountGateway(env as unknown as Runtime)(request, path.join("/"));
}
