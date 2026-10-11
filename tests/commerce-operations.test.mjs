import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { createDatabase, insertOrder, insertProduct } from "./commerce-db-fixture.mjs";
import { createD1Adapter } from "./commerce-d1-fixture.mjs";
import { env } from "./commerce-test-env.mjs";
import { createSqliteD1 } from "../backend/api/runtime/selfhost/db.mjs";

register("./commerce-module-loader.mjs", import.meta.url);
const api = await import("../backend/api/db/admin-commerce.ts");
const { getPublicFulfillment } = await import("../backend/api/db/public-fulfillment.ts");
const { POST: trackingPost } = await import("../backend/api/http/tracking.ts");
const { lookupOrderAction } = await import("../web/app/track/actions.ts");
const owner = "store-one";
const lines = [{ sku: "REAL-01", name: "Real item", quantity: 3, priceCents: 1000, fulfillmentMode: "self" }, { sku: "REAL-02", name: "Supplier item", quantity: 2, priceCents: 2000, fulfillmentMode: "supplier" }];
function setup(database, overrides = {}) {
  insertProduct(database, { stock: 20, reserved: 0, version: 0, status: "active" });
  insertProduct(database, { id: "product-two", sku: "REAL-02", stock: 10, reserved: 0, version: 0, status: "active", default_fulfillment: "supplier" });
  insertOrder(database, { amount_cents: 7900, shipping_cents: 900, shipping_address: "1 Real Street, London, GB", phone: "+441234567890", postal_code: "SW1A1AA", delivery_method: "standard", line_items_json: JSON.stringify(lines), ...overrides });
  database.prepare(`INSERT INTO shipping_carriers(owner_id,code,name,tracking_url_template,enabled,version,updated_at) VALUES(?,'dhl','DHL','https://www.dhl.com/track?tracking-id={trackingNumber}',1,0,'2026-10-11')`).run(owner);
}
async function isolated(work, overrides = {}) {
  const database = createDatabase(); const d1 = createD1Adapter(database); env.DB = d1; env.STORE_OWNER_ID = owner;
  try { setup(database, overrides); return await work(database, d1); }
  finally { delete env.DB; delete env.STORE_OWNER_ID; database.close(); }
}
const number = "MW-TEST1";
const detail = () => api.getAdminOrderDetail(owner, number);
const stock = (database, sku = "REAL-01") => database.prepare("SELECT stock,reserved,version FROM products WHERE owner_id=? AND sku=?").get(owner, sku);
const ship = (version, overrides = {}) => api.createShipment(owner, number, version, { fulfillmentMode: "self", carrierCode: "dhl", trackingNumber: "TRACK-1", lines: [{ sku: "REAL-01", quantity: 2 }], note: "Handed to carrier", ...overrides });
async function confirm() { assert.equal((await api.reviewOrder(owner, number, (await detail()).version, "confirm", "Address verified")).ok, true); }
async function fullDispatch() {
  await confirm(); assert.equal((await ship((await detail()).version, { lines: [{ sku: "REAL-01", quantity: 3 }] })).ok, true);
  assert.equal((await ship((await detail()).version, { fulfillmentMode: "supplier", trackingNumber: "TRACK-2", lines: [{ sku: "REAL-02", quantity: 2 }] })).ok, true);
}

test("admin order pages and details are owner-scoped, literal searched, full-history and read-only", async () => isolated(async (database, d1) => {
  for (let index = 0; index < 231; index++) insertOrder(database, { id: `order-${index}`, order_number: `OLD-${index}`, idempotency_key: `key-${index}`, customer_name: index === 0 ? "100%_Buyer" : "Other", created_at: "2025-01-01", line_items_json: JSON.stringify(lines) });
  insertOrder(database, { id: "other-owner", owner_id: "another-store", order_number: "PRIVATE", line_items_json: JSON.stringify(lines) });
  const page = await api.getAdminOrders(owner, "", 12); assert.equal(page.total, 232); assert.equal(page.orders.length, 12);
  assert.deepEqual((await api.getAdminOrders(owner, "%_")).orders.map((order) => order.customerName), ["100%_Buyer"]);
  assert.equal((await api.getAdminOrders(owner, "' OR 1=1 --")).total, 0);
  assert.equal(await api.getAdminOrderDetail("another-store", number), null);
  const order = await detail(); assert.equal(order.shippingAddress, "1 Real Street, London, GB"); assert.equal(order.customerEmail, "buyer@example.com"); assert.equal(order.lines.length, 2);
  assert.equal(d1.mutations(), 0); assert.equal(database.prepare("SELECT count(*) AS count FROM admin_order_audit").get().count, 0);
}));

