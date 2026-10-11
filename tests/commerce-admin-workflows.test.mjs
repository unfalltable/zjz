import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { test } from "node:test";
import { createDatabase } from "./commerce-db-fixture.mjs";
import { createD1Adapter } from "./commerce-d1-fixture.mjs";
import { env } from "./commerce-test-env.mjs";

register("./commerce-admin-loader.mjs", import.meta.url);
const actions = await import("../backend/backend_web/app/admin-actions.ts");
const productActions = await import("../backend/backend_web/app/actions.ts");
const checkout = await import("../backend/api/services/checkout.ts");
const operations = await import("../backend/api/db/admin-commerce.ts");
const shipping = await import("../backend/api/db/shipping.ts");
const quoteRoute = await import("../backend/api/http/shipping.ts");
const catalogRoute = await import("../backend/api/http/catalog.ts");
const ordersRoute = await import("../backend/backend_web/app/api/admin/orders/route.ts");
const shippingRoute = await import("../backend/backend_web/app/api/admin/shipping/route.ts");

const owner = "workflow-operator";
const idle = { kind: "idle", message: "", eventId: 0 };
function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) for (const item of value) data.append(key, String(item));
    else data.set(key, String(value));
  }
  return data;
}
function productForm(overrides = {}) {
  return form({ mode: "create", sku: "WORKFLOW-01", storefrontId: "workflow-item", name: "Actual Operator Product",
    price: "20.00", compareAt: "", category: "home", image: "/products/kumo.webp", status: "active",
    defaultFulfillment: "self", color: "blue", badge_en: "", badge_zh: "", badge_es: "",
    description_en: "Operator description", description_zh: "商品介绍", description_es: "Descripción",
    detail_en: "Real product details", detail_zh: "商品详情", detail_es: "Detalles",
    shippingWeightGrams: 1250, ...overrides });
}
function carrierForm(overrides = {}) {
  return form({ code: "postal", name: "Actual Postal Carrier", trackingUrlTemplate: "https://tracking.example.com/parcel/{trackingNumber}",
    enabled: "on", expectedVersion: -1, ...overrides });
}
function ruleForm(ruleId, overrides = {}) {
  return form({ id: ruleId, name: "North America", method: "standard", countries: ["US", "CA"], baseCents: 700,
    includedWeightGrams: 500, stepWeightGrams: 500, stepCents: 250, freeAboveCents: 7500,
    minDays: 7, maxDays: 14, carrierCode: "postal", enabled: "on", expectedVersion: -1, ...overrides });
}
function checkoutInput(overrides = {}) {
  return { idempotencyKey: randomUUID(), email: " actual.buyer@example.com ", firstName: "Actual", lastName: "Buyer",
    address: "12 Main Street", apartment: "Unit 2", city: "Toronto", region: "Ontario", postal: "M5V 2T6",
    phone: "+14165550123", destination: "CA", deliveryMethod: "standard", marketingOptIn: false,
    website: "", items: [{ id: "workflow-item", quantity: 2 }], ...overrides };
}
async function isolated(work) {
  const database = createDatabase(); const adapter = createD1Adapter(database);
  env.DB = adapter; env.STORE_OWNER_ID = owner; env.APP_SURFACE = "admin";
  env.TEST_USER = { userId: owner, email: "operator@example.com", displayName: "Actual operator" };
  try { await work(database, adapter); }
  finally { for (const key of ["DB", "STORE_OWNER_ID", "APP_SURFACE", "TEST_USER", "MIOVA_MAINTENANCE"]) delete env[key]; database.close(); }
}
async function succeeded(action, data) {
  const result = await action(idle, data);
  assert.equal(result.kind, "success", result.message);
  return result;
}
async function configuredStore(database) {
  await succeeded(productActions.saveProductAction, productForm());
  let row = database.prepare("SELECT status,stock,version,shipping_weight_grams FROM products WHERE owner_id=?").get(owner);
  assert.equal(row.status, "paused", "new listings must never become available before real inventory is entered");
  assert.equal(row.stock, 0); assert.equal(row.version, 0); assert.equal(row.shipping_weight_grams, 1250);
  await succeeded(productActions.addStockAction, form({ sku: "WORKFLOW-01", quantity: 10, note: "Physically received 10 units" }));
  await succeeded(productActions.saveProductAction, productForm({ mode: "edit", expectedVersion: 1, status: "active" }));
  row = database.prepare("SELECT status,stock,version FROM products WHERE owner_id=?").get(owner);
  assert.equal(row.status, "active"); assert.equal(row.stock, 10); assert.equal(row.version, 2);
  await succeeded(actions.saveCarrierAction, carrierForm());
  const ruleId = randomUUID();
  await succeeded(actions.saveShippingRuleAction, ruleForm(ruleId));
  const settings = await shipping.getShippingSettings(owner);
  assert.equal(settings.rules[0].baseCents, 700);
  assert.deepEqual(settings.rules[0].countries, ["CA", "US"]);
  assert.equal(settings.rules[0].version, 0);
  assert.equal(settings.carriers[0].version, 0);
  return { ruleId, revision: settings.revision };
}
function shipmentForm(number, version, quantity, trackingNumber) {
  return form({ orderNumber: number, expectedVersion: version, fulfillmentMode: "self", carrierCode: "postal",
    trackingNumber, items: JSON.stringify([{ sku: "WORKFLOW-01", quantity }]), note: "Parcel physically handed to carrier" });
}

