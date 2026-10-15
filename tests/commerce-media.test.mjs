import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtemp, readdir, readFile, writeFile, rm, symlink, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { env } from "./commerce-test-env.mjs";

register("./commerce-media-loader.mjs", import.meta.url);
const { saveProductImage, readProductImage } = await import("../backend/api/runtime/selfhost/media-storage.mjs");
const { POST, GET } = await import("../backend/api/http/media.ts");
const { isProductImage, isManagedProductImage, isManagedProductImageForOwner, managedImageOwnerPrefix } = await import("../shared/assets.ts");
const endpoint = "http://localhost:8081/api/admin/media";
const png = () => sharp({ create: { width: 100, height: 60, channels: 4, background: { r: 70, g: 120, b: 210, alpha: 0.8 } } }).png().toBuffer();
let counter = 0;

async function isolated(work) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "miova-media-test-"));
  const owner = `media-owner-${++counter}`;
  Object.assign(env, { APP_SURFACE: "admin", STORE_OWNER_ID: owner, MIOVA_MEDIA_PATH: directory,
    TEST_USER: { userId: owner, email: "owner@example.test", displayName: "Test owner" } });
  try { return await work(directory, owner); }
  finally {
    for (const field of ["APP_SURFACE", "STORE_OWNER_ID", "MIOVA_MEDIA_PATH", "MIOVA_MAINTENANCE", "TEST_USER"]) delete env[field];
    // Only the freshly-created, explicit OS temporary fixture is removed.
    await rm(directory, { recursive: true, force: true });
  }
}

function upload(bytes, type = "image/png", extra = {}) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type }), "../../unsafe-original-name.png");
  return new Request(endpoint, { method: "POST", headers: { origin: new URL(endpoint).origin, ...extra }, body: form });
}

test("managed image URLs use strict flat names and deterministic owner isolation", async () => {
  const prefix = await managedImageOwnerPrefix("one");
  const valid = `/media/${prefix}-${"a".repeat(32)}.webp`;
  assert.equal(isProductImage(valid), true); assert.equal(isManagedProductImage(valid), true);
  assert.equal(await isManagedProductImageForOwner(valid, "one"), true);
  assert.equal(await isManagedProductImageForOwner(valid, "two"), false);
  for (const url of ["/media/../../secret.webp", valid + "?x=1", valid.toUpperCase(), valid.replace(".webp", ".svg"), "/media//x.webp", valid.replace("/media/", "//media/")]) assert.equal(isProductImage(url), false, url);
});

test("uploads decode and re-encode only supported image formats, preserving transparency without metadata", async () => isolated(async (directory, owner) => {
  for (const [format, mime] of [["png", "image/png"], ["jpeg", "image/jpeg"], ["webp", "image/webp"]]) {
    const input = await sharp(await png()).withMetadata().toFormat(format).toBuffer();
    const image = await saveProductImage(owner, input, mime, directory);
    assert.equal(image.contentType, "image/webp"); assert.equal(image.width, 100); assert.equal(image.height, 60);
    assert.equal(await isManagedProductImageForOwner(image.url, owner), true);
    const file = await readFile(path.join(directory, path.basename(image.url)));
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.format, "webp"); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
    assert.notDeepEqual(file, input);
    const result = await readProductImage(owner, path.basename(image.url), directory);
    assert.deepEqual(result.bytes, new Uint8Array(file)); assert.match(result.etag, /^"[a-f0-9]{64}"$/);
  }
  assert.equal((await readdir(directory)).length, 3); assert.equal((await readdir(directory)).some((name) => name.endsWith(".upload")), false);
}));

test("large valid pictures are bounded to 2400 pixels and are auto-oriented before publication", async () => isolated(async (directory, owner) => {
  const input = await sharp({ create: { width: 3200, height: 1600, channels: 3, background: "blue" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const image = await saveProductImage(owner, input, "image/jpeg", directory);
  assert.equal(image.width, 1200); assert.equal(image.height, 2400);
  const metadata = await sharp(await readFile(path.join(directory, path.basename(image.url)))).metadata();
  assert.equal(metadata.orientation, undefined);
}));

test("forged MIME, SVG, GIF, malformed and oversized image files cannot be published", async () => isolated(async (directory, owner) => {
  const cases = [
    [await png(), "image/jpeg"], [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), "image/png"],
    [Buffer.from("GIF89a".repeat(20)), "image/png"], [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0]), "image/png"],
    [Buffer.alloc(10 * 1024 * 1024 + 1), "image/png"],
  ];
  for (const [bytes, type] of cases) await assert.rejects(saveProductImage(owner, bytes, type, directory), (error) => [413, 422].includes(error.status));
  assert.deepEqual(await readdir(directory), []);
}));

