import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createPortProbe } from "node:net";
import { existsSync, lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";

// This is a REAL production Web bundle / same-origin HTTP gateway smoke test.
// Its upstream below is an explicitly isolated, in-memory transport fixture, NOT
// the production account backend, MySQL, Redis, CAPTCHA, email, SMS or OAuth.
// Backend factories have their own mocked security/unit tests. Do not use this
// fixture as a preview login service or deploy it with a public listener.
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = mkdtempSync(path.join(tmpdir(), "miova-customer-account-wire-"));
const children = [];
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(new Error("Account gateway smoke exceeded its 120-second deadline.")), 120000);
const publicOrigin = "https://store.example.test";
// Match the existing trusted reverse proxy's external origin on a loopback socket.
const browserHeaders = { Host: "store.example.test", "X-Forwarded-Host": "store.example.test", "X-Forwarded-Proto": "https" };
const fixturePassword = randomBytes(24).toString("hex");
const fixtureChallenge = randomBytes(24).toString("hex");
const fixtureEmail = "isolated-wire-customer@example.test";
const sessions = new Set();
const upstreamRequests = [];
const avatarName = `${randomBytes(16).toString("hex")}.webp`;
let upstream;
let avatarBytes;

function json(res, status, value, cookie) {
  res.statusCode = status; res.setHeader("Content-Type", "application/json");
  if (cookie) res.setHeader("Set-Cookie", cookie);
  res.end(JSON.stringify(value));
}
function fixtureToken(req) { return /(?:^|;\s*)token=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? "")?.[1] ?? null; }
function issuedCookie(token) { return `token=${token}; Path=/unsafe; Domain=do-not-copy.example.test; Max-Age=2592000; HttpOnly`; }
async function upstreamBody(req) {
  const pieces = []; let length = 0;
  for await (const piece of req) { length += piece.length; assert.ok(length <= 6 * 1024 * 1024); pieces.push(piece); }
  return Buffer.concat(pieces);
}
async function startUpstream() {
  avatarBytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 120, b: 160 } } }).webp().toBuffer();
  const server = createHttpServer(async (req, res) => {
    try {
      const body = await upstreamBody(req);
      const payload = body.length && String(req.headers["content-type"] ?? "").startsWith("application/json") ? JSON.parse(body.toString("utf8")) : {};
      upstreamRequests.push({ method: req.method, path: req.url, headers: { ...req.headers }, payload });
      if (req.url === "/api/account/config" && req.method === "GET") return json(res, 200, { success: true, data: { email: false, sms: false, google: false, apple: false, password: true, avatar: true } });
      if (req.url === "/api/account/login/password" && req.method === "POST") {
        if (payload.account !== fixtureEmail || payload.password !== fixturePassword || payload.captcha_token !== fixtureChallenge || payload.platform !== "web") return json(res, 401, { success: false, message: "Invalid isolated test credentials." });
        const token = randomBytes(32).toString("hex"); sessions.add(token);
        return json(res, 200, { success: true, data: { token, user_id: "fixture-account-123", captcha_token: "fixture-captcha-field-preserved" } }, issuedCookie(token));
      }
      if (req.url === `/api/account/avatar/files/${avatarName}` && req.method === "GET") {
        res.setHeader("Content-Type", "image/webp"); res.end(avatarBytes); return;
      }
      const token = fixtureToken(req);
      if (!token || !sessions.has(token)) return json(res, 401, { success: false, message: "Sign in required." });
      if (req.url === "/api/account/me" && req.method === "POST") return json(res, 200, { success: true, data: { user_id: "fixture-account-123", email: fixtureEmail, nickname: "Isolated gateway fixture", phone: null, avatar_url: null, auth_version: 0 } });
      if (req.url === "/api/account/token/refresh" && req.method === "POST") {
        sessions.delete(token); const refreshed = randomBytes(32).toString("hex"); sessions.add(refreshed);
        return json(res, 200, { success: true, data: { token: refreshed, expires_in: 2592000 } }, issuedCookie(refreshed));
      }
      if (req.url === "/api/account/logout" && req.method === "POST") {
        sessions.delete(token); return json(res, 200, { success: true, message: "Signed out." }, "token=; Max-Age=0; Domain=do-not-copy.example.test");
      }
      if (req.url === "/api/account/avatar" && req.method === "POST") {
        const form = await new Response(body, { headers: { "content-type": req.headers["content-type"] } }).formData();
        assert.deepEqual([...form.keys()], ["avatar"]); assert.ok(form.get("avatar") instanceof File);
        return json(res, 200, { success: true, data: { avatar_url: `/api/account/avatar/files/${avatarName}` } });
      }
      return json(res, 404, { success: false, message: "Fixture endpoint not implemented." });
    } catch { return json(res, 500, { success: false, message: "Isolated transport fixture assertion failed." }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  upstream = server;
  return `http://127.0.0.1:${server.address().port}`;
}
async function freePort() {
  const probe = createPortProbe();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;
}
async function request(base, endpoint, options = {}, timeout = 15000) {
  controller.signal.throwIfAborted();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
  const encoded = new Request(`${base}${endpoint}`, { ...options, headers: { ...browserHeaders, ...options.headers }, signal });
  const body = encoded.body ? Buffer.from(await encoded.arrayBuffer()) : null;
  const headers = Object.fromEntries(encoded.headers);
  if (body) headers["content-length"] = String(body.length);
  // Undici/fetch may replace a supplied Host with the socket destination. Use
  // Node HTTP here to send the real reverse proxy Host header on the wire too;
  // multipart form CSRF checks validate that raw header, not just forwarded URL.
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(`${base}${endpoint}`, { method: encoded.method, headers, signal }, incoming => {
      (async () => {
        const parts = []; let length = 0;
        for await (const chunk of incoming) { length += chunk.length; assert.ok(length <= 10 * 1024 * 1024, "Fixture response exceeded its 10 MB bound."); parts.push(chunk); }
        const bytes = Buffer.concat(parts); const values = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) values.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
        const text = bytes.toString("utf8");
        resolve({ status: incoming.statusCode, headers: values, bytes, text, json: () => JSON.parse(text) });
      })().catch(reject);
    });
    outgoing.once("error", reject); outgoing.end(body);
  });
}
async function startWeb(accountBase) {
  assert.ok(existsSync(path.join(root, "web/dist-node/server/index.js")), "Build the production Web bundle first.");
  const port = await freePort(); let logs = "";
  const child = spawn(process.execPath, ["scripts/selfhost/start.mjs", "--surface", "web"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, PORT: String(port), STORE_OWNER_ID: "isolated-account-wire-owner", MIOVA_SQLITE_PATH: path.join(directory, "commerce.sqlite"),
      STOREFRONT_URL: publicOrigin, MIOVA_MAINTENANCE: "false", ACCOUNT_API_URL: accountBase,
      ACCOUNT_TRUST_NGINX_IP: "false", PAYMENTS_ENABLED: "false" },
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) stream.on("data", piece => { logs = (logs + String(piece)).slice(-12000); });
  child.once("error", error => controller.abort(error));
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    controller.signal.throwIfAborted();
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Production Web fixture exited: ${logs}`);
    try { if ((await request(base, "/", {}, 1500)).status === 200) return { base, child }; } catch { controller.signal.throwIfAborted(); }
    await delay(100, undefined, { signal: controller.signal });
  }
  throw new Error(`Production Web fixture did not become ready: ${logs}`);
}
async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", () => resolve(true)));
  child.kill("SIGTERM");
  let stopped = await Promise.race([exited, delay(5000, undefined, { ref: false }).then(() => false)]);
  if (!stopped) { child.kill("SIGKILL"); stopped = await Promise.race([exited, delay(5000, undefined, { ref: false }).then(() => false)]); }
  if (!stopped) {
    // Preserve evidence and report failure without keeping the verification
    // runner hung forever on a process whose OS refused both stop requests.
    child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
    throw new Error("Fixture process did not stop; its temporary database was preserved.");
  }
}
function cookiePair(response) {
  const cookie = response.headers.getSetCookie().find(value => value.startsWith("miova_customer_session="));
  assert.ok(cookie, "Browser gateway must issue its own HttpOnly cookie name.");
  assert.match(cookie, /; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  assert.doesNotMatch(cookie, /Domain=|do-not-copy/); return cookie.split(";")[0];
}
function post(base, endpoint, data = {}, headers = {}) {
  return request(base, `/api/account/${endpoint}`, { method: "POST", headers: { Origin: publicOrigin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(data) });
}

try {
  const upstreamBase = await startUpstream();
  const web = await startWeb(upstreamBase);
  const accountPage = await request(web.base, "/account");
  assert.equal(accountPage.status, 200); assert.match(accountPage.text, /customer-account-shell|Connecting to account service/); assert.doesNotMatch(accountPage.text, /isolated-wire-customer|fixture-account-123/);
  const home = await request(web.base, "/"); assert.match(home.text, /href="\/account"/, "The real storefront must expose its account entry.");
  const configuration = await request(web.base, "/api/account/config"); assert.equal(configuration.status, 200); assert.deepEqual(configuration.json().data, { email: false, sms: false, google: false, apple: false, password: true, avatar: true });
  const anonymous = await post(web.base, "me"); assert.equal(anonymous.status, 401, anonymous.text);
  const beforeCsrf = upstreamRequests.length;
  for (const suppliedOrigin of ["https://attacker.example.test", "null"]) assert.equal((await post(web.base, "login/password", {}, { Origin: suppliedOrigin })).status, 403);
  const missingOrigin = await request(web.base, "/api/account/login/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); assert.equal(missingOrigin.status, 403);
  assert.equal(upstreamRequests.length, beforeCsrf, "Rejected browser CSRF must never contact the fixture.");
  const login = await post(web.base, "login/password", { account: fixtureEmail, password: fixturePassword, captcha_token: fixtureChallenge, token: "forged-body-token", user_id: "forged-user", platform: "app" }, {
    Authorization: "Bearer forged-header-token", "oai-authenticated-user-id": "forged-admin", "x-forwarded-for": "198.51.100.10", "x-real-ip": "203.0.113.1",
  });
  assert.equal(login.status, 200, "An isolated known fixture login must traverse the real gateway.");
  assert.equal(login.json().success, true); assert.equal(login.json().data.token, undefined); assert.equal(login.json().data.captcha_token, "fixture-captcha-field-preserved");
  assert.doesNotMatch(login.text, /"token"|forged-body-token|forged-header-token/);
  const loginRequest = upstreamRequests.at(-1); assert.equal(loginRequest.headers.authorization, undefined); assert.equal(loginRequest.headers["oai-authenticated-user-id"], undefined); assert.equal(loginRequest.headers["x-forwarded-for"], undefined);
  assert.equal(loginRequest.payload.token, undefined); assert.equal(loginRequest.payload.user_id, undefined); assert.equal(loginRequest.payload.platform, "web");
  const firstCookie = cookiePair(login);
  const forged = await post(web.base, "me", { token: firstCookie.split("=")[1] }, { Authorization: `Bearer ${firstCookie.split("=")[1]}` }); assert.equal(forged.status, 401, "Native credentials cannot replace the browser's own cookie.");
  const signedIn = await post(web.base, "me", {}, { Cookie: firstCookie }); assert.equal(signedIn.status, 200); assert.equal(signedIn.json().data.user_id, "fixture-account-123"); assert.equal(signedIn.json().data.auth_version, undefined);
  const form = new FormData(); form.set("avatar", new File([avatarBytes], "fixture.webp", { type: "image/webp" })); form.set("token", "must-be-stripped");
  const uploaded = await request(web.base, "/api/account/avatar", { method: "POST", headers: { Origin: publicOrigin, Cookie: firstCookie }, body: form }); assert.equal(uploaded.status, 200, uploaded.text);
  const avatar = await request(web.base, uploaded.json().data.avatar_url); assert.equal(avatar.status, 200); assert.equal(avatar.headers.get("content-type"), "image/webp"); assert.equal(avatar.headers.get("x-content-type-options"), "nosniff"); assert.deepEqual(Buffer.from(avatar.bytes), avatarBytes);
  const refreshed = await post(web.base, "token/refresh", {}, { Cookie: firstCookie }); assert.equal(refreshed.status, 200); assert.equal(refreshed.json().data.token, undefined);
  const secondCookie = cookiePair(refreshed); assert.notEqual(secondCookie, firstCookie);
  assert.equal((await post(web.base, "me", {}, { Cookie: firstCookie })).status, 401, "Refresh retires the old fixture session.");
  assert.equal((await post(web.base, "me", {}, { Cookie: secondCookie })).status, 200);
  const signedOut = await post(web.base, "logout", {}, { Cookie: secondCookie }); assert.equal(signedOut.status, 200); assert.match(cookiePair(signedOut), /^miova_customer_session=$/);
  assert.equal((await post(web.base, "me", {}, { Cookie: secondCookie })).status, 401);
  assert.equal((await post(web.base, "me")).status, 401);
  await stop(web.child);
  const unconfigured = await startWeb("");
  const unavailable = await request(unconfigured.base, "/api/account/config"); assert.equal(unavailable.status, 503); assert.equal(unavailable.json().code, "account_not_configured");
  assert.equal((await request(unconfigured.base, "/account")).status, 200, "An unconfigured account service must not take down the account page.");
  assert.equal((await request(unconfigured.base, "/api/v1/catalog")).json().payments.enabled, false);
} finally {
  clearTimeout(deadline);
  const cleanupErrors = [];
  for (const child of children) { try { await stop(child); } catch (error) { cleanupErrors.push(error); } }
  if (upstream) {
    try {
      const closed = new Promise((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
      upstream.closeAllConnections();
      await Promise.race([closed, delay(5000, undefined, { ref: false }).then(() => { throw new Error("Fixture upstream did not close; temporary data was preserved."); })]);
    } catch (error) { upstream.unref(); cleanupErrors.push(error); }
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Account gateway fixture cleanup failed; temporary database was preserved.");
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith("miova-customer-account-wire-"));
  const state = lstatSync(directory); assert.ok(state.isDirectory() && !state.isSymbolicLink());
  rmSync(directory, { recursive: true });
}
console.info("Production customer gateway smoke passed against an isolated in-memory account fixture: account page/entry, CSRF, browser-only identity, HttpOnly secure session, refresh/logout, avatar bytes and unconfigured fail-closed. No real account database, CAPTCHA provider or delivery service was tested.");