test("confirming unpaid requests validates details without payment, reservation or shipment", async () => isolated(async (database) => {
  assert.equal((await api.reviewOrder(owner, number, 0, "confirm", "Checked recipient")).ok, true);
  const order = await detail(); assert.equal(order.reviewStatus, "confirmed"); assert.equal(order.paymentStatus, "pending"); assert.equal(order.version, 1);
  assert.equal(stock(database).reserved, 0); assert.equal(order.lines[0].reservedQuantity, 0);
  assert.equal((await ship(order.version)).code, "payment_required"); assert.equal((await api.createAfterSale(owner, number, order.version, { kind: "refund", reason: "Changed mind", lines: [{ sku: "REAL-01", quantity: 1 }], amountCents: 1000 })).code, "payment_required");
}, { payment_status: "pending", status: "payment_pending" }));

test("pending cancellation records reason, never marks refunded and cannot be reopened", async () => isolated(async (database) => {
  assert.equal((await api.reviewOrder(owner, number, 0, "cancel", "Customer cancelled")).ok, true);
  const order = await detail(); assert.equal(order.reviewStatus, "cancelled"); assert.equal(order.paymentStatus, "pending"); assert.equal(order.afterSales.length, 0); assert.equal(stock(database).reserved, 0);
  assert.equal((await api.reviewOrder(owner, number, order.version, "confirm", "" )).code, "cancelled");
}, { payment_status: "pending" }));

test("paid confirmation atomically reserves every item once without reducing physical stock", async () => isolated(async (database) => {
  await confirm(); const order = await detail(); assert.equal(order.reviewStatus, "confirmed"); assert.deepEqual(order.lines.map((line) => line.reservedQuantity), [3, 2]);
  assert.equal(stock(database).stock, 20); assert.equal(stock(database).reserved, 3); assert.equal(stock(database, "REAL-02").reserved, 2);
  assert.equal((await api.reviewOrder(owner, number, order.version, "confirm", "retry")).ok, true); assert.equal((await detail()).version, order.version); assert.equal(stock(database).reserved, 3);
  assert.equal((await api.reviewOrder(owner, number, 0, "confirm", "stale")).code, "conflict");
  assert.equal(database.prepare("SELECT count(*) AS count FROM admin_operation_guards").get().count, 0);
}));

test("insufficient stock on a later line leaves all earlier reservations and audit untouched", async () => isolated(async (database) => {
  database.prepare("UPDATE products SET stock=1 WHERE sku='REAL-02'").run();
  assert.equal((await api.reviewOrder(owner, number, 0, "confirm", "" )).code, "insufficient_stock");
  assert.equal(stock(database).reserved, 0); assert.equal((await detail()).version, 0); assert.equal(database.prepare("SELECT count(*) AS count FROM order_reservations").get().count, 0);
}));

test("paid cancellation releases reservations but creates only an unexecuted refund request", async () => isolated(async (database) => {
  await confirm(); assert.equal((await api.reviewOrder(owner, number, 1, "cancel", "Customer requested cancellation")).ok, true);
  const order = await detail(); assert.equal(stock(database).reserved, 0); assert.equal(stock(database).stock, 20); assert.equal(order.paymentStatus, "paid"); assert.equal(order.reviewStatus, "cancelled");
  assert.equal(order.afterSales[0].status, "refund_pending"); assert.equal(order.afterSales[0].amountCents, 7900); assert.equal((await ship(order.version)).code, "confirmation_required");
  assert.equal((await api.updateAfterSale(owner, order.afterSales[0].id, 0, { action: "close", note: "Pretend refunded" })).code, "invalid_transition");
}));

