import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("./commerce-module-loader.mjs", import.meta.url);
const { createCustomerAccountGateway } = await import("../backend/api/http/customer-account.ts");

const origin = "https://store.example.test";
const session = "a".repeat(64);
const state = "b".repeat(64);
const runtime = { APP_SURFACE: "web", MIOVA_RUNTIME: "node", ACCOUNT_API_URL: "http://127.0.0.1:3002", MIOVA_MAINTENANCE: "false" };
function request(path = "me", { method = "POST", body = {}, raw, site = origin, requestOrigin = site, headers = {} } = {}) {
  const values = new Headers(headers);
  if (requestOrigin !== false && method === "POST") values.set("origin", requestOrigin);
  if (!["GET", "HEAD"].includes(method) && !values.has("content-type")) values.set("content-type", "application/json");
  return new Request(`${site}/api/account/${path}`, { method, headers: values, ...(!["GET", "HEAD"].includes(method) ? { body: raw ?? JSON.stringify(body) } : {}) });
}
function rig(overrides = {}, response = () => Response.json({ success: true, data: { id: "123", nickname: "Fixture" } })) {
  const calls = [];
  const handle = createCustomerAccountGateway({ ...runtime, ...overrides }, async (url, options) => {
    calls.push({ url: new URL(url), ...options, headers: new Headers(options.headers) });
    return response(calls.at(-1));
  });
  return { handle, calls };
}
function cookies(response) { return response.headers.getSetCookie(); }
function jsonWithCookies(payload, values, status = 200) {
  const headers = new Headers(); for (const value of values) headers.append("set-cookie", value);
  return Response.json(payload, { status, headers });
}

test("public capabilities preserve the boolean password flag without exposing provider credentials", async () => {
  const fixture = rig({}, () => Response.json({ success: true, data: { email: false, sms: false, google: false, apple: false, password: true,
    avatar: false, smtpPassword: "never-public", host: "private-db.example.test", codes: { email: "not_configured", sms: "not_configured", secret: "never-public" } } }));
  const response = await fixture.handle(request("config", { method: "GET" }), "config");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { email: false, sms: false, google: false, apple: false, password: true, avatar: false, codes: { email: "not_configured", sms: "not_configured" } });
  const invalid = rig({}, () => Response.json({ success: true, data: { password: "plaintext-is-not-a-capability" } }));
  assert.equal((await invalid.handle(request("config", { method: "GET" }), "config")).status, 502);
});

test("customer gateway requires explicit Node Web configuration before any transport", async () => {
  for (const override of [{ APP_SURFACE: "admin" }, { APP_SURFACE: "" }, { MIOVA_RUNTIME: "worker" }, { MIOVA_RUNTIME: undefined }, { ACCOUNT_API_URL: "" }]) {
    const fixture = rig(override); const response = await fixture.handle(request(), "me");
    assert.equal(response.status, 503); assert.equal((await response.json()).code, "account_not_configured"); assert.equal(fixture.calls.length, 0);
  }
});

test("upstream address is a fixed plain loopback origin, never arbitrary HTTPS, a credential URL or a path", async () => {
  for (const address of ["https://accounts.example.test", "http://localhost:3002", "http://0.0.0.0:3002", "http://127.0.0.2:3002", "http://169.254.169.254/", "https://127.0.0.1:3002", "http://user:secret@127.0.0.1:3002", "http://127.0.0.1:3002/path", "http://127.0.0.1:3002/?redirect=x", "http://127.0.0.1:3002/#fragment", "file:///etc/passwd"]) {
    const fixture = rig({ ACCOUNT_API_URL: address }); const response = await fixture.handle(request(), "me");
    assert.equal(response.status, 503, address); assert.equal(fixture.calls.length, 0);
  }
  for (const address of ["http://127.0.0.1:3002/", "http://[::1]:3002/"]) {
    const fixture = rig({ ACCOUNT_API_URL: address }); assert.equal((await fixture.handle(request(), "me")).status, 200);
    assert.equal(fixture.calls[0].url.origin, new URL(address).origin); assert.equal(fixture.calls[0].url.pathname, "/api/account/me");
  }
});

