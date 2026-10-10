import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";
import { createDatabase, insertProduct } from "./commerce-db-fixture.mjs";
import { createD1Adapter } from "./commerce-d1-fixture.mjs";
import { env } from "./commerce-test-env.mjs";

register("./commerce-module-loader.mjs", import.meta.url);
const catalog = await import("../backend/api/db/catalog.ts");
const ops = await import("../backend/api/db/ops.ts");
const ordersHttp = await import("../backend/api/http/orders.ts");
const catalogHttp = await import("../backend/api/http/catalog.ts");
const trackingHttp = await import("../backend/api/http/tracking.ts");

const owner = "test-commerce-owner";
const input = (overrides = {}) => ({
  idempotencyKey: randomUUID(), email: "buyer@example.com", firstName: "Test", lastName: "Buyer",
  address: "1 Test Street", apartment: "", city: "Test City", region: "CA", postal: "12345",
  phone: "+15555550100", destination: "US", deliveryMethod: "standard", marketingOptIn: false,
  website: "", items: [{ id: "kumo", quantity: 1 }], ...overrides,
});
const request = (body, headers = {}, raw = false) => new Request("http://localhost/api/v1/orders", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers },
  body: raw ? body : JSON.stringify(body),
});

async function isolated(work) {
  const database = createDatabase();
  const d1 = createD1Adapter(database);
  env.DB = d1;
  env.STORE_OWNER_ID = owner;
  try { return await work(database, d1); }
  finally { delete env.DB; delete env.STORE_OWNER_ID; database.close(); }
}

async function activateTemplate(database, { priceCents = 3123, stock = 8, reserved = 2 } = {}) {
  await catalog.importCatalogProducts(owner);
  database.prepare("UPDATE products SET stock = ?, reserved = ? WHERE owner_id = ? AND sku = 'KUMO-01'").run(stock, reserved, owner);
  assert.equal(await catalog.updateCatalogProduct(owner, "KUMO-01", { priceCents, compareAtCents: null, status: "active", expectedVersion: 0 }), true);
}

test("real catalog and operations reads never seed an empty store", async () => isolated(async (_database, d1) => {
  assert.deepEqual(await catalog.getStorefrontProducts(owner), []);
  const snapshot = await ops.getOpsSnapshot(owner);
  assert.deepEqual(snapshot.orders, []);
  assert.deepEqual(snapshot.products, []);
  assert.deepEqual(snapshot.auditEvents, []);
  const response = await catalogHttp.GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.products, []);
  assert.equal(body.payments.enabled, false);
  assert.equal(d1.mutations(), 0, "GET/read functions must be read-only");
}));

test("explicit template import creates paused zero-stock listings and preserves existing merchant records", async () => isolated(async (database) => {
  const imported = await catalog.importCatalogProducts(owner);
  assert.equal(imported.imported, 3);
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 3);
  assert.equal(database.prepare("SELECT count(*) AS count FROM orders").get().count, 0);
  assert.ok(database.prepare("SELECT stock, reserved, status FROM products").all().every((p) => p.stock === 0 && p.reserved === 0 && p.status === "paused"));
  database.prepare("UPDATE products SET stock = 99, price_cents = 3333, name = 'Merchant Product', status = 'active' WHERE sku = 'KUMO-01'").run();
  assert.deepEqual(await catalog.importCatalogProducts(owner), { imported: 0, skipped: 3 });
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 3, "skipped templates must not produce success audit entries");
  const preserved = database.prepare("SELECT stock, price_cents, name, status FROM products WHERE sku = 'KUMO-01'").get();
  assert.deepEqual({ ...preserved }, { stock: 99, price_cents: 3333, name: "Merchant Product", status: "active" });
  assert.equal((await catalog.getStorefrontProducts("another-owner")).length, 0);
}));