test("a preconfirmed pending order can reserve only after a separately verified paid status", async () => isolated(async (database) => {
  assert.equal((await api.reviewOrder(owner, number, 0, "confirm", "" )).ok, true); assert.equal(stock(database).reserved, 0);
  database.prepare("UPDATE orders SET payment_status='paid',version=version+1 WHERE owner_id=?").run(owner);
  assert.equal((await api.reviewOrder(owner, number, 2, "confirm", "Verified callback preexisting payment")).ok, true); assert.equal(stock(database).reserved, 3);
}, { payment_status: "pending", status: "payment_pending" }));

test("actual split dispatch requires paid confirmed reserved stock, a route and enabled carrier", async () => isolated(async (database) => {
  assert.equal((await ship(0)).code, "confirmation_required"); await confirm();
  assert.equal((await ship(1, { carrierCode: "UNKNOWN" })).code, "carrier_unavailable");
  assert.equal((await ship(1, { fulfillmentMode: "supplier" })).code, "invalid_route");
  assert.equal((await ship(1, { lines: [{ sku: "REAL-01", quantity: 4 }] })).code, "insufficient_reserved_stock");
  assert.equal((await ship(1, { trackingUrl: "javascript:alert(1)" })).ok, true);
  const order = await detail(); assert.equal(order.shipments.length, 1); assert.equal(order.shipments[0].trackingUrl, "https://www.dhl.com/track?tracking-id=TRACK-1");
  assert.equal(stock(database).stock, 18); assert.equal(stock(database).reserved, 1); assert.equal(order.lines[0].shippedQuantity, 2); assert.equal(order.lines[1].reservedQuantity, 2);
  assert.equal((await ship(1)).code, "conflict"); assert.equal((await api.reviewOrder(owner, number, order.version, "cancel", "too late")).code, "already_shipped");
}));

test("duplicate waybills roll back stock deduction, reservations, order versions and audit", async () => isolated(async (database) => {
  await confirm(); assert.equal((await ship(1)).ok, true); const before = stock(database); const order = await detail();
  const result = await ship(order.version, { lines: [{ sku: "REAL-01", quantity: 1 }] }); assert.equal(result.ok, false); assert.deepEqual(stock(database), before); assert.equal((await detail()).version, order.version); assert.equal((await detail()).shipments.length, 1);
  assert.equal((await ship(order.version, { trackingNumber: "TRACK-3", lines: [{ sku: "REAL-01", quantity: 1 }] })).ok, true); assert.equal(stock(database).stock, 17); assert.equal(stock(database).reserved, 0);
}));

test("manual tracking advances packages independently; the order completes only after all quantities and packages", async () => isolated(async (database) => {
  await fullDispatch(); let order = await detail(); const one = order.shipments.find((entry) => entry.fulfillmentMode === "self"); const two = order.shipments.find((entry) => entry.fulfillmentMode === "supplier");
  const originalStock = stock(database).stock;
  assert.equal((await api.updateShipment(owner, one.id, 0, { status: "delivered", note: "Skip" })).code, "invalid_transition");
  assert.equal((await api.updateShipment(owner, one.id, 0, { status: "transit", note: "Carrier website checked" })).ok, true);
  assert.equal((await api.updateShipment(owner, one.id, 1, { status: "delivered", note: "Delivery verified" })).ok, true); assert.equal((await detail()).status, "handoff");
  assert.equal((await api.updateShipment(owner, two.id, 0, { status: "transit", note: "Manual verified" })).ok, true); assert.equal((await detail()).status, "transit");
  assert.equal((await api.updateShipment(owner, two.id, 1, { status: "delivered", note: "Manual delivered" })).ok, true); assert.equal((await detail()).status, "delivered"); assert.equal(stock(database).stock, originalStock);
  assert.ok((await detail()).auditEvents.some((entry) => JSON.parse(entry.details).source === "manual"));
}));

test("payment and inventory races between read and batch are checked inside SQL and cannot partially dispatch", async () => isolated(async (database, d1) => {
  await confirm(); const batch = d1.batch; let race = true;
  d1.batch = async (statements) => { if (race) { race = false; database.prepare("UPDATE orders SET payment_status='pending' WHERE owner_id=?").run(owner); } return batch(statements); };
  const before = stock(database); assert.equal((await ship(1)).code, "conflict"); assert.deepEqual(stock(database), before); assert.equal((await detail()).shipments.length, 0);
}));

