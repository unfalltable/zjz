import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { insertProduct } from "../../tests/commerce-db-fixture.mjs";

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
  const operatorHeaders = { Authorization: `Basic ${Buffer.from(`build-test:${password}`).toString("base64")}` };
  for (const endpoint of ["/api/admin/orders", "/api/admin/after-sales", "/api/admin/shipping"]) {
    assert.equal((await fetch(`${web}${endpoint}`, {headers: operatorHeaders})).status, 404, "Public bundle must not expose private admin APIs.");
    assert.equal((await fetch(`${admin}${endpoint}`)).status, 401, "Private APIs require credentials on every request.");
    const response = await fetch(`${admin}${endpoint}`, {headers: operatorHeaders});
    assert.equal(response.status, 200, endpoint);
    assert.equal((await response.json()).ok, true);
  }
  // Exercise an actual nonempty audit snapshot through the production RSC
  // boundary: native SQLite records must not crash rendering after a first edit.
  const fixtureDatabase = new DatabaseSync(path.join(directory, "commerce.sqlite"));
  try {
    fixtureDatabase.prepare("INSERT INTO shipping_events(id,owner_id,entity,entity_id,action,details_json,actor_id,created_at) VALUES(?,?,'carrier','smoke-carrier','created','{}',?,?)")
      .run("isolated-audit", "isolated-build-test", "isolated-build-test", new Date().toISOString());
  } finally { fixtureDatabase.close(); }
  const auditedPage = await fetch(`${admin}/ops`, { headers: operatorHeaders });
  assert.equal(auditedPage.status, 200, "An actual audit event must not break the RSC workspace.");
  assert.equal((await auditedPage.text()).includes("isolated-audit"), true);
  // Exercise real product SSR, child deep links and reviewed order totals in the
  // isolated production process. The fixture never touches a merchant database.
  const productsDatabase = new DatabaseSync(path.join(directory, "commerce.sqlite"));
  try {
    const localized = { en: "Variant verification", zh: "规格验证", es: "Verificación de opciones" };
    const metadata = JSON.stringify({ color: "blue", badge: localized, description: localized, detail: localized });
    for (const [id, sku, cents, stock, color, group] of [
      ["variant-root", "VERIFY-BLUE", 2000, 0, "Blue", null],
      ["variant-red", "VERIFY-RED", 3000, 2, "Red", "variant-root"],
      ["variant-green", "VERIFY-GREEN", 4000, 0, "Green", "variant-root"],
    ]) insertProduct(productsDatabase, {
      id, owner_id: "isolated-build-test", sku, storefront_id: id,
      name: "Variant verification", category: "home", image: "/products/kumo.webp",
      price_cents: cents, stock, reserved: 0, status: "active", metadata_json: metadata,
      product_group_id: group, variant_attributes_json: JSON.stringify({ Color: color }),
      variant_signature: JSON.stringify([["Color", color]]),
    });
  } finally { productsDatabase.close(); }
  const grouped = await (await fetch(`${web}/api/v1/catalog`)).json();
  assert.equal(grouped.products.length, 1);
  assert.equal(grouped.products[0].variants.length, 3);
  for (const q of ["VERIFY-RED", "Color: Red", "verification red", "ＶＥＲＩＦＹ－ＲＥＤ"]) {
    const response = await fetch(`${web}/api/v1/catalog?${new URLSearchParams({ q })}`);
    assert.equal(response.status, 200, q);
    const searched = await response.json();
    assert.deepEqual(searched.products.map((item) => item.id), ["variant-root"], q);
    assert.equal(searched.products[0].variants.length, 3);
    assert.deepEqual(searched.pageInfo, { hasMore: false, nextCursor: null });
  }
  assert.deepEqual((await (await fetch(`${web}/api/v1/catalog?q=missing-option`)).json()).products, []);
  const rootPage = await fetch(`${web}/product/variant-root`);
  assert.equal(rootPage.status, 200);
  assert.match(await rootPage.text(), /value="variant-red"[^>]*selected/, "Root details default to a buyable SKU.");
  const soldPage = await fetch(`${web}/product/variant-green`);
  assert.equal(soldPage.status, 200);
  const soldMarkup = await soldPage.text();
  assert.match(soldMarkup, /value="variant-green"[^>]*selected/, "A sold-out child deep link must not switch SKU.");
  assert.match(soldMarkup, /\/product\/variant-root/, "Child metadata retains the canonical listing.");
  const draft = {
    idempotencyKey: crypto.randomUUID(), email: "variant@example.test", firstName: "Test", lastName: "Buyer",
    address: "1 Test Street", apartment: "", city: "Test City", region: "CA", postal: "12345",
    phone: "+15555550100", destination: "US", deliveryMethod: "standard",
    marketingOptIn: false, website: "", items: [{ id: "variant-red", quantity: 1 }],
    expectedSubtotalCents: 3000, expectedShippingCents: 890,
  };
  const postDraft = (input) => fetch(`${web}/api/v1/orders`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const saved = await postDraft(draft);
  assert.equal(saved.status, 200, await saved.clone().text());
  const receipt = await saved.json();
  assert.equal(receipt.totalCents, 3890);
  const changedDatabase = new DatabaseSync(path.join(directory, "commerce.sqlite"));
  try { changedDatabase.prepare("UPDATE products SET price_cents = 3500 WHERE sku = 'VERIFY-RED'").run(); }
  finally { changedDatabase.close(); }
  const changed = await postDraft({ ...draft, idempotencyKey: crypto.randomUUID() });
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, "price_quote_changed");
  const replayed = await (await postDraft(draft)).json();
  assert.equal(replayed.orderNumber, receipt.orderNumber);
  assert.equal(replayed.totalCents, 3890);
  console.info("Node production bundles verified: persistent empty catalog, payments disabled, forged Web identity blocked, private admin authenticated, Unicode/SKU variant search, variant SSR/deep links and reviewed idempotent order totals.");
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
