import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { createDatabase, insertOrder } from "./commerce-db-fixture.mjs";
import { createSqliteD1 } from "../backend/api/runtime/selfhost/db.mjs";
import { env } from "./commerce-test-env.mjs";

register("./commerce-module-loader.mjs", import.meta.url);
const { getOpsSnapshot } = await import("../backend/api/db/ops.ts");
const { reviewOrder } = await import("../backend/api/db/admin-commerce.ts");

function plainObjects(value, trail = "result") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach((item, index) => plainObjects(item, `${trail}[${index}]`)); return; }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
  assert.equal(Object.getPrototypeOf(value), Object.prototype, `${trail} must cross the RSC boundary as a plain object, not a node:sqlite null-prototype record`);
  for (const [key, item] of Object.entries(value)) plainObjects(item, `${trail}.${key}`);
}

test("SQLite D1 all/first/batch return plain records while raw returns ordered arrays", async () => {
  const adapter = createSqliteD1(createDatabase());
  try {
    const query = adapter.prepare("SELECT 7 AS value, 'row' AS label, X'0102' AS bytes");
    const all = await query.all();
    plainObjects(all);
    const first = await query.first();
    plainObjects(first);
    assert.equal(first.value, 7); assert.equal(first.label, "row"); assert.deepEqual([...first.bytes], [1, 2]);
    plainObjects(await adapter.batch([query]));
    assert.deepEqual(await adapter.prepare("SELECT 7 AS value, 'row' AS label").raw(), [[7, "row"]]);
    assert.deepEqual(await adapter.prepare("SELECT 7 AS value, 'row' AS label").raw({ columnNames: true }), [["value", "label"], [7, "row"]]);
    const unusual = await adapter.prepare('SELECT 9 AS "__proto__"').first();
    assert.equal(Object.getPrototypeOf(unusual), Object.prototype);
    assert.ok(Object.hasOwn(unusual, "__proto__")); assert.equal(unusual.__proto__, 9);
  } finally { adapter.close(); }
});

test("production SQLite operations snapshot remains RSC-safe after the first successful admin mutation creates audit rows", async () => {
  const adapter = createSqliteD1(createDatabase()); env.DB = adapter;
  const owner = "rsc-snapshot-owner";
  try {
    insertOrder(adapter.database, { owner_id: owner, order_number: "MW-00001", payment_status: "pending",
      status: "payment_pending", shipping_address: "1 Real Street", customer_email: "buyer@example.com", phone: "+15555550123",
      line_items_json: JSON.stringify([{ sku: "RSC-01", name: "Actual item", quantity: 1, priceCents: 1000, fulfillmentMode: "self" }]) });
    assert.deepEqual((await getOpsSnapshot(owner)).auditEvents, []);
    assert.equal((await reviewOrder(owner, "MW-00001", 0, "confirm", "Real recipient checked")).ok, true);
    const snapshot = await getOpsSnapshot(owner);
    assert.ok(snapshot.auditEvents.length > 0, "the failure occurs only once an actual mutation populates audit rows");
    plainObjects(snapshot);
    assert.ok(snapshot.auditEvents.some(({ action }) => action === "order_confirmed"));
  } finally { delete env.DB; adapter.close(); }
});
