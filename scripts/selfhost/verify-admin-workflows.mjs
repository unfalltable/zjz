import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { encodeReply } from "react-server-dom-webpack/client.node";
import { openSqliteD1 } from "../../backend/api/runtime/selfhost/db.mjs";
import { migrateSelfhostDatabase } from "../../backend/api/runtime/selfhost/migrate.mjs";
import { insertOrder, insertProduct } from "../../tests/commerce-db-fixture.mjs";

// Run after build:selfhost. This tests the real production Flight/Server Action
// boundary, not mocks or a public deployment. It creates its own temporary DB.
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = mkdtempSync(path.join(tmpdir(), "miova-admin-wire-"));
const filename = path.join(directory, "commerce.sqlite");
const built = path.join(root, "backend/backend_web/dist-node/server/_next/static");
const owner = "production-wire-fixture-owner";
const username = "wire-fixture-admin";
const password = randomBytes(32).toString("hex");
const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
const idle = { kind: "idle", message: "", eventId: 0 };
let child; let reader; let logs = "";
const deadline = new AbortController();
const overallTimeout = setTimeout(() => deadline.abort(new Error("Production administration workflow verification exceeded its 120-second deadline.")), 120_000);

function withinDeadline(promise) {
  deadline.signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(deadline.signal.reason);
    deadline.signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => deadline.signal.removeEventListener("abort", onAbort));
}
async function request(url, options = {}, timeoutMs = 15_000) {
  deadline.signal.throwIfAborted();
  // Keep the same signal active until the entire body is read, not just headers.
  const signal = AbortSignal.any([deadline.signal, AbortSignal.timeout(timeoutMs)]);
  const response = await fetch(url, { ...options, signal });
  const body = await response.text();
  return { status: response.status, headers: response.headers, body };
}

function data(values) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach((item) => form.append(key, String(item)));
    else form.set(key, String(value));
  }
  return form;
}
async function unusedPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
function setup() {
  const adapter = openSqliteD1(filename);
  try {
    migrateSelfhostDatabase(adapter);
    insertProduct(adapter.database, { owner_id: owner, id: "wire-product", sku: "WIRE-01", name: "Wire desk organizer",
      storefront_id: "wire-organizer", category: "home", image: "/products/kumo.webp", price_cents: 2000,
      stock: 20, reserved: 0, shipping_weight_grams: 1250, status: "active" });
    insertProduct(adapter.database, { owner_id: owner, id: "wire-product-two", sku: "WIRE-02", name: "Wire travel pouch",
      storefront_id: "wire-pouch", category: "wear", image: "/products/loop.webp", price_cents: 1000,
      stock: 30, reserved: 0, shipping_weight_grams: 300, default_fulfillment: "supplier", status: "active" });
    const lines = [{ sku: "WIRE-01", name: "Wire desk organizer", quantity: 3, priceCents: 2000, fulfillmentMode: "self" },
      { sku: "WIRE-02", name: "Wire travel pouch", quantity: 2, priceCents: 1000, fulfillmentMode: "supplier" }];
    for (const [index, payment] of ["pending", "paid"].entries()) insertOrder(adapter.database, {
      owner_id: owner, id: `wire-order-${index}`, order_number: `MW-0000${index + 1}`, idempotency_key: `wire-key-${index}`,
      customer_email: "wire-buyer@example.com", phone: "+15555550123", postal_code: "10001",
      shipping_address: "1 Fixture Street, New York, NY, 10001, US", line_items_json: JSON.stringify(lines),
      delivery_method: "standard", amount_cents: 8900, shipping_cents: 900, payment_status: payment,
      status: payment === "pending" ? "payment_pending" : "purchase",
    });
  } finally { adapter.close(); }
}