test("real FormData workflow publishes goods, saves carrier/weight rates, calculates checkout and confirms/cancels an unpaid request", async () => isolated(async (database) => {
  const { revision } = await configuredStore(database);
  const quoteParams = new URLSearchParams({ country: "CA", items: JSON.stringify([{ id: "workflow-item", quantity: 2 }]) });
  const quote = await (await quoteRoute.GET(new Request(`http://localhost/api/v1/shipping?${quoteParams}`))).json();
  assert.equal(quote.subtotalCents, 4000); assert.equal(quote.weightGrams, 2500); assert.equal(quote.quotes[0].shippingCents, 1700);
  assert.equal(quote.revision, revision);
  const saved = await checkout.createPendingOrder(checkoutInput({ shippingRevision: revision }));
  assert.equal(saved.ok, true); assert.equal(saved.totalCents, 5700); assert.equal(saved.paymentStatus, "pending");
  let row = database.prepare("SELECT * FROM orders WHERE owner_id=? AND order_number=?").get(owner, saved.orderNumber);
  assert.equal(row.customer_email, "actual.buyer@example.com"); assert.equal(row.phone, "+14165550123");
  assert.equal(row.postal_code, "M5V 2T6"); assert.match(row.shipping_address, /12 Main Street, Unit 2, Toronto, Ontario, M5V 2T6, Canada/);
  assert.equal(row.shipping_cents, 1700); assert.equal(row.amount_cents, 5700); assert.equal(row.payment_status, "pending");
  assert.deepEqual(JSON.parse(row.line_items_json), [{ sku: "WORKFLOW-01", name: "Actual Operator Product", quantity: 2, priceCents: 2000, fulfillmentMode: "self" }]);
  await succeeded(actions.reviewOrderAction, form({ orderNumber: saved.orderNumber, expectedVersion: 0, decision: "confirm", note: "Recipient verified, still awaiting payment" }));
  let detail = await operations.getAdminOrderDetail(owner, saved.orderNumber);
  assert.equal(detail.reviewStatus, "confirmed"); assert.equal(detail.version, 1); assert.equal(detail.paymentStatus, "pending");
  assert.equal(detail.lines[0].reservedQuantity, 0); assert.equal(database.prepare("SELECT reserved FROM products").get().reserved, 0);
  assert.equal((await actions.createShipmentAction(idle, shipmentForm(saved.orderNumber, 1, 2, "UNPAID-NO-SHIP"))).kind, "error");
  assert.equal(database.prepare("SELECT count(*) AS n FROM shipments").get().n, 0);
  await succeeded(actions.reviewOrderAction, form({ orderNumber: saved.orderNumber, expectedVersion: 1, decision: "cancel", note: "Customer cancelled unpaid request" }));
  detail = await operations.getAdminOrderDetail(owner, saved.orderNumber);
  assert.equal(detail.reviewStatus, "cancelled"); assert.equal(detail.version, 2); assert.equal(detail.paymentStatus, "pending");
  assert.equal(detail.afterSales.length, 0); assert.equal(detail.auditEvents.length, 2);
  row = database.prepare("SELECT stock,reserved FROM products").get(); assert.equal(row.stock, 10); assert.equal(row.reserved, 0);
}));

