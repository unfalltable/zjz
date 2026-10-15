import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";

// Isolated real Node HTTP verification. No writes to a running preview or production database.
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = mkdtempSync(path.join(tmpdir(), "miova-media-wire-"));
const media = path.join(directory, "media"); mkdirSync(media, { mode: 0o750 });
const children = [];
const password = randomBytes(32).toString("hex");
const username = "media-wire-admin";
const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const signal = AbortSignal.timeout(60_000);

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve)); return port;
}

async function start(surface) {
  const port = await freePort(); let logs = "";
  const child = spawn(process.execPath, ["scripts/selfhost/start.mjs", "--surface", surface], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, PORT: String(port), STORE_OWNER_ID: "media-wire-owner",
      MIOVA_SQLITE_PATH: path.join(directory, "commerce.sqlite"), MIOVA_MEDIA_PATH: media,
      STOREFRONT_URL: "https://store.example.test/", MIOVA_MAINTENANCE: "false",
      MIOVA_ADMIN_USERNAME: username, MIOVA_ADMIN_EMAIL: "media-wire@example.test",
      MIOVA_ADMIN_PASSWORD_SHA256: createHash("sha256").update(password).digest("hex") },
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { logs = (logs + data).slice(-8000); });
  child.once("error", (error) => { logs = String(error); });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 75; attempt++) {
    signal.throwIfAborted();
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Production ${surface} exited: ${logs}`);
    try {
      const response = await fetch(`${base}/`, { headers: { Host: "localhost:8081" }, signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) });
      await response.arrayBuffer(); if (response.ok) return { base, child };
    } catch { signal.throwIfAborted(); }
    await delay(100, undefined, { signal });
  }
  throw new Error(`Production ${surface} did not become ready: ${logs}`);
}

async function stop(child) {
  // Windows reports a signal-terminated child with exitCode=null. A second stop
  // must return rather than await an exit event that has already been emitted.
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM"); const force = setTimeout(() => child.kill("SIGKILL"), 5000).unref();
  await stopped; clearTimeout(force);
}

function uploadForm(bytes, type = "image/png") {
  const form = new FormData(); form.set("file", new Blob([bytes], { type }), "../../original.png"); return form;
}
const headers = { Host: "localhost:8081", Origin: "http://localhost:8081", Authorization: auth };
async function post(base, bytes, moreHeaders = {}, type = "image/png") {
  return fetch(`${base}/api/admin/media`, { method: "POST", headers: { ...headers, Origin: base, ...moreHeaders }, body: uploadForm(bytes, type), signal });
}
async function get(base, url, moreHeaders = {}) {
  assert.ok(url.startsWith("/media/"));
  return fetch(`${base}${url}`, { headers: { Host: "localhost:8081", ...moreHeaders }, signal });
}

try {
  const admin = await start("admin"); const web = await start("web");
  const png = await sharp({ create: { width: 64, height: 48, channels: 4,
    background: { r: 30, g: 150, b: 190, alpha: 0.7 } } }).png().withMetadata().toBuffer();
  const anonymous = await post(admin.base, png, { Authorization: "" }); assert.equal(anonymous.status, 401, await anonymous.clone().text()); await anonymous.arrayBuffer();
  const forbidden = await post(admin.base, png, { Origin: "https://evil.example.test" }); assert.equal(forbidden.status, 403); await forbidden.arrayBuffer();
  const publicUpload = await post(web.base, png); assert.equal(publicUpload.status, 404); await publicUpload.arrayBuffer();
  assert.deepEqual(readdirSync(media), []);
  const uploaded = await post(admin.base, png); assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const result = await uploaded.json(); assert.equal(result.ok, true);
  assert.match(result.image.url, /^\/media\/[a-f0-9]{32}-[a-f0-9]{32}\.webp$/);
  assert.equal(result.image.width, 64); assert.equal(result.image.height, 48);
  assert.equal(readdirSync(media).length, 1); assert.equal(readdirSync(media).some((name) => name.endsWith(".upload")), false);
  for (const base of [admin.base, web.base]) {
    const picture = await get(base, result.image.url); assert.equal(picture.status, 200);
    assert.equal(picture.headers.get("content-type"), "image/webp"); assert.equal(picture.headers.get("x-content-type-options"), "nosniff");
    assert.match(picture.headers.get("cache-control"), /immutable/);
    const bytes = Buffer.from(await picture.arrayBuffer()); assert.equal(bytes.length, result.image.bytes);
    const metadata = await sharp(bytes).metadata(); assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
    const unchanged = await get(base, result.image.url, { "If-None-Match": picture.headers.get("etag") });
    assert.equal(unchanged.status, 304); assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
  }
  const fake = await post(admin.base, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"));
  assert.equal(fake.status, 422); await fake.arrayBuffer(); assert.equal(readdirSync(media).length, 1);
  const lock = path.join(directory, "deployment.lock"); writeFileSync(lock, "isolated-media-maintenance-test", { flag: "wx", mode: 0o600 });
  try {
    const frozen = await post(admin.base, png); assert.equal(frozen.status, 503); await frozen.arrayBuffer();
    const stillVisible = await get(web.base, result.image.url); assert.equal(stillVisible.status, 200); await stillVisible.arrayBuffer();
  } finally { unlinkSync(lock); }
  await stop(admin.child); await stop(web.child);
  const restarted = await start("web");
  const persistent = await get(restarted.base, result.image.url); assert.equal(persistent.status, 200); await persistent.arrayBuffer();
  assert.equal(readdirSync(media).length, 1);
  console.info("Production media verified: authenticated bounded upload, origin isolation, private/public WebP reads, stripped metadata, maintenance freeze and persistent storage after restart.");
} finally {
  for (const child of children) await stop(child);
  assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith("miova-media-wire-"));
  rmSync(directory, { recursive: true });
}