test("excessive dimensions and decompression pixel limits are rejected before storing", async () => isolated(async (directory, owner) => {
  for (const [width, height] of [[9000, 8], [5000, 5000]]) {
    const bytes = await sharp({ create: { width, height, channels: 3, background: "white" } }).png().toBuffer();
    await assert.rejects(saveProductImage(owner, bytes, "image/png", directory), (error) => error.status === 422);
  }
  assert.deepEqual(await readdir(directory), []);
}));

test("animated WebP and APNG uploads are not silently flattened", async () => isolated(async (directory, owner) => {
  const frames = await Promise.all(["red", "blue"].map((background) => sharp({ create: { width: 2, height: 2, channels: 3, background } }).png().toBuffer()));
  const animated = await sharp(frames, { join: { animated: true } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await assert.rejects(saveProductImage(owner, animated, "image/webp", directory), (error) => error.status === 422);
  const bytes = await png();
  // The acTL animation declaration is detected before decoding, even when a caller forges its CRC.
  const animationChunk = Buffer.alloc(20); animationChunk.writeUInt32BE(8, 0); animationChunk.write("acTL", 4, "ascii"); animationChunk.writeUInt32BE(2, 8);
  const apng = Buffer.concat([bytes.subarray(0, 33), animationChunk, bytes.subarray(33)]);
  await assert.rejects(saveProductImage(owner, apng, "image/png", directory), (error) => error.status === 422);
  assert.deepEqual(await readdir(directory), []);
}));

test("persistent storage is configured explicitly and unsafe roots fail closed", async () => isolated(async (directory, owner) => {
  for (const root of [undefined, "", "media", path.parse(directory).root, directory + path.sep + ".." + path.sep + path.basename(directory), directory + path.sep]) {
    await assert.rejects(saveProductImage(owner, await png(), "image/png", root), (error) => error.status === 503);
  }
}));

test("stored image reads isolate owners, refuse path escapes and survive a fresh module load", async () => isolated(async (directory, owner) => {
  const image = await saveProductImage(owner, await png(), "image/png", directory);
  const filename = path.basename(image.url);
  for (const bad of ["../secret", "..", filename + "/../../secret", filename.toUpperCase(), filename + "%2fsecret"]) assert.equal(await readProductImage(owner, bad, directory), null);
  assert.equal(await readProductImage("other-owner", filename, directory), null);
  const fresh = await import(`../backend/api/runtime/selfhost/media-storage.mjs?isolated=${counter}`);
  assert.ok(await fresh.readProductImage(owner, filename, directory));
  await writeFile(path.join(directory, filename), "not an image");
  assert.equal(await readProductImage(owner, filename, directory), null);
}));

test("storage refuses symlink roots, symlink image paths and world-writable directories", { skip: process.platform === "win32" }, async () => isolated(async (directory, owner) => {
  const image = await saveProductImage(owner, await png(), "image/png", directory);
  const linkRoot = path.join(directory, "linked"); await symlink(directory, linkRoot, "dir");
  await assert.rejects(saveProductImage(owner, await png(), "image/png", linkRoot), (error) => error.status === 503);
  const filename = `${await managedImageOwnerPrefix(owner)}-${"b".repeat(32)}.webp`;
  await symlink(path.join(directory, path.basename(image.url)), path.join(directory, filename));
  assert.equal(await readProductImage(owner, filename, directory), null);
  await chmod(directory, 0o777);
  await assert.rejects(saveProductImage(owner, await png(), "image/png", directory), (error) => error.status === 503);
  await chmod(directory, 0o700);
}));

test("private multipart upload enforces identity, current surface, maintenance and same origin before reading bytes", async () => isolated(async (directory, owner) => {
  const bytes = await png();
  delete env.TEST_USER; assert.equal((await POST(upload(bytes))).status, 401);
  env.TEST_USER = { userId: "attacker", email: "attacker@example.test" }; assert.equal((await POST(upload(bytes))).status, 403);
  env.TEST_USER = { userId: owner, email: "owner@example.test" };
  env.APP_SURFACE = "web"; assert.equal((await POST(upload(bytes))).status, 404); env.APP_SURFACE = "admin";
  env.MIOVA_MAINTENANCE = "true"; assert.equal((await POST(upload(bytes))).status, 503); delete env.MIOVA_MAINTENANCE;
  assert.equal((await POST(upload(bytes, "image/png", { origin: "https://evil.example" }))).status, 403);
  assert.equal((await POST(upload(bytes, "image/png", { "sec-fetch-site": "cross-site" }))).status, 403);
  const missingOrigin = upload(bytes); missingOrigin.headers.delete("origin"); assert.equal((await POST(missingOrigin)).status, 403);
  delete env.MIOVA_MEDIA_PATH; assert.equal((await POST(upload(bytes))).status, 503);
  assert.deepEqual(await readdir(directory), []);
}));

test("HTTP multipart upload returns the permanent URL and public reads are immutable image bytes", async () => isolated(async (directory, owner) => {
  const response = await POST(upload(await png())); assert.equal(response.status, 201);
  const body = await response.json(); assert.equal(body.ok, true); assert.equal(body.image.contentType, "image/webp");
  assert.equal(await isManagedProductImageForOwner(body.image.url, owner), true);
  assert.equal(response.headers.get("cache-control"), "no-store");
  delete env.TEST_USER; env.APP_SURFACE = "web";
  const publicRequest = new Request(`https://store.example${body.image.url}`);
  const image = await GET(publicRequest, path.basename(body.image.url)); assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/webp"); assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.match(image.headers.get("cache-control"), /immutable/); assert.match(image.headers.get("content-security-policy"), /sandbox/);
  assert.equal((await image.arrayBuffer()).byteLength, body.image.bytes);
  const etagRequest = new Request(publicRequest, { headers: { "if-none-match": image.headers.get("etag") } });
  const unchanged = await GET(etagRequest, path.basename(body.image.url)); assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), "");
  env.STORE_OWNER_ID = "different-store"; assert.equal((await GET(publicRequest, path.basename(body.image.url))).status, 404);
}));