test("real paid-fixture FormData workflow reserves, splits dispatch, tracks, receives a return and queues an unexecuted refund", async () => isolated(async (database) => {
  const { revision } = await configuredStore(database);
  const saved = await checkout.createPendingOrder(checkoutInput({ shippingRevision: revision, items: [{ id: "workflow-item", quantity: 3 }] }));
  assert.equal(saved.ok, true); assert.equal(saved.totalCents, 8450);
  // Only this isolated test fixture simulates a verified external receipt. The app
  // exposes no manual "mark paid" action while payment integration is suspended.
  database.prepare("UPDATE orders SET payment_status='paid',version=version+1 WHERE owner_id=? AND order_number=?").run(owner, saved.orderNumber);
  await succeeded(actions.reviewOrderAction, form({ orderNumber: saved.orderNumber, expectedVersion: 1, decision: "confirm", note: "Paid fixture recipient verified" }));
  let detail = await operations.getAdminOrderDetail(owner, saved.orderNumber);
  assert.equal(detail.version, 2); assert.equal(detail.lines[0].reservedQuantity, 3);
  assert.equal(database.prepare("SELECT reserved FROM products").get().reserved, 3);
  await succeeded(actions.createShipmentAction, shipmentForm(saved.orderNumber, 2, 2, "WORKFLOW-PARCEL-A"));
  assert.equal((await actions.createShipmentAction(idle, shipmentForm(saved.orderNumber, 2, 1, "STALE-RETRY"))).kind, "error");
  await succeeded(actions.createShipmentAction, shipmentForm(saved.orderNumber, 3, 1, "WORKFLOW-PARCEL-B"));
  detail = await operations.getAdminOrderDetail(owner, saved.orderNumber);
  assert.equal(detail.version, 4); assert.equal(detail.lines[0].shippedQuantity, 3); assert.equal(detail.lines[0].reservedQuantity, 0);
  assert.equal(detail.shipments.length, 2); assert.equal(database.prepare("SELECT stock FROM products").get().stock, 7);
  assert.ok(detail.shipments.every(({ trackingUrl }) => trackingUrl.startsWith("https://tracking.example.com/parcel/WORKFLOW-PARCEL-")));
  for (const item of detail.shipments) {
    await succeeded(actions.updateShipmentAction, form({ shipmentId: item.id, expectedVersion: 0, status: "transit", trackingNumber: `${item.trackingNumber}-FIX`, note: "Carrier website checked manually; corrected waybill" }));
    await succeeded(actions.updateShipmentAction, form({ shipmentId: item.id, expectedVersion: 1, status: "delivered", note: "Delivery evidence verified manually" }));
  }
  detail = await operations.getAdminOrderDetail(owner, saved.orderNumber);
  assert.equal(detail.status, "delivered"); assert.equal(detail.version, 8);
  assert.ok(detail.shipments.every(({ trackingNumber, trackingUrl }) => trackingNumber.endsWith("-FIX") && trackingUrl.endsWith("-FIX")), "actual tracking form must save the correction and regenerate the safe carrier link");
  await succeeded(actions.createAfterSaleAction, form({ orderNumber: saved.orderNumber, expectedVersion: 8, kind: "return",
    reason: "Received wrong color", items: JSON.stringify([{ sku: "WORKFLOW-01", quantity: 1 }]), amountCents: 2000 }));
  detail = await operations.getAdminOrderDetail(owner, saved.orderNumber); const claim = detail.afterSales[0];
  assert.equal(detail.version, 9); assert.equal(claim.amountCents, 2000); assert.equal(claim.lines[0].quantity, 1);
  await succeeded(actions.updateAfterSaleAction, form({ caseId: claim.id, expectedVersion: 0, action: "approve", note: "Return accepted" }));
  await succeeded(actions.updateAfterSaleAction, form({ caseId: claim.id, expectedVersion: 1, action: "receive", restock: "on", note: "One physical unit received and inspected as sellable" }));
  assert.equal(database.prepare("SELECT stock FROM products").get().stock, 8);
  assert.equal((await actions.updateAfterSaleAction(idle, form({ caseId: claim.id, expectedVersion: 1, action: "receive", restock: "on", note: "Duplicate receipt" }))).kind, "error");
  await succeeded(actions.updateAfterSaleAction, form({ caseId: claim.id, expectedVersion: 2, action: "queue_refund", note: "Finance pending until payment qualifications are ready" }));
  assert.equal((await actions.updateAfterSaleAction(idle, form({ caseId: claim.id, expectedVersion: 3, action: "close", note: "Must not pretend refund completed" }))).kind, "error");
  detail = await operations.getAdminOrderDetail(owner, saved.orderNumber);
  assert.equal(detail.version, 12); assert.equal(detail.paymentStatus, "paid"); assert.equal(detail.afterSales[0].status, "refund_pending");
  assert.equal(detail.afterSales[0].restocked, true); assert.equal(detail.afterSales[0].version, 3);
  assert.equal(database.prepare("SELECT count(*) AS n FROM inventory_events").get().n, 4, "one real receipt + two actual dispatches + one verified return");
  assert.equal(database.prepare("SELECT count(*) AS n FROM admin_order_audit").get().n, 11);
  assert.equal(detail.shippingAddress, "12 Main Street, Unit 2, Toronto, Ontario, M5V 2T6, Canada");
}));