test("product creation and editing audit only successful writes and preserve multilingual metadata on restock", async () => isolated(async (database) => {
  const metadata = {
    color: "blue", badge: { en: "", zh: "", es: "" },
    description: { en: "Desk organizer", zh: "桌面收纳", es: "Organizador" },
    detail: { en: "Oak storage tray", zh: "橡木收纳盘", es: "Bandeja de roble" },
  };
  const product = { sku: "REAL-10", name: "Desk Organizer", storefrontId: "desk-organizer",
    priceCents: 1999, category: "home", image: "https://cdn.example/desk.webp", defaultFulfillment: "self", metadata };
  assert.equal(await catalog.createCatalogProduct(owner, product), "created");
  assert.equal(await catalog.createCatalogProduct(owner, product), "exists");
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 1);
  assert.equal(await catalog.updateCatalogProduct(owner, product.sku, { priceCents: 1899, status: "active", expectedVersion: 99 }), false);
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 1);
  assert.equal(await catalog.updateCatalogProduct(owner, product.sku, { priceCents: 1899, status: "active", expectedVersion: 0 }), true);
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 2);
  const beforeStock = database.prepare("SELECT metadata_json FROM products WHERE sku = ?").get(product.sku).metadata_json;
  assert.equal(await ops.addProductStock(owner, product.sku, 10), true);
  assert.equal(database.prepare("SELECT metadata_json FROM products WHERE sku = ?").get(product.sku).metadata_json, beforeStock);
  const published = (await catalog.getStorefrontProducts(owner))[0];
  assert.deepEqual(published.description, metadata.description);
  assert.deepEqual(published.detail, metadata.detail);
  assert.equal(published.inventory, 10);
}));

test("merchant image validation rejects script, HTTP and encoded local path escapes", async () => isolated(async () => {
  for (const image of ["javascript:alert(1)", "http://cdn.example/item.webp", "/ops", "//outside.example/item.webp",
    "/products/../ops", "/products/%2e%2e/ops", "/products/..\\ops", "/products/item\n.webp"]) {
    await assert.rejects(() => catalog.createCatalogProduct(owner, { sku: "IMAGE-01", name: "Image test", storefrontId: "image-test",
      priceCents: 100, category: "home", image, defaultFulfillment: "self" }), /invalid_product_update/, image);
  }
}));

test("catalog edits enforce integer prices, optimistic revisions and complete publish metadata", async () => isolated(async (database) => {
  await catalog.importCatalogProducts(owner);
  await assert.rejects(() => catalog.updateCatalogProduct(owner, "KUMO-01", { priceCents: 0, status: "active" }), /invalid_product_update/);
  await assert.rejects(() => catalog.updateCatalogProduct(owner, "KUMO-01", { priceCents: 1.5, status: "active" }), /invalid_product_update/);
  await assert.rejects(() => catalog.updateCatalogProduct(owner, "KUMO-01", { priceCents: 100, compareAtCents: 50, status: "active" }), /invalid_compare_at_price/);
  assert.equal(await catalog.updateCatalogProduct(owner, "KUMO-01", { priceCents: 2222, compareAtCents: null, status: "active", expectedVersion: 99 }), false);
  database.prepare("UPDATE products SET image = NULL WHERE sku = 'KUMO-01'").run();
  await assert.rejects(() => catalog.updateCatalogProduct(owner, "KUMO-01", { priceCents: 2222, compareAtCents: null, status: "active", expectedVersion: 0 }), /product_presentation_required/);
  assert.equal(await catalog.updateCatalogProduct("another-owner", "KUMO-01", { priceCents: 2222, status: "active" }), false);
}));

test("checkout uses live DB cents/available stock and saves only an unreserved unpaid draft", async () => isolated(async (database) => {
  await activateTemplate(database);
  const products = await catalog.getStorefrontProducts(owner);
  assert.equal(products[0].priceCents, 3123);
  assert.equal(products[0].inventory, 6);
  assert.equal(products[0].rating, 0);
  assert.equal(products[0].reviews, 0);
  const tooMany = await ordersHttp.POST(request(input({ items: [{ id: "kumo", quantity: 7 }] })));
  assert.equal(tooMany.status, 422);
  const response = await ordersHttp.POST(request(input({ totalCents: 1, priceCents: 1, items: [{ id: "kumo", quantity: 2 }] })));
  assert.equal(response.status, 200, await response.clone().text());
  const receipt = await response.json();
  assert.equal(receipt.totalCents, 3123 * 2 + 890);
  assert.equal(receipt.paymentStatus, "pending");
  assert.equal(receipt.inventoryReserved, false);
  const order = database.prepare("SELECT * FROM orders").get();
  assert.equal(order.status, "payment_pending");
  assert.equal(order.payment_status, "pending");
  assert.equal(order.amount_cents, 7136);
  assert.match(order.request_fingerprint, /^[a-f0-9]{64}$/);
  const product = database.prepare("SELECT stock, reserved FROM products WHERE sku = 'KUMO-01'").get();
  assert.equal(product.stock, 8);
  assert.equal(product.reserved, 2, "payment-disabled drafts explicitly do not reserve inventory");
  assert.equal(await ops.setOrderStatus(owner, receipt.orderNumber, "purchase"), "unpaid");
}));

