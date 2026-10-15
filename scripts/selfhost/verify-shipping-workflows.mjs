import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { insertProduct, transaction } from "../../tests/commerce-db-fixture.mjs";

// Run after build:selfhost. Only the real, local production Web HTTP boundary is
// exercised. All fixtures, SQLite sidecars and media live in one disposable tree;
// no .env/.dev.vars, merchant database, preview or deployment is used.
const root = fileURLToPath(new URL("../../", import.meta.url));
const prefix = "miova-shipping-wire-";
const directory = mkdtempSync(path.join(tmpdir(), prefix));
const filename = path.join(directory, "commerce.sqlite");
const media = path.join(directory, "media");
const owner = "production-shipping-fixture-owner";
const productId = "shipping-wire-large";
const sku = "WIRE-SHIPPING-LARGE";
const ruleId = randomUUID();
const carrierCode = "wire-postal";
const carrierName = "PRIVATE SHIPPING CARRIER FIXTURE";
const ruleName = "PRIVATE SHIPPING RULE FIXTURE";
const trackingTemplate = "https://tracking.example.com/private-fixture/{trackingNumber}";
const signal = AbortSignal.timeout(90_000);
let child; let closed; let database; let base; let spawnError;
let logs = "";
let originalInventory;

async function unusedPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(endpoint, options = {}, timeoutMs = 5000) {
  signal.throwIfAborted();
  const response = await fetch(`${base}${endpoint}`, {
    ...options, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  // Keep the timeout active until the entire response has been consumed.
  const text = await response.text();
  assert.match(response.headers.get("content-type") ?? "", /application\/json/, text.slice(0, 500));
  return { status: response.status, headers: response.headers, body: JSON.parse(text) };
}

async function start() {
  const port = await unusedPort();
  base = `http://127.0.0.1:${port}`;
  // Do not inherit merchant bindings, credentials or NODE_OPTIONS preloads.
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (/^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR)$/i.test(key)) env[key] = process.env[key];
  }
  Object.assign(env, {
    PORT: String(port), STORE_OWNER_ID: owner, MIOVA_SQLITE_PATH: filename,
    MIOVA_MEDIA_PATH: media, STOREFRONT_URL: "https://store.example.test/",
    MIOVA_MAINTENANCE: "false", NODE_ENV: "production",
  });
  child = spawn(process.execPath, [path.join(root, "scripts/selfhost/start.mjs"), "--surface", "web"], {
    cwd: directory, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  closed = new Promise((resolve) => child.once("close", resolve));
  child.once("error", (error) => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-8000); });
  }
  for (let attempt = 0; attempt < 75; attempt++) {
    signal.throwIfAborted();
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Production Web exited: ${logs}`);
    try {
      // An invalid bag is read-only and proves the actual production API is ready.
      const response = await request("/api/v1/shipping?country=US&items=%5B%5D", {}, 1000);
      if (response.status === 400) return;
    } catch { signal.throwIfAborted(); /* waiting for the local production listener */ }
    await delay(100, undefined, { signal });
  }
  throw new Error(`Production Web shipping API did not become ready: ${logs}`);
}

async function stop() {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
    await closed;
    return;
  }
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 5000).unref();
  try { await closed; } finally { clearTimeout(force); }
}

function inventory() {
  return database.prepare("SELECT id,sku,stock,reserved,inbound FROM products ORDER BY id").all();
}
function assertInventory() {
  assert.deepEqual(inventory(), originalInventory, "Quotes, drafts, rejections and retries must never change stock or reservations.");
}
function snapshot() {
  return {
    orders: database.prepare("SELECT * FROM orders ORDER BY id").all(),
    events: database.prepare("SELECT * FROM order_events ORDER BY id").all(),
    inventory: inventory(),
  };
}
function seed() {
  transaction(database, () => {
    // The child SKU deliberately differs from its listing in price and weight.
    insertProduct(database, {
      id: "shipping-wire-listing", storefront_id: "shipping-wire-listing", owner_id: owner,
      sku: "WIRE-SHIPPING-ROOT", name: "Shipping listing", category: "home", image: "/products/kumo.webp",
      variant_attributes_json: JSON.stringify({ Size: "Small" }), variant_signature: JSON.stringify([["Size", "Small"]]),
      status: "active", price_cents: 1000, shipping_weight_grams: 500, stock: 0, reserved: 0, inbound: 0,
    });
    insertProduct(database, {
      id: productId, storefront_id: productId, owner_id: owner, sku,
      name: "Shipping large option", category: "home", image: "/products/kumo.webp",
      product_group_id: "shipping-wire-listing", variant_attributes_json: JSON.stringify({ Size: "Large" }),
      variant_signature: JSON.stringify([["Size", "Large"]]), status: "active", default_fulfillment: "self",
      price_cents: 2100, shipping_weight_grams: 1250, stock: 20, reserved: 2, inbound: 3,
    });
    const now = new Date().toISOString();
    database.prepare(`INSERT INTO shipping_carriers
      (owner_id,code,name,tracking_url_template,enabled,version,updated_at) VALUES(?,?,?,?,1,0,?)`)
      .run(owner, carrierCode, carrierName, trackingTemplate, now);
    database.prepare(`INSERT INTO shipping_rules
      (id,owner_id,name,method,countries_json,base_cents,included_weight_grams,step_weight_grams,
        step_cents,free_above_cents,min_days,max_days,carrier_code,enabled,version,updated_at,mutation_id)
      VALUES(?,?,?,'standard','["US"]',700,500,500,250,8400,7,14,?,1,0,?,?)`)
      .run(ruleId, owner, ruleName, carrierCode, now, randomUUID());
    database.prepare(`INSERT INTO shipping_rule_countries(rule_id,owner_id,method,country,enabled)
      VALUES(?,?,'standard','US',1)`).run(ruleId, owner);
  });
  originalInventory = inventory();
}
function changeRule(baseCents, enabled = true) {
  transaction(database, () => {
    database.prepare(`UPDATE shipping_rules SET base_cents=?,enabled=?,version=version+1,updated_at=?,mutation_id=?
      WHERE owner_id=? AND id=?`).run(baseCents, enabled ? 1 : 0, new Date().toISOString(), randomUUID(), owner, ruleId);
    database.prepare("UPDATE shipping_rule_countries SET enabled=? WHERE owner_id=? AND rule_id=?")
      .run(enabled ? 1 : 0, owner, ruleId);
  });
}
function changeProduct(priceCents, weightGrams = 1250) {
  database.prepare("UPDATE products SET price_cents=?,shipping_weight_grams=? WHERE owner_id=? AND id=?")
    .run(priceCents, weightGrams, owner, productId);
}
const bag = (quantity = 2) => [{ id: productId, quantity }];
const forgedBag = (quantity = 2) => [{
  id: productId, quantity, sku: "WIRE-SHIPPING-ROOT", priceCents: 1, weightGrams: 1, shippingWeightGrams: 1,
}];

function assertPublicQuote(body) {
  assert.equal(body.ok, true);
  assert.equal(body.apiVersion, "v1");
  assert.equal(body.country, "US");
  assert.equal(body.currency, "USD");
  assert.equal(body.configured, true);
  assert.match(body.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(body.quotes.map((quote) => quote.method), ["standard", "express", "priority"]);
  for (const quote of body.quotes) {
    assert.equal(quote.revision, body.revision);
    assert.equal(quote.ruleId, null, "Public responses must redact internal rule IDs.");
    assert.equal(quote.carrierCode, null, "Public responses must redact carrier identifiers.");
  }
  const forbiddenKeys = new Set(["ownerId", "owner_id", "rules", "carriers", "trackingUrlTemplate",
    "tracking_url_template", "countriesJson", "countries_json", "baseCents", "base_cents",
    "stepCents", "step_cents", "mutationId", "mutation_id"]);
  function inspect(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `Private shipping setting leaked: ${key}`);
      inspect(item);
    }
  }
  inspect(body);
  const text = JSON.stringify(body);
  for (const value of [owner, ruleId, carrierCode, carrierName, ruleName, trackingTemplate]) {
    assert.equal(text.includes(value), false, "A private fixture value must not appear in a public quote.");
  }
}

async function quote(items = bag()) {
  const before = snapshot();
  const params = new URLSearchParams({
    country: "US", items: JSON.stringify(items), subtotalCents: "1", weightGrams: "1", shippingCents: "0",
  });
  const response = await request(`/api/v1/shipping?${params}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assertPublicQuote(response.body);
  assert.deepEqual(snapshot(), before, "A shipping quote must perform no order, audit or inventory writes.");
  assertInventory();
  return response.body;
}
function assertAmounts(quoteBody, subtotalCents, weightGrams, shippingCents) {
  assert.equal(quoteBody.subtotalCents, subtotalCents);
  assert.equal(quoteBody.weightGrams, weightGrams);
  const standard = quoteBody.quotes[0];
  assert.equal(standard.available, true);
  assert.equal(standard.shippingCents, shippingCents);
  assert.equal(standard.minDays, 7);
  assert.equal(standard.maxDays, 14);
  assert.equal(standard.reason, null);
  for (const unavailable of quoteBody.quotes.slice(1)) {
    assert.equal(unavailable.available, false, "Configured stores must not fall back to legacy rates.");
    assert.equal(unavailable.shippingCents, null);
  }
}
function draft(review, quantity = 2, idempotencyKey = randomUUID()) {
  return {
    idempotencyKey, email: "shipping-wire@example.test", firstName: "Test", lastName: "Buyer",
    address: "1 Fixture Street", apartment: "", city: "Test City", region: "CA", postal: "12345",
    phone: "+15555550100", destination: "US", deliveryMethod: "standard", website: "", marketingOptIn: false,
    shippingRevision: review.revision, expectedSubtotalCents: review.subtotalCents,
    expectedShippingCents: review.quotes[0].shippingCents, items: forgedBag(quantity),
    subtotalCents: 1, weightGrams: 1, shippingCents: 0,
  };
}
async function post(input) {
  const response = await request("/api/v1/orders", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  assertInventory();
  return response;
}
async function rejected(input, status, code) {
  const before = snapshot();
  const response = await post(input);
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, code);
  assert.deepEqual(snapshot(), before, `${code} must add zero orders/events and leave accepted snapshots unchanged.`);
}
async function accepted(input, shippingCents, unitPriceCents, quantity) {
  const before = snapshot();
  const response = await post(input);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.ok, true);
  assert.equal(response.body.paymentStatus, "pending");
  assert.equal(response.body.inventoryReserved, false);
  assert.deepEqual(response.body.routeModes, ["self"]);
  assert.equal(response.body.totalCents, unitPriceCents * quantity + shippingCents);
  const after = snapshot();
  assert.equal(after.orders.length, before.orders.length + 1);
  assert.equal(after.events.length, before.events.length + 1);
  const row = database.prepare("SELECT * FROM orders WHERE owner_id=? AND idempotency_key=?").get(owner, input.idempotencyKey);
  assert.equal(row.order_number, response.body.orderNumber);
  assert.equal(row.status, "payment_pending");
  assert.equal(row.payment_status, "pending");
  assert.equal(row.source, "storefront");
  assert.equal(row.currency, "USD");
  assert.equal(row.shipping_cents, shippingCents);
  assert.equal(row.amount_cents, unitPriceCents * quantity + shippingCents);
  assert.deepEqual(JSON.parse(row.line_items_json).map(({ sku: actualSku, quantity: units, priceCents }) =>
    ({ sku: actualSku, quantity: units, priceCents })), [{ sku, quantity, priceCents: unitPriceCents }]);
  return response.body;
}
async function replay(input, receipt) {
  const before = snapshot();
  const response = await post(input);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body, receipt, "Same-key original intent must replay the complete accepted receipt.");
  assert.deepEqual(snapshot(), before, "A replay must retain the original persisted line prices and shipping snapshot without writes.");
}