test("actual FormData logistics edits use optimistic versions and disabled routes stop checkout", async () => isolated(async (database) => {
  const { ruleId, revision } = await configuredStore(database);
  await succeeded(actions.saveShippingRuleAction, ruleForm(ruleId, { expectedVersion: 0, enabled: "false", baseCents: 900 }));
  assert.equal((await actions.saveShippingRuleAction(idle, ruleForm(ruleId, { expectedVersion: 0, baseCents: 1 }))).kind, "error");
  const settings = await shipping.getShippingSettings(owner);
  assert.equal(settings.rules[0].enabled, false); assert.equal(settings.rules[0].baseCents, 900); assert.equal(settings.rules[0].version, 1);
  assert.notEqual(settings.revision, revision);
  const changed = await checkout.createPendingOrder(checkoutInput({ shippingRevision: revision }));
  assert.equal(changed.code, "shipping_quote_changed"); assert.equal(changed.status, 409);
  const disabled = await checkout.createPendingOrder(checkoutInput({ shippingRevision: settings.revision }));
  assert.equal(disabled.code, "shipping_unavailable"); assert.equal(disabled.status, 422);
  assert.equal(database.prepare("SELECT count(*) AS n FROM orders").get().n, 0);
  await succeeded(actions.saveCarrierAction, carrierForm({ expectedVersion: 0, name: "Renamed real postal carrier" }));
  assert.equal((await actions.saveCarrierAction(idle, carrierForm({ expectedVersion: 0, name: "Stale name" }))).kind, "error");
  assert.equal((await shipping.getShippingSettings(owner)).carriers[0].name, "Renamed real postal carrier");
}));

test("maintenance freezes all real action write boundaries and checkout before DB access while leaving reads available", async () => isolated(async (database, adapter) => {
  const { ruleId, revision } = await configuredStore(database);
  const saved = await checkout.createPendingOrder(checkoutInput({ shippingRevision: revision }));
  assert.equal(saved.ok, true);
  const before = adapter.mutations(); const prepare = adapter.prepare; let databaseAccesses = 0;
  adapter.prepare = (...args) => { databaseAccesses++; return prepare(...args); };
  env.MIOVA_MAINTENANCE = "true";
  const invocations = [
    [productActions.saveProductAction, productForm({ mode: "edit", expectedVersion: 2 })],
    [productActions.addStockAction, form({ sku: "WORKFLOW-01", quantity: 2, note: "Must stay paused" })],
    [productActions.importProductsAction, new FormData()],
    [productActions.updateOrderStatusAction, form({ orderNumber: saved.orderNumber, expectedVersion: 0, status: "purchase" })],
    [actions.reviewOrderAction, form({ orderNumber: saved.orderNumber, expectedVersion: 0, decision: "cancel", note: "Must stay paused" })],
    [actions.createShipmentAction, shipmentForm(saved.orderNumber, 0, 1, "MAINTENANCE-NO-SHIP")],
    [actions.updateShipmentAction, form({ shipmentId: randomUUID(), expectedVersion: 0, status: "transit", note: "Must stay paused" })],
    [actions.createAfterSaleAction, form({ orderNumber: saved.orderNumber, expectedVersion: 0, kind: "return", reason: "Must stay paused", items: JSON.stringify([{ sku: "WORKFLOW-01", quantity: 1 }]), amountCents: 2000 })],
    [actions.updateAfterSaleAction, form({ caseId: randomUUID(), expectedVersion: 0, action: "approve", note: "Must stay paused" })],
    [actions.saveShippingRuleAction, ruleForm(ruleId, { expectedVersion: 0, baseCents: 1 })],
    [actions.saveCarrierAction, carrierForm({ expectedVersion: 0, name: "Must stay paused" })],
  ];
  for (const [action, data] of invocations) assert.equal((await action(idle, data)).kind, "error");
  const blocked = await checkout.createPendingOrder(checkoutInput({ shippingRevision: revision }));
  assert.equal(blocked.status, 503); assert.equal(blocked.code, "maintenance");
  assert.equal(databaseAccesses, 0, "deployment freeze must precede product/order/config reads or writes");
  assert.equal(adapter.mutations(), before);
  assert.equal(database.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
  assert.equal((await ordersRoute.GET(new Request("http://localhost:8081/api/admin/orders"))).status, 200);
  assert.equal((await shippingRoute.GET(new Request("http://localhost:8081/api/admin/shipping"))).status, 200);
  assert.equal((await catalogRoute.GET(new Request("http://localhost/api/v1/catalog"))).status, 200);
  assert.equal(adapter.mutations(), before, "maintenance read routes stay nonmutating");
}));