test("deployment maintenance fails closed without contacting the account service", async () => {
  const fixture = rig({ MIOVA_MAINTENANCE: "true" });
  for (const [method, path] of [["POST", "me"], ["POST", "nickname"], ["GET", "config"]]) {
    const response = await fixture.handle(request(path, { method }), path);
    assert.equal(response.status, 503); assert.equal((await response.json()).code, "maintenance");
  }
  assert.equal(fixture.calls.length, 0);
});

test("nonloopback browser requests require HTTPS while local developer HTTP works", async () => {
  const fixture = rig(); const response = await fixture.handle(request("me", { site: "http://store.example.test" }), "me");
  assert.equal(response.status, 403); assert.equal((await response.json()).code, "https_required"); assert.equal(fixture.calls.length, 0);
  for (const site of ["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"]) {
    const local = rig(); assert.equal((await local.handle(request("me", { site }), "me")).status, 200);
  }
});

test("method and literal route allowlists reject traversal, private birth data and unknown endpoints", async () => {
  const fixture = rig();
  for (const path of ["", "/me", "../me", "google/../me", "me/", "me?token=x", "me#x", "%2e%2e/me", "avatar/files/../../secret", "profile/birth/save", "profile/birth/get", "admin/users", "uploads/test.webp"]) {
    assert.equal((await fixture.handle(request(), path)).status, 404, path);
  }
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS", "HEAD"]) assert.equal((await fixture.handle(request("me", { method }), "me")).status, 404, method);
  assert.equal((await fixture.handle(request("google/callback"), "google/callback")).status, 404);
  assert.equal((await fixture.handle(request("config"), "config")).status, 404);
  assert.equal(fixture.calls.length, 0);
});

test("ordinary POSTs reject foreign, null and missing origins plus cross-site fetch metadata", async () => {
  for (const requestOrigin of ["https://attacker.example", "null", false, "http://store.example.test"]) {
    const fixture = rig(); const response = await fixture.handle(request("nickname", { requestOrigin }), "nickname");
    assert.equal(response.status, 403); assert.equal((await response.json()).code, "origin_rejected"); assert.equal(fixture.calls.length, 0);
  }
  const fixture = rig(); assert.equal((await fixture.handle(request("me", { headers: { "sec-fetch-site": "cross-site" } }), "me")).status, 403);
  assert.equal(fixture.calls.length, 0);
});

test("browser identity is exclusively the renamed HttpOnly session cookie, never body, Bearer or admin headers", async () => {
  const fixture = rig(); const response = await fixture.handle(request("me", { body: { token: "forged", user_id: "other", userId: "other", ownerId: "store-owner", owner_id: "store-owner", platform: "app", nickname: "Kept" },
    headers: { authorization: "Bearer forged", "oai-authenticated-user-id": "forged-admin", "oai-authenticated-user-email": "admin@example.test", "x-admin-id": "forged", cookie: `token=${"c".repeat(64)}; another_cookie=private; miova_customer_session=${session}; account_oauth_state=${state}` } }), "me");
  assert.equal(response.status, 200);
  const call = fixture.calls[0];
  assert.deepEqual(JSON.parse(call.body), { nickname: "Kept", platform: "web" });
  assert.equal(call.headers.get("cookie"), `token=${session}; account_oauth_state=${state}`);
  for (const header of ["authorization", "oai-authenticated-user-id", "oai-authenticated-user-email", "x-admin-id"]) assert.equal(call.headers.get(header), null, header);
  assert.equal(call.headers.get("origin"), origin); assert.equal(call.redirect, "manual"); assert.ok(call.signal instanceof AbortSignal);
});

test("malformed or legacy token cookies are not forwarded", async () => {
  for (const value of ["bad", "a".repeat(63), "g".repeat(64), "a".repeat(65), "%61".repeat(64)]) {
    const fixture = rig(); await fixture.handle(request("me", { headers: { cookie: `miova_customer_session=${value}; account_oauth_state=bad; token=${session}` } }), "me");
    assert.equal(fixture.calls[0].headers.get("cookie"), null);
  }
});