try {
  assert.ok(existsSync(path.join(root, "web/dist-node/server/index.js")), "Build the standalone Web surface before this regression.");
  mkdirSync(media, { mode: 0o750 });
  await start();
  database = new DatabaseSync(filename, { enableForeignKeyConstraints: true, allowExtension: false });
  database.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  seed();
  assert.equal(snapshot().orders.length, 0);
  const initial = await quote(forgedBag());
  assertAmounts(initial, 4200, 2500, 1700);
  assert.deepEqual(await quote(), initial, "Forged item prices/weights/SKU and top-level amounts must be ignored.");
  const original = draft(initial);

  // Rejected reviews must not consume a key or create even a first draft.
  changeRule(900);
  await rejected(original, 409, "shipping_quote_changed");
  const repricedShipping = await quote();
  assert.notEqual(repricedShipping.revision, initial.revision);
  assertAmounts(repricedShipping, 4200, 2500, 1900);
  await rejected({ ...original, shippingRevision: repricedShipping.revision }, 409, "shipping_quote_changed");
  changeProduct(2600);
  await rejected({ ...original, shippingRevision: repricedShipping.revision, expectedShippingCents: 1900 }, 409, "price_quote_changed");
  assert.equal(snapshot().orders.length, 0);

  const reviewedQuote = await quote(forgedBag());
  assertAmounts(reviewedQuote, 5200, 2500, 1900);
  const reviewed = draft(reviewedQuote, 2, original.idempotencyKey);
  const receipt = await accepted(reviewed, 1900, 2600, 2);
  changeRule(1400);
  await replay(reviewed, receipt);
  await rejected({ ...reviewed, idempotencyKey: randomUUID() }, 409, "shipping_quote_changed");

  changeRule(1400, false);
  const disabled = await quote();
  assert.notEqual(disabled.revision, reviewedQuote.revision);
  assert.equal(disabled.quotes[0].available, false);
  assert.equal(disabled.quotes[0].shippingCents, null);
  assert.equal(disabled.quotes[0].reason, "route_disabled");
  await rejected({ ...reviewed, idempotencyKey: randomUUID() }, 409, "shipping_quote_changed");
  await rejected({ ...reviewed, idempotencyKey: randomUUID(), shippingRevision: disabled.revision }, 422, "shipping_unavailable");
  // A replay must bypass both live SKU changes and the now-disabled route.
  changeProduct(3100, 1500);
  await replay(reviewed, receipt);
  for (const changed of [
    { ...reviewed, email: "different-buyer@example.test" },
    { ...reviewed, items: forgedBag(1) },
    { ...reviewed, shippingRevision: disabled.revision },
    { ...reviewed, expectedShippingCents: 0 },
  ]) await rejected(changed, 409, "idempotency_conflict");

  changeProduct(2100);
  changeRule(700);
  const belowFree = await quote(bag(3));
  assertAmounts(belowFree, 6300, 3750, 2450);
  const free = await quote(forgedBag(4));
  assertAmounts(free, 8400, 5000, 0);
  const freeDraft = draft(free, 4);
  await rejected({ ...freeDraft, expectedShippingCents: 1 }, 409, "shipping_quote_changed");
  const freeReceipt = await accepted(freeDraft, 0, 2100, 4);
  await replay(freeDraft, freeReceipt);
  assert.equal(snapshot().orders.length, 2);
  assert.equal(snapshot().events.length, 2);
  assertInventory();
  assert.deepEqual(readdirSync(media), [], "Shipping and pending orders must not write media.");
  console.info("Production shipping verified: live child-SKU prices/weights, ignored forged amounts, private-setting redaction, stale price/rate reviews (409), disabled routes (409/422), zero rejected writes, reviewed pending drafts, unchanged stock/reservations, exact original-snapshot replays, changed-intent conflicts and exact-threshold zero shipping.");
} finally {
  try {
    await stop();
  } finally {
    try { database?.close(); }
    finally {
      assert.equal(path.dirname(directory), path.resolve(tmpdir()));
      assert.ok(path.basename(directory).startsWith(prefix));
      rmSync(directory, { recursive: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}