test("inventory races roll back complete reservations and audit", async () => isolated(async (database, d1) => {
  const batch = d1.batch; d1.batch = async (statements) => { database.prepare("UPDATE products SET reserved=stock,version=version+1 WHERE sku='REAL-02'").run(); return batch(statements); };
  assert.equal((await api.reviewOrder(owner, number, 0, "confirm", "" )).code, "conflict"); assert.equal(stock(database).reserved, 0); assert.equal((await detail()).reviewStatus, "unreviewed"); assert.equal((await detail()).auditEvents.length, 0);
}));

test("an audit insert failure rolls back dispatch and stock completely", async () => isolated(async (database) => {
  await confirm(); database.exec("CREATE TRIGGER fail_admin_audit BEFORE INSERT ON admin_order_audit BEGIN SELECT RAISE(ABORT,'audit_failure'); END;");
  const before = stock(database); await assert.rejects(ship(1), /audit_failure/); assert.deepEqual(stock(database), before); assert.equal((await detail()).shipments.length, 0); assert.equal((await detail()).version, 1);
}));

test("after-sale intake limits quantity and amount to unclaimed dispatched merchandise", async () => isolated(async () => {
  await fullDispatch(); let order = await detail();
  assert.equal((await api.createAfterSale(owner, number, order.version, { kind: "return", reason: "Damaged", lines: [{ sku: "REAL-01", quantity: 4 }], amountCents: 1000 })).code, "quantity_exceeded");
  assert.equal((await api.createAfterSale(owner, number, order.version, { kind: "return", reason: "Damaged", lines: [{ sku: "REAL-01", quantity: 1 }], amountCents: 1001 })).code, "amount_exceeded");
  assert.equal((await api.createAfterSale(owner, number, order.version, { kind: "return", reason: "Damaged", lines: [{ sku: "REAL-01", quantity: 1 }], amountCents: 1000 })).ok, true); order = await detail();
  assert.equal((await api.createAfterSale(owner, number, order.version, { kind: "refund", reason: "Other", lines: [{ sku: "REAL-01", quantity: 3 }], amountCents: 3000 })).code, "quantity_exceeded");
  assert.equal(order.lines[0].afterSaleQuantity, 1); assert.equal(order.paymentStatus, "paid");
  const page = await api.getAdminAfterSales(owner, "Damaged", 1); assert.equal(page.total, 1); assert.equal((await api.getAdminAfterSales("other")).total, 0);
}));

test("returns require approval and verified receipt, restock once, and queue refunds without payment execution", async () => isolated(async (database) => {
  await fullDispatch(); let order = await detail(); assert.equal((await api.createAfterSale(owner, number, order.version, { kind: "return", reason: "Damaged", lines: [{ sku: "REAL-01", quantity: 1 }], amountCents: 1000 })).ok, true);
  const item = (await detail()).afterSales[0]; const before = stock(database).stock;
  assert.equal((await api.updateAfterSale(owner, item.id, 0, { action: "receive", note: "Premature", restock: true })).code, "invalid_transition");
  assert.equal((await api.updateAfterSale(owner, item.id, 0, { action: "approve", note: "Request accepted" })).ok, true);
  assert.equal((await api.updateAfterSale(owner, item.id, 1, { action: "receive", note: "Physically received and sellable", restock: true })).ok, true); assert.equal(stock(database).stock, before + 1);
  assert.equal((await api.updateAfterSale(owner, item.id, 1, { action: "receive", note: "duplicate", restock: true })).code, "conflict");
  assert.equal((await api.updateAfterSale(owner, item.id, 2, { action: "receive", note: "duplicate", restock: true })).code, "invalid_transition");
  assert.equal((await api.updateAfterSale(owner, item.id, 2, { action: "queue_refund", note: "Finance review required" })).ok, true);
  assert.equal((await api.updateAfterSale(owner, item.id, 3, { action: "close", note: "fake refund" })).code, "invalid_transition");
  order = await detail(); assert.equal(order.paymentStatus, "paid"); assert.equal(order.afterSales[0].status, "refund_pending"); assert.equal(order.afterSales[0].restocked, true);
}));