test("forwarded IP is disabled by default and never trusts the client XFF chain", async () => {
  for (const override of [{}, { ACCOUNT_TRUST_NGINX_IP: "false" }]) {
    const fixture = rig(override); await fixture.handle(request("me", { headers: { "x-real-ip": "203.0.113.4", "x-forwarded-for": "198.51.100.1, 127.0.0.1", forwarded: "for=198.51.100.1" } }), "me");
    assert.equal(fixture.calls[0].headers.get("x-forwarded-for"), null); assert.equal(fixture.calls[0].headers.get("x-real-ip"), null); assert.equal(fixture.calls[0].headers.get("forwarded"), null);
  }
});

test("trusted Nginx IP mode forwards only a single valid overwritten X-Real-IP", async () => {
  for (const ip of ["203.0.113.4", "2001:db8::1234"]) {
    const fixture = rig({ ACCOUNT_TRUST_NGINX_IP: "true" }); await fixture.handle(request("me", { headers: { "x-real-ip": ip, "x-forwarded-for": "192.0.2.99, 127.0.0.1" } }), "me");
    assert.equal(fixture.calls[0].headers.get("x-forwarded-for"), ip); assert.equal(fixture.calls[0].headers.get("x-real-ip"), null);
  }
  for (const ip of ["203.0.113.4, 192.0.2.10", "not-an-ip", "https://203.0.113.4", "203.0.113.4:1234", "[2001:db8::1]"]) {
    const fixture = rig({ ACCOUNT_TRUST_NGINX_IP: "true" }); await fixture.handle(request("me", { headers: { "x-real-ip": ip, "x-forwarded-for": "192.0.2.99" } }), "me");
    assert.equal(fixture.calls[0].headers.get("x-forwarded-for"), null, ip);
  }
});