test("same-intent retries return the original draft after price change or unpublishing; changed intent gets 409", async () => isolated(async (database, d1) => {
  await activateTemplate(database);
  const draft = input();
  const first = await (await ordersHttp.POST(request(draft))).json();
  assert.equal(first.ok, true);
  database.prepare("UPDATE products SET status = 'paused', price_cents = 999999, stock = 0 WHERE sku = 'KUMO-01'").run();
  env.DB = { ...d1, prepare(sql) {
    assert.doesNotMatch(sql, /\bFROM\s+products\b/i, "accepted idempotent intent must return its snapshot before reading mutable products");
    return d1.prepare(sql);
  } };
  const retryResponse = await ordersHttp.POST(request({ ...draft, email: " BUYER@EXAMPLE.COM " }));
  assert.equal(retryResponse.status, 200, await retryResponse.clone().text());
  const retry = await retryResponse.json();
  assert.equal(retry.orderNumber, first.orderNumber);
  assert.equal(retry.totalCents, first.totalCents);
  assert.equal((await ordersHttp.POST(request({ ...draft, address: "2 Test Street" }))).status, 409);
  assert.equal((await ordersHttp.POST(request({ ...draft, deliveryMethod: "express" }))).status, 409);
  assert.equal(database.prepare("SELECT count(*) AS count FROM orders").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM order_events WHERE event_type = 'draft_created'").get().count, 1);
}));

test("checkout reaches a late product in a 623-item catalogue with only indexed shopping-bag reads", async () => isolated(async (database, d1) => {
  database.exec("BEGIN");
  for (let index = 0; index < 623; index++) {
    const suffix = String(index).padStart(4, "0");
    insertProduct(database, { id: `large-row-${suffix}`, owner_id: owner, sku: `LARGE-${suffix}`,
      storefront_id: `large-item-${suffix}`, name: `Product ${suffix}`, price_cents: 2500,
      category: "home", image: "/products/kumo.webp", status: "active", stock: 10, reserved: 1 });
  }
  database.exec("COMMIT");
  const productReads = [];
  env.DB = { ...d1, prepare(sql) {
    if (/\bFROM\s+products\b/i.test(sql)) {
      assert.match(sql, /WHERE owner_id = \? AND storefront_id = \? AND status = 'active' LIMIT 1/,
        "checkout must use indexed owner + requested product lookups, not catalogue scans");
      assert.doesNotMatch(sql, /ORDER BY|OFFSET/i);
      productReads.push(sql);
    }
    return d1.prepare(sql);
  } };
  const response = await ordersHttp.POST(request(input({ items: [{ id: "large-item-0622", quantity: 2 }, { id: "large-item-0000", quantity: 1 }] })));
  assert.equal(response.status, 200, await response.clone().text());
  const receipt = await response.json();
  assert.equal(receipt.totalCents, 7500);
  assert.equal(receipt.paymentStatus, "pending");
  assert.equal(receipt.inventoryReserved, false);
  assert.equal(productReads.length, 2, "catalogue size must not increase draft product reads");
  const lines = JSON.parse(database.prepare("SELECT line_items_json FROM orders").get().line_items_json);
  assert.deepEqual(lines.map(({ sku }) => sku), ["LARGE-0622", "LARGE-0000"]);
  assert.deepEqual({ ...database.prepare("SELECT stock, reserved FROM products WHERE sku = 'LARGE-0622'").get() }, { stock: 10, reserved: 1 });
}));

test("indexed checkout reads reject missing, another tenant's, unpublished and unavailable products without draft writes", async () => isolated(async (database, d1) => {
  const active = { owner_id: owner, name: "Unavailable item", price_cents: 1000,
    category: "home", image: "/products/kumo.webp", status: "active", stock: 5, reserved: 0 };
  insertProduct(database, { ...active, id: "foreign-row", sku: "FOREIGN-1", storefront_id: "foreign-only", owner_id: "another-owner" });
  insertProduct(database, { ...active, id: "paused-row", sku: "PAUSED-1", storefront_id: "paused-only", status: "paused" });
  insertProduct(database, { ...active, id: "empty-row", sku: "EMPTY-1", storefront_id: "empty-only", stock: 0 });
  insertProduct(database, { ...active, id: "reserved-row", sku: "RESERVED-1", storefront_id: "reserved-only", reserved: 5 });
  for (const id of ["missing-only", "foreign-only", "paused-only", "empty-only", "reserved-only"]) {
    const response = await ordersHttp.POST(request(input({ items: [{ id, quantity: 1 }] })));
    assert.equal(response.status, 422, id);
    assert.equal((await response.json()).code, "item_unavailable", id);
  }
  assert.equal(database.prepare("SELECT count(*) AS count FROM orders").get().count, 0);
  assert.equal(database.prepare("SELECT count(*) AS count FROM order_events").get().count, 0);
  assert.equal(d1.mutations(), 0);
}));

test("checkout's 20-line bound rejects an oversized bag before any product query", async () => isolated(async (_database, d1) => {
  env.DB = { ...d1, prepare() { assert.fail("invalid checkout must not access the database"); } };
  const response = await ordersHttp.POST(request(input({ items: Array.from({ length: 21 }, (_, index) => ({ id: `item-${index}`, quantity: 1 })) })));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "invalid_checkout");
  assert.equal(d1.mutations(), 0);
}));