test("rejected claims release quantities; receipt without restock does not invent stock", async () => isolated(async (database) => {
  await fullDispatch(); let order = await detail(); const input = { kind: "return", reason: "Inspect", lines: [{ sku: "REAL-01", quantity: 3 }], amountCents: 0 };
  assert.equal((await api.createAfterSale(owner, number, order.version, input)).ok, true); let item = (await detail()).afterSales[0];
  assert.equal((await api.updateAfterSale(owner, item.id, 0, { action: "reject", note: "Not eligible" })).ok, true);
  assert.equal((await api.updateAfterSale(owner, item.id, 1, { action: "close", note: "Rejected stays terminal" })).code, "invalid_transition");
  assert.equal((await detail()).lines[0].afterSaleQuantity, 0); order = await detail(); assert.equal((await api.createAfterSale(owner, number, order.version, input)).ok, true);
  item = (await detail()).afterSales.find((entry) => entry.status === "requested"); assert.equal((await api.updateAfterSale(owner, item.id, 0, { action: "approve", note: "Approved" })).ok, true);
  const before = stock(database).stock; assert.equal((await api.updateAfterSale(owner, item.id, 1, { action: "receive", note: "Goods defective, do not resell", restock: false })).ok, true); assert.equal(stock(database).stock, before);
  assert.equal((await api.updateAfterSale(owner, item.id, 2, { action: "close", note: "No refund, goods inspected" })).ok, true);
}));

test("concurrent after-sale claims cannot exceed shipped quantities", async () => isolated(async () => {
  await fullDispatch(); const version = (await detail()).version;
  const input = { kind: "refund", reason: "Refund request", lines: [{ sku: "REAL-01", quantity: 2 }], amountCents: 2000 };
  const results = await Promise.all([api.createAfterSale(owner, number, version, input), api.createAfterSale(owner, number, version, input)]);
  assert.equal(results.filter((result) => result.ok).length, 1); assert.equal((await detail()).afterSales.length, 1);
}));

test("malformed, cross-owner, legacy-incomplete and unsafe requests never modify stock", async () => isolated(async (database) => {
  assert.equal((await api.reviewOrder("wrong-owner", number, 0, "confirm", "" )).code, "not_found");
  assert.equal((await api.reviewOrder(owner, number, -1, "confirm", "" )).code, "invalid_input");
  assert.equal((await api.reviewOrder(owner, number, 0, "cancel", "" )).code, "invalid_input");
  database.prepare("UPDATE orders SET shipping_address=NULL").run(); assert.equal((await api.reviewOrder(owner, number, 0, "confirm", "" )).code, "incomplete_address");
  database.prepare("UPDATE orders SET shipping_address='Real',line_items_json='invalid'").run(); assert.equal((await api.reviewOrder(owner, number, 0, "confirm", "" )).code, "invalid_order_lines");
  assert.equal(stock(database).reserved, 0);
}));

