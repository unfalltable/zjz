import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { createDatabase, insertOrder, insertProduct } from "./commerce-db-fixture.mjs";
import { createD1Adapter } from "./commerce-d1-fixture.mjs";
import { env } from "./commerce-test-env.mjs";

register("./commerce-admin-loader.mjs", import.meta.url);
const operations = await import("../backend/api/db/admin-commerce.ts");
const shipping = await import("../backend/api/db/shipping.ts");
const legacy = await import("../backend/api/db/ops.ts");
const actions = await import("../backend/backend_web/app/admin-actions.ts");
const ordersRoute = await import("../backend/backend_web/app/api/admin/orders/route.ts");
const detailRoute = await import("../backend/backend_web/app/api/admin/orders/[number]/route.ts");
const salesRoute = await import("../backend/backend_web/app/api/admin/after-sales/route.ts");
const shippingRoute = await import("../backend/backend_web/app/api/admin/shipping/route.ts");
const tracking = await import("../backend/api/http/tracking.ts");
const { validateCsrfOrigin } = await import("../node_modules/vinext/dist/server/request-pipeline.js");

const owner = "operations-review-owner";
const number = "MW-00001";
const orderedLines = [{ sku: "REVIEW-01", name: "Review item", quantity: 2, priceCents: 1000, fulfillmentMode: "self" }];
async function isolated(work) {
  const database = createDatabase(); const d1 = createD1Adapter(database);
  env.DB = d1; env.STORE_OWNER_ID = owner; env.APP_SURFACE = "admin";
  env.TEST_USER = { userId: owner, email: "operator@example.com", displayName: "Operator" };
  insertProduct(database, { owner_id: owner, sku: "REVIEW-01", stock: 2, reserved: 0, version: 0 });
  insertOrder(database, { owner_id: owner, order_number: number, amount_cents: 2300, shipping_cents: 300,
    shipping_address: "Private recipient street address", customer_email: "buyer@example.com", phone: "+15555550111",
    postal_code: "12345", line_items_json: JSON.stringify(orderedLines), payment_status: "paid" });
  await shipping.saveCarrier(owner, { code: "postal", name: "Postal", trackingUrlTemplate: "https://tracking.example.com/{trackingNumber}", enabled: true, expectedVersion: -1 });
  try { await work(database, d1); }
  finally { for (const key of ["DB", "STORE_OWNER_ID", "APP_SURFACE", "TEST_USER"]) delete env[key]; database.close(); }
}
const detail = () => operations.getAdminOrderDetail(owner, number);
async function dispatched() {
  assert.equal((await operations.reviewOrder(owner, number, 0, "confirm", "Verified recipient")).ok, true);
  assert.equal((await operations.createShipment(owner, number, 1, { fulfillmentMode: "self", carrierCode: "postal",
    trackingNumber: "REVIEW-TRACK", lines: [{ sku: "REVIEW-01", quantity: 2 }] })).ok, true);
}
function form(values) { const value = new FormData(); for (const [key, item] of Object.entries(values)) value.set(key, String(item)); return value; }

test("independent review: public admin read routes reveal no PII even with forged owner headers", async () => isolated(async (_database, d1) => {
  env.APP_SURFACE = "web";
  let reads = 0; const prepare = d1.prepare;
  d1.prepare = (...args) => { reads++; return prepare(...args); };
  const request = new Request("http://localhost:3100/api/admin/orders", { headers: {
    "oai-authenticated-user-id": owner, "oai-authenticated-user-email": "operator@example.com", Authorization: "Basic forged",
  } });
  const responses = [await ordersRoute.GET(request), await detailRoute.GET(request, { params: Promise.resolve({ number }) }),
    await salesRoute.GET(request), await shippingRoute.GET(request)];
  for (const response of responses) {
    assert.equal(response.status, 404);
    const body = await response.text();
    assert.doesNotMatch(body, /Private recipient|buyer@example|15555550111/);
  }
  assert.equal(reads, 0, "surface isolation must precede any database access");
}));

test("independent review: unauthenticated, foreign-operator and cross-origin private reads are rejected", async () => isolated(async () => {
  const request = () => new Request("http://localhost:8081/api/admin/orders");
  delete env.TEST_USER;
  assert.equal((await ordersRoute.GET(request())).status, 401);
  env.TEST_USER = { userId: "foreign-operator" };
  assert.equal((await ordersRoute.GET(request())).status, 403);
  env.TEST_USER = { userId: owner };
  assert.equal((await ordersRoute.GET(new Request(request().url, { headers: { Origin: "https://evil.example" } }))).status, 403);
  assert.equal((await ordersRoute.GET(new Request(request().url, { headers: { "Sec-Fetch-Site": "cross-site" } }))).status, 403);
  const allowed = await detailRoute.GET(request(), { params: Promise.resolve({ number }) });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "no-store");
}));

test("independent review: every new server action authenticates before writes", async () => isolated(async (database, d1) => {
  const actionsList = [actions.reviewOrderAction, actions.createShipmentAction, actions.updateShipmentAction,
    actions.createAfterSaleAction, actions.updateAfterSaleAction, actions.saveShippingRuleAction, actions.saveCarrierAction];
  const before = d1.mutations();
  for (const user of [null, { userId: "foreign-operator" }]) {
    env.TEST_USER = user;
    for (const action of actionsList) {
      assert.equal((await action({}, form({ orderNumber: number, expectedVersion: 0, decision: "cancel", note: "Forged request" }))).kind, "error");
    }
  }
  env.TEST_USER = { userId: owner }; env.APP_SURFACE = "web";
  for (const action of actionsList) assert.equal((await action({}, new FormData())).kind, "error");
  assert.equal(d1.mutations(), before);
  assert.equal(database.prepare("SELECT review_status FROM orders").get().review_status, "unreviewed");
}));