test("multipart validation rejects unexpected fields, duplicate files, invalid formats and oversized body streams", async () => isolated(async () => {
  const bytes = await png();
  const form = new FormData(); form.set("file", new Blob([bytes], { type: "image/png" }), "image.png"); form.set("ownerId", "attacker");
  assert.equal((await POST(new Request(endpoint, { method: "POST", headers: { origin: new URL(endpoint).origin }, body: form }))).status, 422);
  form.delete("ownerId"); form.append("file", new Blob([bytes], { type: "image/png" }), "extra.png");
  assert.equal((await POST(new Request(endpoint, { method: "POST", headers: { origin: new URL(endpoint).origin }, body: form }))).status, 422);
  assert.equal((await POST(upload(bytes, "image/svg+xml"))).status, 415);
  assert.equal((await POST(upload(bytes, "image/jpeg"))).status, 422);
  assert.equal((await POST(upload(Buffer.alloc(10 * 1024 * 1024 + 1)))).status, 413);
  assert.equal((await POST(upload(bytes, "image/png", { "content-length": String(11 * 1024 * 1024) }))).status, 413);
  assert.equal((await POST(new Request(endpoint, { method: "POST", headers: { origin: new URL(endpoint).origin, "content-type": "application/json" }, body: "{}" }))).status, 415);
  const oversized = new Request(endpoint, { method: "POST", headers: { origin: new URL(endpoint).origin, "content-type": "multipart/form-data; boundary=safe-boundary" },
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(11 * 1024 * 1024)); controller.close(); } }), duplex: "half" });
  assert.equal((await POST(oversized)).status, 413);
}));

test("public image reads hide nonexistent files and path details and uploads have a bounded per-owner rate", async () => isolated(async (directory, owner) => {
  const filename = `${await managedImageOwnerPrefix(owner)}-${"a".repeat(32)}.webp`;
  assert.equal((await GET(new Request(`https://store.example/media/${filename}`), filename)).status, 404);
  assert.equal((await GET(new Request("https://store.example/media/secret"), "../../secret")).status, 404);
  for (let index = 0; index < 20; index++) assert.equal((await POST(upload(Buffer.from("invalid test image")))).status, 422);
  const limited = await POST(upload(await png())); assert.equal(limited.status, 429);
  assert.deepEqual(await readdir(directory), []);
}));
