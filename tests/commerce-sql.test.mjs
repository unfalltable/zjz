import assert from "node:assert/strict";
import { test } from "node:test";
import {
  insertInventoryEventSql,
  insertOrderStatusEventSql,
  restockProductSql,
  updateOrderStatusSql,
} from "../backend/api/domain/commerce-sql.ts";
import { createDatabase, insertOrder, insertProduct, transaction } from "./commerce-db-fixture.mjs";

const now = "2026-10-10T00:00:00.000Z";

function advance(database, { owner = "store-one", from = "purchase", to = "packing", version = 0, id = "status-event" } = {}) {
  return transaction(database, () => {
    const update = database.prepare(updateOrderStatusSql).run(to, 46, now, owner, "MW-TEST1", from, version);
    const audit = database.prepare(insertOrderStatusEventSql).run(id, from, "staff-one", now, owner, "MW-TEST1");
    return { updated: Number(update.changes), audited: Number(audit.changes) };
  });
}

function restock(database, { owner = "store-one", sku = "REAL-01", quantity = 5, id = "stock-event" } = {}) {
  return transaction(database, () => {
    const update = database.prepare(restockProductSql).run(quantity, now, owner, sku, quantity);
    const audit = database.prepare(insertInventoryEventSql).run(id, quantity, "staff-one", now, "Test restock", owner, sku);
    return { updated: Number(update.changes), audited: Number(audit.changes) };
  });
}

test("optimistic order updates allow only one writer and produce exactly one audit event", () => {
  const database = createDatabase();
  try {
    insertOrder(database);
    assert.deepEqual(advance(database), { updated: 1, audited: 1 });
    assert.deepEqual(advance(database, { id: "stale-event" }), { updated: 0, audited: 0 });
    const order = database.prepare("SELECT status, version FROM orders").get();
    assert.equal(order.status, "packing");
    assert.equal(order.version, 1);
    const event = database.prepare("SELECT * FROM order_events").get();
    assert.equal(event.from_status, "purchase");
    assert.equal(event.to_status, "packing");
    assert.equal(event.actor_id, "staff-one");
    assert.equal(event.order_version, 1);
    assert.equal(database.prepare("SELECT count(*) AS count FROM order_events").get().count, 1);
  } finally { database.close(); }
});

test("atomic SQL rechecks payment state, previous status, revision, and store ownership", () => {
  for (const paymentStatus of ["pending", "failed", "refunded"]) {
    const database = createDatabase();
    try {
      insertOrder(database, { payment_status: paymentStatus });
      assert.deepEqual(advance(database), { updated: 0, audited: 0 }, paymentStatus);
      assert.equal(database.prepare("SELECT status FROM orders").get().status, "purchase");
    } finally { database.close(); }
  }
  const database = createDatabase();
  try {
    insertOrder(database);
    assert.deepEqual(advance(database, { owner: "store-two" }), { updated: 0, audited: 0 });
    assert.deepEqual(advance(database, { from: "handoff" }), { updated: 0, audited: 0 });
    assert.deepEqual(advance(database, { version: 99 }), { updated: 0, audited: 0 });
    assert.equal(database.prepare("SELECT count(*) AS count FROM order_events").get().count, 0);
  } finally { database.close(); }
});

test("failed audit insertion rolls back its order change within the same transaction", () => {
  const database = createDatabase();
  try {
    insertOrder(database);
    advance(database);
    assert.throws(() => advance(database, { from: "packing", to: "handoff", version: 1 }), /UNIQUE constraint failed/);
    const order = database.prepare("SELECT status, version FROM orders").get();
    assert.equal(order.status, "packing");
    assert.equal(order.version, 1);
    assert.equal(database.prepare("SELECT count(*) AS count FROM order_events").get().count, 1);
  } finally { database.close(); }
});

test("stock updates and inventory history are store-scoped and preserve existing reservations", () => {
  const database = createDatabase();
  try {
    insertProduct(database);
    assert.deepEqual(restock(database, { owner: "store-two" }), { updated: 0, audited: 0 });
    assert.deepEqual(restock(database, { sku: "UNKNOWN" }), { updated: 0, audited: 0 });
    assert.deepEqual(restock(database), { updated: 1, audited: 1 });
    const product = database.prepare("SELECT stock, reserved, inbound, status, version FROM products").get();
    assert.equal(product.stock, 28);
    assert.equal(product.reserved, 4);
    assert.equal(product.inbound, 7);
    assert.equal(product.status, "paused");
    assert.equal(product.version, 1);
    const event = database.prepare("SELECT * FROM inventory_events").get();
    assert.equal(event.quantity, 5);
    assert.equal(event.resulting_stock, 28);
    assert.equal(event.actor_id, "staff-one");
  } finally { database.close(); }
});

test("corrupt or excessive stock fails closed and never emits a successful restock audit", () => {
  for (const overrides of [{ stock: -1 }, { reserved: -1 }, { stock: 2, reserved: 4 }, { stock: 1_000_000 }]) {
    const database = createDatabase();
    try {
      insertProduct(database, overrides);
      assert.deepEqual(restock(database), { updated: 0, audited: 0 }, JSON.stringify(overrides));
      assert.equal(database.prepare("SELECT count(*) AS count FROM inventory_events").get().count, 0);
    } finally { database.close(); }
  }
});

test("failed inventory audit rolls back the inventory change", () => {
  const database = createDatabase();
  try {
    insertProduct(database);
    restock(database);
    assert.throws(() => restock(database), /UNIQUE constraint failed/);
    assert.equal(database.prepare("SELECT stock FROM products").get().stock, 28);
    assert.equal(database.prepare("SELECT version FROM products").get().version, 1);
    assert.equal(database.prepare("SELECT count(*) AS count FROM inventory_events").get().count, 1);
  } finally { database.close(); }
});
