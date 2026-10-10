import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createDatabase, insertOrder, insertProduct, migrationNames, migrationText, sqlDirectory } from "./commerce-db-fixture.mjs";

const historicalMigrations = ["0000_sloppy_timeslip.sql", "0001_silly_human_fly.sql"];
const historicalHashes = [
  "41254b3b34489385ea8c381b98826e8da0e01754ae70333087f10a720069ea94",
  "5a60258b8568a69564690dbe75d1bde74640cd38b24b4730be3312cab8c9e315",
];

test("applied historical migration SQL remains immutable", () => {
  historicalMigrations.forEach((name, index) => {
    const hash = createHash("sha256").update(migrationText(name).replaceAll("\r\n", "\n")).digest("hex");
    assert.equal(hash, historicalHashes[index], `${name}: append a new migration instead of editing applied SQL`);
  });
});

test("SQLite journal tracks commerce migrations only; unrelated user SQL is not accidentally executed", () => {
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", sqlDirectory), "utf8"));
  assert.deepEqual(journal.entries.map(({ tag }) => `${tag}.sql`), migrationNames);
  assert.ok(migrationNames.length >= 3, "commercial schema must be an appended migration");
  assert.ok(!migrationNames.includes("数据库SQL.sql"));
});

test("a fresh commerce schema starts empty, without fake orders or products", () => {
  const database = createDatabase();
  try {
    assert.equal(database.prepare("SELECT count(*) AS count FROM orders").get().count, 0);
    assert.equal(database.prepare("SELECT count(*) AS count FROM products").get().count, 0);
    assert.equal(database.prepare("SELECT count(*) AS count FROM order_events").get().count, 0);
    assert.equal(database.prepare("SELECT count(*) AS count FROM inventory_events").get().count, 0);
  } finally { database.close(); }
});

test("upgrading preserves real legacy orders, inventory, reservations and sale status", () => {
  const database = createDatabase(historicalMigrations);
  try {
    const order = insertOrder(database);
    const product = insertProduct(database);
    for (const name of migrationNames.filter((name) => !historicalMigrations.includes(name))) database.exec(migrationText(name));
    const upgradedOrder = database.prepare("SELECT * FROM orders WHERE id = ?").get(order.id);
    const upgradedProduct = database.prepare("SELECT * FROM products WHERE id = ?").get(product.id);
    for (const [column, value] of Object.entries(order)) assert.equal(upgradedOrder[column], value, `orders.${column}`);
    for (const [column, value] of Object.entries(product)) assert.equal(upgradedProduct[column], value, `products.${column}`);
    assert.equal(database.prepare("SELECT count(*) AS count FROM orders").get().count, 1);
    assert.equal(database.prepare("SELECT count(*) AS count FROM products").get().count, 1);
    assert.equal(upgradedOrder.request_fingerprint, null, "legacy retries must not invent request fingerprints");
    assert.equal(upgradedProduct.price_cents, null, "legacy prices must be explicitly configured, not guessed");
  } finally { database.close(); }
});

test("idempotency uniqueness is tenant-scoped and cannot duplicate an existing draft", () => {
  const database = createDatabase();
  try {
    insertOrder(database, { payment_status: "pending", status: "payment_pending" });
    assert.throws(() => insertOrder(database, { id: "duplicate", order_number: "MW-TEST2" }), /UNIQUE constraint failed/);
    assert.doesNotThrow(() => insertOrder(database, { id: "different-store", owner_id: "store-two" }));
    assert.equal(database.prepare("SELECT count(*) AS count FROM orders").get().count, 2);
  } finally { database.close(); }
});