test("JSON browser responses remove nested bearer/OAuth/password fields but preserve captcha_token", async () => {
  const fixture = rig({}, () => Response.json({ success: true, token: session, data: { token: session, accessToken: "secret-access", refresh_token: "secret-refresh", id_token: "secret-id", passwordHash: "secret-hash", auth_version: 4,
    google_sub: "secret-sub", appleSub: "secret-sub2", client_secret: "secret-client", captcha_token: "one-time-captcha", user: { id: "123", nickname: "Kept", password: "secret-password" }, list: [{ sessionToken: "secret-session", visible: true }], error: { stack: "secret-stack" } } }));
  const response = await fixture.handle(request(), "me"); const value = await response.json();
  assert.deepEqual(value, { success: true, data: { captcha_token: "one-time-captcha", user: { id: "123", nickname: "Kept" }, list: [{ visible: true }] } });
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("session cookies are renamed, host-only, HttpOnly, secure and capped; unapproved cookies are dropped", async () => {
  const fixture = rig({}, () => jsonWithCookies({ success: true }, [`token=${session}; Domain=.example.test; Path=/untrusted; Max-Age=999999999; SameSite=None`, `account_oauth_state=${state}; Domain=attacker.test; Max-Age=99999`, "unrelated_cookie=secret; Domain=.example.test", "token=not-a-token"]));
  const response = await fixture.handle(request(), "me"); const values = cookies(response);
  assert.equal(values.length, 2);
  assert.match(values[0], new RegExp(`^miova_customer_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$`));
  assert.match(values[1], new RegExp(`^account_oauth_state=${state}; Path=/api/account; HttpOnly; SameSite=None; Max-Age=600; Secure$`));
  assert.doesNotMatch(values.join("\n"), /Domain=|unrelated_cookie/);
});

test("failed account responses cannot issue session cookies, but can clear an expired session", async () => {
  const fixture = rig({}, () => jsonWithCookies({ success: false, message: "Sign in required" }, [`token=${session}; Max-Age=1000`, "token=; Max-Age=0; Domain=example.test"], 401));
  const response = await fixture.handle(request(), "me"); assert.equal(response.status, 401);
  assert.deepEqual(cookies(response), ["miova_customer_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure"]);
  const failed = rig({}, () => jsonWithCookies({ success: false }, [`token=${session}`]));
  assert.deepEqual(cookies(await failed.handle(request(), "me")), []);
});

test("development HTTP cookie remains HttpOnly and does not incorrectly set Secure", async () => {
  const fixture = rig({}, () => jsonWithCookies({ success: true }, [`token=${session}`]));
  const response = await fixture.handle(request("me", { site: "http://localhost:5173" }), "me");
  assert.match(cookies(response)[0], /HttpOnly; SameSite=Lax/); assert.doesNotMatch(cookies(response)[0], /; Secure/);
});

test("only real Google/Apple HTTPS authorization origins are accepted and state cookies survive", async () => {
  for (const [path, location] of [["google/login", "https://accounts.google.com/o/oauth2/v2/auth?state=fixture"], ["apple/login", "https://appleid.apple.com/auth/authorize?state=fixture"]]) {
    const fixture = rig({}, () => new Response(null, { status: 302, headers: { location, "set-cookie": `account_oauth_state=${state}; Max-Age=600` } }));
    const response = await fixture.handle(request(path, { method: "GET" }), path);
    assert.equal(response.status, 303); assert.equal(response.headers.get("location"), location);
    assert.match(cookies(response)[0], /^account_oauth_state=/); assert.match(cookies(response)[0], /HttpOnly; SameSite=None; Max-Age=600; Secure/);
  }
});

test("provider authorization redirects cannot pre-issue a logged-in session", async () => {
  const fixture = rig({}, () => new Response(null, { status: 302, headers: { location: "https://accounts.google.com/o/oauth2/v2/auth", "set-cookie": `token=${session}; Max-Age=1000` } }));
  const response = await fixture.handle(request("google/login", { method: "GET" }), "google/login"); assert.equal(response.status, 303); assert.deepEqual(cookies(response), []);
});

test("malicious redirect destinations are never followed or returned to the browser", async () => {
  for (const location of ["https://attacker.test/?token=secret", "//attacker.test/path", "javascript:alert(1)", "http://accounts.google.com/auth", "https://accounts.google.com.attacker.test/auth", "https://user:secret@accounts.google.com/auth", "/account?token=secret", "/account#token=secret"]) {
    const fixture = rig({}, () => new Response(null, { status: 302, headers: { location, "set-cookie": `token=${session}` } }));
    const response = await fixture.handle(request("google/login", { method: "GET" }), "google/login");
    assert.equal(response.status, 502, location); assert.equal(response.headers.get("location"), null); assert.deepEqual(cookies(response), []); assert.equal(fixture.calls[0].redirect, "manual");
  }
});

test("Google callback forwards only approved callback fields and returns a token-free account URL", async () => {
  const fixture = rig({}, () => new Response(null, { status: 302, headers: { location: "/account", "set-cookie": `token=${session}` } }));
  const incoming = new Request(`${origin}/api/account/google/callback?code=code&state=state&scope=email&token=forged&redirect_uri=https://attacker.test`, { headers: { cookie: `account_oauth_state=${state}` } });
  const response = await fixture.handle(incoming, "google/callback");
  assert.equal(response.status, 303); assert.equal(response.headers.get("location"), `${origin}/account`); assert.match(cookies(response)[0], /^miova_customer_session=/);
  const parameters = fixture.calls[0].url.searchParams; assert.equal(parameters.get("code"), "code"); assert.equal(parameters.get("state"), "state"); assert.equal(parameters.get("scope"), "email"); assert.equal(parameters.get("token"), null); assert.equal(parameters.get("redirect_uri"), null);
  assert.equal(fixture.calls[0].headers.get("cookie"), `account_oauth_state=${state}`);
});

test("OAuth callback redirects reject token queries, fragments, cross-origin destinations and wrong pages", async () => {
  for (const location of ["/account?token=secret", "/account#secret", "https://other.example.test/account", "/checkout", "/account/", "https://accounts.google.com/auth"]) {
    const fixture = rig({}, () => new Response(null, { status: 302, headers: { location } }));
    assert.equal((await fixture.handle(request("google/callback", { method: "GET" }), "google/callback")).status, 502, location);
  }
  const huge = rig(); const input = new Request(`${origin}/api/account/google/callback?state=${"a".repeat(8193)}`);
  assert.equal((await huge.handle(input, "google/callback")).status, 400); assert.equal(huge.calls.length, 0);
});

test("Apple form-post permits its official origin, strips extra fields and retains state for backend verification", async () => {
  const fixture = rig(); const form = new URLSearchParams({ code: "code", state, id_token: "provider-id-token", user: "{}", token: "forged", redirect_uri: "https://attacker.test" });
  const input = new Request(`${origin}/api/account/apple/callback`, { method: "POST", headers: { origin: "https://appleid.apple.com", "content-type": "application/x-www-form-urlencoded", cookie: `account_oauth_state=${state}` }, body: form });
  assert.equal((await fixture.handle(input, "apple/callback")).status, 200);
  const forwarded = fixture.calls[0].body; assert.ok(forwarded instanceof URLSearchParams);
  assert.equal(forwarded.get("state"), state); assert.equal(forwarded.get("id_token"), "provider-id-token"); assert.equal(forwarded.get("token"), null); assert.equal(forwarded.get("redirect_uri"), null);
  assert.equal(fixture.calls[0].headers.get("origin"), origin);
  const evil = rig(); const rejected = new Request(`${origin}/api/account/apple/callback`, { method: "POST", headers: { origin: "https://attacker.test", "content-type": "application/x-www-form-urlencoded" }, body: form });
  assert.equal((await evil.handle(rejected, "apple/callback")).status, 403); assert.equal(evil.calls.length, 0);
});

test("invalid content types, malformed JSON, arrays and null do not reach the upstream", async () => {
  for (const [contentType, raw, status] of [["text/plain", "{}", 415], ["application/x-www-form-urlencoded", "token=x", 415], ["application/json", "{", 400], ["application/json", "[]", 400], ["application/json", "null", 400]]) {
    const fixture = rig(); const response = await fixture.handle(request("me", { raw, headers: { "content-type": contentType } }), "me");
    assert.equal(response.status, status); assert.equal(fixture.calls.length, 0);
  }
});

test("JSON requests enforce the actual 32-KiB body boundary, regardless of Content-Length claims", async () => {
  const maximum = 32768; const exact = JSON.stringify({ note: "x".repeat(maximum - 11) }); assert.equal(Buffer.byteLength(exact), maximum);
  const allowed = rig(); assert.equal((await allowed.handle(request("nickname", { raw: exact }), "nickname")).status, 200); assert.equal(allowed.calls.length, 1);
  const rejected = rig(); const response = await rejected.handle(request("nickname", { raw: `${exact} `, headers: { "content-length": "2" } }), "nickname");
  assert.equal(response.status, 413); assert.equal((await response.json()).code, "body_too_large"); assert.equal(rejected.calls.length, 0);
});

test("JSON prototype keys are not forwarded as user-controlled identity or object prototypes", async () => {
  const fixture = rig(); await fixture.handle(request("nickname", { raw: '{"__proto__":{"polluted":true},"constructor":"bad","prototype":"bad","nickname":"Safe"}' }), "nickname");
  assert.deepEqual(JSON.parse(fixture.calls[0].body), { nickname: "Safe", platform: "web" }); assert.equal({}.polluted, undefined);
});

test("avatar upload forwards one file only, not tokens or arbitrary multipart fields", async () => {
  const fixture = rig(); const form = new FormData(); form.set("avatar", new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", { type: "image/png" })); form.set("token", "forged"); form.set("user_id", "other");
  const response = await fixture.handle(new Request(`${origin}/api/account/avatar`, { method: "POST", headers: { origin, cookie: `miova_customer_session=${session}` }, body: form }), "avatar");
  assert.equal(response.status, 200); assert.ok(fixture.calls[0].body instanceof FormData); assert.deepEqual([...fixture.calls[0].body.keys()], ["avatar"]);
  assert.equal(fixture.calls[0].headers.get("content-type"), null, "fetch must assign the new multipart boundary");
  assert.equal(fixture.calls[0].headers.get("cookie"), `token=${session}`);
});

test("missing or oversized avatar files are rejected without upstream contact", async () => {
  for (const oversize of [false, true]) {
    const fixture = rig(); const form = new FormData(); if (oversize) form.set("avatar", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })); else form.set("token", "not-a-file");
    const input = new Request(`${origin}/api/account/avatar`, { method: "POST", headers: { origin }, body: form });
    const response = await fixture.handle(input, "avatar"); assert.equal(response.status, 400); assert.equal((await response.json()).code, "invalid_avatar"); assert.equal(fixture.calls.length, 0);
  }
});

test("only opaque random WebP avatar filenames can be publicly fetched", async () => {
  const header = Buffer.from("RIFF0000WEBPfixture", "ascii");
  const fixture = rig({}, () => new Response(header, { headers: { "content-type": "image/webp", "set-cookie": `token=${session}` } }));
  const path = `avatar/files/${"a".repeat(32)}.webp`; const response = await fixture.handle(request(path, { method: "GET" }), path);
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/webp"); assert.match(response.headers.get("cache-control"), /immutable/); assert.deepEqual(cookies(response), []); assert.deepEqual(Buffer.from(await response.arrayBuffer()), header);
  for (const candidate of ["avatar/files/../private.webp", `avatar/files/${"a".repeat(31)}.webp`, `avatar/files/${"g".repeat(32)}.webp`, `avatar/files/${"a".repeat(32)}.svg`, `avatar/files/${"a".repeat(32)}.webp?x=1`, "avatar/files/%2e%2e%2fsecret"]) {
    assert.equal((await fixture.handle(request("config", { method: "GET" }), candidate)).status, 404, candidate);
  }
  assert.equal(fixture.calls.length, 1);
});

test("avatar downloads require both the WebP media type and RIFF/WEBP magic", async () => {
  const path = `avatar/files/${"d".repeat(32)}.webp`;
  for (const [contentType, bytes] of [["text/html", "RIFF0000WEBPfixture"], ["image/webp", "<script>secret</script>"], ["image/png", "RIFF0000WEBPfixture"], ["image/webp", "RIFFshort"]]) {
    const fixture = rig({}, () => new Response(bytes, { headers: { "content-type": contentType } }));
    const response = await fixture.handle(request(path, { method: "GET" }), path); assert.equal(response.status, 502); assert.equal((await response.json()).code, "invalid_avatar");
  }
});

test("network failures and upstream 5xx become generic 503 responses without credentials or cookies", async () => {
  const offline = rig({}, () => { throw new Error("password=secret-host-credential"); });
  const unavailable = await offline.handle(request(), "me"); assert.equal(unavailable.status, 503); assert.doesNotMatch(await unavailable.text(), /secret-host-credential/);
  for (const status of [500, 502, 503, 504]) {
    const fixture = rig({}, () => jsonWithCookies({ success: false, message: "DB password=secret-host-credential", error: "private-stack" }, [`token=${session}`], status));
    const response = await fixture.handle(request(), "me"); assert.equal(response.status, 503); assert.deepEqual(cookies(response), []); assert.doesNotMatch(await response.text(), /secret-host-credential|private-stack/);
  }
});

test("non-JSON or invalid upstream response contracts are server errors, not invalid client requests", async () => {
  for (const [body, status] of [["<html>private upstream failure</html>", 502], ['{"data":{"id":"123"}}', 502], ['{"success":"true"}', 502], ["null", 502]]) {
    const fixture = rig({}, () => new Response(body, { headers: { "content-type": "text/html" } })); const response = await fixture.handle(request(), "me");
    assert.equal(response.status, status); assert.deepEqual(cookies(response), []); assert.doesNotMatch(await response.text(), /private upstream failure/);
  }
});