try {
  await withinDeadline((async () => {
  assert.ok(existsSync(built), "Build the standalone administration surface before this wire test.");
  const actionFile = readdirSync(built).find((name) => /^admin-actions-[^/]+\.js$/.test(name));
  assert.ok(actionFile, "The production bundle must include its own Server Action references.");
  const source = readFileSync(path.join(built, actionFile), "utf8");
  const moduleId = source.match(/,\s*[`"]([a-f0-9]+)[`"],\s*[`"]reviewOrderAction[`"]/)?.[1];
  assert.ok(moduleId, "Read the Server Action module ID from the current built references, never hardcode it.");
  setup();
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const origin = base;
  const trustedHost = new URL(base).host;
  child = spawn(process.execPath, ["scripts/selfhost/start.mjs", "--surface", "admin"], { cwd: root,
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, PORT: String(port), STORE_OWNER_ID: owner, MIOVA_SQLITE_PATH: filename,
      STOREFRONT_URL: "https://150.158.141.45", MIOVA_MAINTENANCE: "false", MIOVA_ADMIN_USERNAME: username,
      MIOVA_ADMIN_EMAIL: "wire-admin@example.test", MIOVA_ADMIN_PASSWORD_SHA256: createHash("sha256").update(password).digest("hex") },
  });
  child.once("error", (error) => deadline.abort(error));
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-20_000); });
  const headers = { Host: trustedHost, Authorization: auth };
  let ready = false;
  for (let attempt = 0; attempt < 75; attempt++) {
    if (child.exitCode !== null) throw new Error(`Production fixture exited: ${logs}`);
    try { if ((await request(`${base}/ops`, { headers }, 5000)).status === 200) { ready = true; break; } } catch { deadline.signal.throwIfAborted(); /* starting */ }
    await delay(200, undefined, { signal: deadline.signal });
  }
  assert.ok(ready, `Production administration fixture did not become ready: ${logs}`);
  reader = new DatabaseSync(filename, { readOnly: true });
  const row = (number) => reader.prepare("SELECT * FROM orders WHERE owner_id=? AND order_number=?").get(owner, number);
  const stock = () => reader.prepare("SELECT stock,reserved FROM products WHERE owner_id=? AND sku='WIRE-01'").get(owner);
  const auditCount = () => reader.prepare("SELECT count(*) AS n FROM admin_order_audit").get().n;
  async function action(name, form, expectedKind = "success", additionalHeaders = {}) {
    const response = await request(`${base}/ops`, { method: "POST", headers: {
      ...headers, Origin: origin, Accept: "text/x-component", "Next-Action": `${moduleId}#${name}`, ...additionalHeaders,
    }, body: await encodeReply([idle, form]) });
    const text = response.body;
    assert.equal(response.status, 200, `${name}: ${text.slice(0, 1500)}`);
    assert.match(response.headers.get("content-type") ?? "", /text\/x-component/);
    assert.doesNotMatch(text, /(?:^|\n)[0-9a-f]+:E\{/, `${name} must not serialize an RSC error/digest`);
    const rootRow = text.split("\n").find((line) => line.startsWith("0:{"));
    assert.ok(rootRow, `${name} must return a Flight root model`);
    const model = JSON.parse(rootRow.slice(2));
    assert.equal(model.returnValue?.ok, true, `${name}: ${rootRow}`);
    assert.equal(model.returnValue.data.kind, expectedKind, `${name}: ${JSON.stringify(model.returnValue.data)}`);
    const reload = await request(`${base}/ops`, { headers });
    assert.equal(reload.status, 200, `${name}: a real HTML reload must remain healthy after audit rows are written`);
    return model.returnValue.data;
  }
  const ruleId = randomUUID();
  await action("saveCarrierAction", data({ code: "postal", name: "Fixture Postal", trackingUrlTemplate: "https://tracking.example.com/{trackingNumber}", expectedVersion: -1, enabled: "on" }));
  await action("saveShippingRuleAction", data({ id: ruleId, name: "Fixture North America", method: "standard", countries: ["US", "CA"],
    baseCents: 700, includedWeightGrams: 500, stepWeightGrams: 500, stepCents: 250, freeAboveCents: 7500,
    minDays: 7, maxDays: 14, carrierCode: "postal", enabled: "on", expectedVersion: -1 }));
  assert.equal(reader.prepare("SELECT count(*) AS n FROM shipping_rule_countries").get().n, 2);
  const initialAudit = auditCount();
  const forbidden = await request(`${base}/ops`, { method: "POST", headers: {
    ...headers, Origin: "https://untrusted.example", "Next-Action": `${moduleId}#reviewOrderAction`,
  }, body: await encodeReply([idle, data({ orderNumber: "MW-00001", expectedVersion: 0, decision: "cancel", note: "CSRF must fail" })]) });
  assert.equal(forbidden.status, 403);
  assert.equal(auditCount(), initialAudit);
  await action("reviewOrderAction", data({ orderNumber: "MW-00001", expectedVersion: 0, decision: "cancel", note: "Authentication must fail" }), "error", { Authorization: "" });
  assert.equal(auditCount(), initialAudit); assert.equal(row("MW-00001").version, 0);
  assert.equal((await request(`${base}/api/admin/orders`, { headers: { Host: trustedHost } })).status, 401);

  await action("reviewOrderAction", data({ orderNumber: "MW-00001", expectedVersion: 0, decision: "confirm", note: "Pending recipient checked" }));
  assert.equal(row("MW-00001").review_status, "confirmed"); assert.equal(stock().reserved, 0);
  await action("createShipmentAction", data({ orderNumber: "MW-00001", expectedVersion: 1, fulfillmentMode: "self", carrierCode: "postal", trackingNumber: "UNPAID-MUST-NOT-SHIP", items: JSON.stringify([{ sku: "WIRE-01", quantity: 1 }]) }), "error");
  await action("reviewOrderAction", data({ orderNumber: "MW-00001", expectedVersion: 1, decision: "cancel", note: "Pending request cancelled" }));
  assert.equal(row("MW-00001").review_status, "cancelled"); assert.equal(row("MW-00001").payment_status, "pending");

  await action("reviewOrderAction", data({ orderNumber: "MW-00002", expectedVersion: 0, decision: "confirm", note: "Existing paid fixture checked" }));
  assert.equal(stock().reserved, 3);
  for (const [index, [mode, sku, quantity]] of [["self", "WIRE-01", 2], ["self", "WIRE-01", 1], ["supplier", "WIRE-02", 2]].entries()) {
    await action("createShipmentAction", data({ orderNumber: "MW-00002", expectedVersion: index + 1, fulfillmentMode: mode, carrierCode: "postal", trackingNumber: `WIRE-PARCEL-${index}`, items: JSON.stringify([{ sku, quantity }]), note: "Actual fixture carrier handoff" }));
  }
  assert.equal(stock().stock, 17); assert.equal(stock().reserved, 0);
  const packages = reader.prepare("SELECT * FROM shipments ORDER BY tracking_number").all();
  assert.equal(packages.length, 3);
  for (const item of packages) {
    await action("updateShipmentAction", data({ shipmentId: item.id, expectedVersion: 0, status: "transit", note: "Manually verified in transit" }));
    await action("updateShipmentAction", data({ shipmentId: item.id, expectedVersion: 1, status: "delivered", note: "Manually verified delivery" }));
  }
  assert.equal(row("MW-00002").status, "delivered");
  await action("createAfterSaleAction", data({ orderNumber: "MW-00002", expectedVersion: row("MW-00002").version, kind: "return", reason: "Fixture color mismatch", items: JSON.stringify([{ sku: "WIRE-01", quantity: 1 }]), amountCents: 2000 }));
  const claim = reader.prepare("SELECT * FROM after_sales").get();
  await action("updateAfterSaleAction", data({ caseId: claim.id, expectedVersion: 0, action: "approve", note: "Return approved" }));
  await action("updateAfterSaleAction", data({ caseId: claim.id, expectedVersion: 1, action: "receive", restock: "on", note: "One physically received fixture item" }));
  await action("updateAfterSaleAction", data({ caseId: claim.id, expectedVersion: 2, action: "queue_refund", note: "Payment integration remains disabled" }));
  await action("updateAfterSaleAction", data({ caseId: claim.id, expectedVersion: 3, action: "close", note: "Must not claim refund completed" }), "error");
  assert.equal(stock().stock, 18); assert.equal(row("MW-00002").payment_status, "paid");
  const afterSale = reader.prepare("SELECT * FROM after_sales").get();
  assert.equal(afterSale.status, "refund_pending"); assert.equal(afterSale.restocked, 1); assert.equal(afterSale.amount_cents, 2000);
  assert.equal(row("MW-00002").shipping_address, "1 Fixture Street, New York, NY, 10001, US");
  const detailResponse = await request(`${base}/api/admin/orders/MW-00002`, { headers });
  assert.equal(detailResponse.status, 200); assert.equal(JSON.parse(detailResponse.body).order.shipments.length, 3);
  })());
} catch (error) {
  console.error("Production administration workflow verification failed.");
  if (logs) console.error(logs);
  throw error;
} finally {
  clearTimeout(overallTimeout);
  reader?.close();
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    let exited = await Promise.race([stopped.then(() => true), delay(5000, undefined, { ref: false }).then(() => false)]);
    if (!exited) {
      child.kill("SIGKILL");
      exited = await Promise.race([stopped.then(() => true), delay(5000, undefined, { ref: false }).then(() => false)]);
    }
    assert.ok(exited, "The isolated fixture process could not be stopped; its temporary database was preserved.");
  }
  // Only this exact, freshly created fixture directory may be removed.
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith("miova-admin-wire-"));
  rmSync(directory, { recursive: true, force: true });
}
console.log("Production admin Server Action wire checks passed: authentication, CSRF, RSC serialization, shipping settings, pending review/cancel, paid split dispatch, manual tracking, verified return and pending refund.");