test("public tracking requires the checkout email and exposes manual package milestones but no PII or staff notes", async () => isolated(async (database) => {
  await confirm(); assert.equal((await ship(1, { note: "Private supplier cost and packing instructions" })).ok, true);
  const publicData = await getPublicFulfillment(owner, number); assert.equal(publicData.reviewStatus, "confirmed"); assert.equal(publicData.shipments[0].source, "manual");
  assert.deepEqual(Object.keys(publicData.shipments[0]).sort(), ["carrierName", "createdAt", "source", "status", "trackingNumber", "trackingUrl", "updatedAt"]);
  assert.deepEqual(await getPublicFulfillment("other-owner", number), { reviewStatus: "unreviewed", shipments: [] });
  database.prepare("UPDATE orders SET order_number='MW-12345678' WHERE owner_id=?").run(owner);
  const request = (email) => new Request("https://store.example/api/v1/tracking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderNumber: "MW-12345678", email }) });
  assert.equal((await trackingPost(request("intruder@example.com"))).status, 404);
  const response = await trackingPost(request("BUYER@example.com")); assert.equal(response.status, 200); const body = await response.json();
  const payload = JSON.stringify(body); assert.equal(body.order.shipments[0].carrierName, "DHL");
  for (const privateText of ["buyer@example.com", "1 Real Street", "+441234567890", "SW1A1AA", "Private supplier cost", "staff", "actorId"]) assert.equal(payload.includes(privateText), false, privateText);
  const form = new FormData(); form.set("orderNumber", "MW-12345678"); form.set("email", "buyer@example.com");
  const action = await lookupOrderAction({ kind: "idle", message: "", order: null }, form); assert.equal(action.kind, "found"); assert.equal(action.order.shipments[0].source, "manual"); assert.equal(JSON.stringify(action).includes("buyer@example.com"), false);
}));

test("public tracking surfaces cancelled pending requests without inventing dispatch or payment", async () => isolated(async (database) => {
  assert.equal((await api.reviewOrder(owner, number, 0, "cancel", "Customer requested cancellation")).ok, true);
  database.prepare("UPDATE orders SET order_number='MW-12345678' WHERE owner_id=?").run(owner);
  const response = await trackingPost(new Request("https://store.example/api/v1/tracking", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderNumber: "MW-12345678", email: "buyer@example.com" }) }));
  assert.equal(response.status, 200); const { order } = await response.json(); assert.equal(order.reviewStatus, "cancelled"); assert.equal(order.paymentStatus, "pending"); assert.deepEqual(order.shipments, []); assert.equal(JSON.stringify(order).includes("Customer requested cancellation"), false);
}, { payment_status: "pending", status: "payment_pending" }));

test("the deployed SQLite D1 adapter executes the complete reservation, split dispatch, tracking and return transaction", async () => {
  const database = createDatabase(); const d1 = createSqliteD1(database); env.DB = d1; env.STORE_OWNER_ID = owner;
  try {
    setup(database); await fullDispatch(); let order = await detail(); assert.equal(order.shipments.length, 2); assert.equal(stock(database).stock, 17); assert.equal(stock(database, "REAL-02").stock, 8);
    const packageOne = order.shipments[0]; assert.equal((await api.updateShipment(owner, packageOne.id, 0, { status: "transit", note: "Confirmed via carrier" })).ok, true);
    order = await detail(); assert.equal((await api.createAfterSale(owner, number, order.version, { kind: "return", reason: "Verified return", lines: [{ sku: "REAL-01", quantity: 1 }], amountCents: 1000 })).ok, true);
    const claim = (await detail()).afterSales[0]; assert.equal((await api.updateAfterSale(owner, claim.id, 0, { action: "approve", note: "Accepted" })).ok, true);
    assert.equal((await api.updateAfterSale(owner, claim.id, 1, { action: "receive", note: "Physically received and inspected", restock: true })).ok, true); assert.equal(stock(database).stock, 18);
    assert.equal((await api.updateAfterSale(owner, claim.id, 2, { action: "queue_refund", note: "Await payment qualification" })).ok, true); assert.equal((await detail()).paymentStatus, "paid");
    assert.equal(database.prepare("PRAGMA quick_check").get().quick_check, "ok"); assert.equal(database.prepare("SELECT count(*) AS count FROM admin_operation_guards").get().count, 0);
  } finally { delete env.DB; delete env.STORE_OWNER_ID; d1.close(); }
});

test("the deployed adapter rolls back a duplicate shipment after all stock mutation statements", async () => {
  const database = createDatabase(); const d1 = createSqliteD1(database); env.DB = d1; env.STORE_OWNER_ID = owner;
  try {
    setup(database); await confirm(); assert.equal((await ship(1)).ok, true); const before = stock(database); const order = await detail();
    assert.equal((await ship(order.version, { lines: [{ sku: "REAL-01", quantity: 1 }] })).code, "conflict"); assert.deepEqual(stock(database), before);
    assert.equal((await detail()).version, order.version); assert.equal((await detail()).shipments.length, 1); assert.equal(database.prepare("SELECT count(*) AS count FROM admin_operation_guards").get().count, 0);
  } finally { delete env.DB; delete env.STORE_OWNER_ID; d1.close(); }
});