test("simultaneous same-key submissions converge to one receipt without reserving stock", async () => isolated(async (database) => {
  await activateTemplate(database);
  const draft = input();
  const responses = await Promise.all(Array.from({ length: 4 }, () => ordersHttp.POST(request(draft))));
  assert.ok(responses.every((response) => response.status === 200));
  const receipts = await Promise.all(responses.map((response) => response.json()));
  assert.equal(new Set(receipts.map((receipt) => receipt.orderNumber)).size, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM orders").get().count, 1);
  assert.equal(database.prepare("SELECT reserved FROM products WHERE sku = 'KUMO-01'").get().reserved, 2);
}));

test("tracking requires the checkout email and omits recipient personal data", async () => isolated(async (database) => {
  await activateTemplate(database);
  const saved = await (await ordersHttp.POST(request(input()))).json();
  const lookup = { orderNumber: saved.orderNumber, email: "buyer@example.com" };
  const tracked = await trackingHttp.POST(request(lookup));
  assert.equal(tracked.status, 200);
  const receipt = await tracked.json();
  assert.equal(receipt.order.status, "payment_pending");
  for (const field of ["customerEmail", "customerName", "phone", "shippingAddress", "postalCode", "destination"]) {
    assert.ok(!(field in receipt.order), field);
  }
  assert.equal((await trackingHttp.POST(request({ ...lookup, email: "wrong@example.com" }))).status, 404);
  env.STORE_OWNER_ID = "another-owner";
  assert.equal((await trackingHttp.POST(request(lookup))).status, 404);
}));

test("HTTP guards reject cross-site writes, wrong types, malformed/oversized JSON and incomplete checkout", async () => isolated(async () => {
  assert.equal((await ordersHttp.POST(request({}, { Origin: "https://untrusted.example" }))).status, 403);
  assert.equal((await ordersHttp.POST(request({}, { "Sec-Fetch-Site": "cross-site" }))).status, 403);
  assert.equal((await ordersHttp.POST(request({}, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal((await ordersHttp.POST(request("{", {}, true))).status, 400);
  assert.equal((await ordersHttp.POST(request("x".repeat(33_000), {}, true))).status, 413);
  assert.equal((await ordersHttp.POST(request({}))).status, 422);
}));

test("stock mutation service rejects non-positive/fractional/excessive requests and records intentional restock", async () => isolated(async (database) => {
  await catalog.importCatalogProducts(owner);
  for (const quantity of [-1, 0, 0.5, 1001, NaN, Infinity]) {
    await assert.rejects(() => ops.addProductStock(owner, "KUMO-01", quantity), /invalid_stock_adjustment/);
  }
  assert.equal(await ops.addProductStock("another-owner", "KUMO-01", 1), false);
  assert.equal(await ops.addProductStock(owner, "KUMO-01", 5, "Actual warehouse receipt"), true);
  assert.equal(database.prepare("SELECT stock FROM products WHERE sku = 'KUMO-01'").get().stock, 5);
  const events = (await ops.getOpsSnapshot(owner)).auditEvents;
  assert.ok(events.some((event) => event.entity === "inventory" && event.action === "restocked"));
}));