test("independent review: installed framework blocks cross-site and opaque-origin server actions", () => {
  for (const origin of ["https://evil.example", "null", "not-a-valid-origin"]) {
    const request = new Request("http://localhost:8081/ops", { method: "POST", headers: { Host: "localhost:8081", Origin: origin } });
    assert.equal(validateCsrfOrigin(request)?.status, 403, origin);
  }
  assert.equal(validateCsrfOrigin(new Request("http://localhost:8081/ops", { method: "POST", headers: {
    Host: "localhost:8081", Origin: "http://localhost:8081",
  } })), null);
});

test("independent review: old status-only writes cannot bypass reservations or waybills", async () => isolated(async (database) => {
  const before = database.prepare("SELECT * FROM orders").get();
  assert.equal(await legacy.setOrderStatus(owner, number, "packing", 0), "invalid_transition");
  assert.deepEqual(database.prepare("SELECT * FROM orders").get(), before);
  assert.equal(database.prepare("SELECT count(*) AS n FROM shipments").get().n, 0);
}));

test("independent review: concurrent paid confirmations for different orders cannot oversell a shared SKU", async () => isolated(async (database) => {
  insertOrder(database, { id: "second-order", owner_id: owner, order_number: "MW-00002", idempotency_key: "second-key",
    amount_cents: 2300, shipping_cents: 300, shipping_address: "Another address", line_items_json: JSON.stringify(orderedLines), payment_status: "paid" });
  const results = await Promise.all([operations.reviewOrder(owner, number, 0, "confirm", "First recipient"),
    operations.reviewOrder(owner, "MW-00002", 0, "confirm", "Second recipient")]);
  assert.equal(results.filter(({ ok }) => ok).length, 1);
  const product = database.prepare("SELECT stock,reserved FROM products").get();
  assert.equal(product.stock, 2); assert.equal(product.reserved, 2);
  assert.equal(database.prepare("SELECT sum(remaining) AS n FROM order_reservations").get().n, 2);
}));

test("independent review: disabling carrier between read and dispatch commits no package or inventory deduction", async () => isolated(async (database, d1) => {
  await operations.reviewOrder(owner, number, 0, "confirm", "Verified");
  const batch = d1.batch;
  d1.batch = async (statements) => { database.prepare("UPDATE shipping_carriers SET enabled=0 WHERE owner_id=?").run(owner); return batch(statements); };
  const result = await operations.createShipment(owner, number, 1, { fulfillmentMode: "self", carrierCode: "postal",
    trackingNumber: "DISABLED-RACE", lines: [{ sku: "REVIEW-01", quantity: 2 }] });
  assert.equal(result.ok, false);
  assert.equal(database.prepare("SELECT stock FROM products").get().stock, 2);
  assert.equal(database.prepare("SELECT count(*) AS n FROM shipments").get().n, 0);
}));

test("independent review regression: rejected claims remain terminal and never reclaim released quantities when closed", async () => isolated(async () => {
  await dispatched();
  const request = { kind: "return", reason: "Rejected claim", lines: [{ sku: "REVIEW-01", quantity: 2 }], amountCents: 2000 };
  assert.equal((await operations.createAfterSale(owner, number, (await detail()).version, request)).ok, true);
  const claim = (await detail()).afterSales[0];
  assert.equal((await operations.updateAfterSale(owner, claim.id, 0, { action: "reject", note: "Ineligible" })).ok, true);
  assert.equal((await detail()).lines[0].afterSaleQuantity, 0);
  const closeResult = await operations.updateAfterSale(owner, claim.id, 1, { action: "close", note: "Archive rejected case" });
  assert.equal(closeResult.ok, false, "rejected -> closed must not resurrect its quantity and refund claims");
  assert.equal((await detail()).lines[0].afterSaleQuantity, 0);
  assert.equal((await operations.createAfterSale(owner, number, (await detail()).version, request)).ok, true);
}));

test("independent review: simultaneous return receipts restock exactly once and never mark refunded", async () => isolated(async (database) => {
  await dispatched();
  await operations.createAfterSale(owner, number, (await detail()).version, { kind: "return", reason: "Return",
    lines: [{ sku: "REVIEW-01", quantity: 1 }], amountCents: 1000 });
  const claim = (await detail()).afterSales[0];
  await operations.updateAfterSale(owner, claim.id, 0, { action: "approve", note: "Approved" });
  const result = await Promise.all([operations.updateAfterSale(owner, claim.id, 1, { action: "receive", restock: true, note: "Physical goods verified" }),
    operations.updateAfterSale(owner, claim.id, 1, { action: "receive", restock: true, note: "Concurrent retry" })]);
  assert.equal(result.filter(({ ok }) => ok).length, 1);
  assert.equal(database.prepare("SELECT stock FROM products").get().stock, 1);
  await operations.updateAfterSale(owner, claim.id, 2, { action: "queue_refund", note: "Payment still deferred" });
  assert.equal((await operations.updateAfterSale(owner, claim.id, 3, { action: "close", note: "Pretend refund" })).ok, false);
  assert.equal((await detail()).paymentStatus, "paid");
  assert.equal((await detail()).afterSales[0].status, "refund_pending");
}));

test("independent review: public tracking discloses only allowlisted fields after email match", async () => isolated(async () => {
  await dispatched();
  const response = await tracking.POST(new Request("http://localhost/api/v1/orders/track", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderNumber: number, email: "buyer@example.com" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  for (const field of ["customerEmail", "phone", "postalCode", "shippingAddress", "customerName", "reviewNote", "auditEvents"]) {
    assert.ok(!(field in body.order), field);
  }
}));
