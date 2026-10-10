import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = mkdtempSync(path.join(tmpdir(), "miova-build-smoke-"));
const children = [];
const password = "isolated-build-test-only";
const email = "build-test@example.test";
async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
async function start(surface) {
  const port = await freePort();
  let output = "";
  const child = spawn(process.execPath, [path.join(root, "scripts/selfhost/start.mjs"), "--surface", surface], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
      PORT: String(port), STORE_OWNER_ID: "isolated-build-test",
      MIOVA_SQLITE_PATH: path.join(directory, "commerce.sqlite"), STOREFRONT_URL: "https://store.example.test/",
      MIOVA_ADMIN_USERNAME: "build-test", MIOVA_ADMIN_EMAIL: email,
      MIOVA_ADMIN_PASSWORD_SHA256: createHash("sha256").update(password).digest("hex"),
    },
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output = (output + data).slice(-8000); });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Production ${surface} process exited: ${output}`);
    try { if ((await fetch(`${url}/`, { signal: AbortSignal.timeout(1000) })).ok) return url; } catch { /* wait for readiness */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Production ${surface} did not become ready: ${output}`);
}
try {
  const web = await start("web");
  const catalogResponse = await fetch(`${web}/api/v1/catalog`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.ok, true);
  assert.equal(catalog.payments.enabled, false);
  assert.deepEqual(catalog.products, []);
  const forged = await (await fetch(`${web}/ops`, { headers: {
    "oai-authenticated-user-id": "isolated-build-test", "oai-authenticated-user-email": "forged@example.test",
    Authorization: `Basic ${Buffer.from(`build-test:${password}`).toString("base64")}`,
  } })).text();
  assert.equal(forged.includes("forged@example.test"), false);
  assert.equal(forged.includes(email), false);
  const admin = await start("admin");
  const anonymous = await (await fetch(`${admin}/ops`)).text();
  assert.equal(anonymous.includes(email), false);
  const valid = await (await fetch(`${admin}/ops`, { headers: {
    Authorization: `Basic ${Buffer.from(`build-test:${password}`).toString("base64")}`,
  } })).text();
  assert.equal(valid.includes(email), true, "Valid private admin must reach real owner workspace.");
  assert.equal(valid.includes("Operations workspace unavailable"), false);
  console.info("Node production bundles verified: persistent empty catalog, payments disabled, forged Web identity blocked, private admin authenticated.");
} finally {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    await stopped;
    clearTimeout(force);
  }
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith("miova-build-smoke-"));
  rmSync(directory, { recursive: true });
}
