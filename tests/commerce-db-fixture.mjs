import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

export const sqlDirectory = new URL("../backend/sql/", import.meta.url);
export const migrationNames = readdirSync(sqlDirectory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
export const migrationText = (name) => readFileSync(new URL(name, sqlDirectory), "utf8");

export function createDatabase(names = migrationNames) {
  const database = new DatabaseSync(":memory:");
  for (const name of names) database.exec(migrationText(name));
  return database;
}

export function insertOrder(database, overrides = {}) {
  const row = {
    id: "existing-order", owner_id: "store-one", order_number: "MW-TEST1", customer_name: "Test Buyer",
    destination: "Test City, US", product_name: "Real Legacy Product", amount_cents: 12345, currency: "USD",
    fulfillment_mode: "self", status: "purchase", progress: 22, payment_status: "paid",
    source: "storefront", idempotency_key: "legacy-request", customer_email: "buyer@example.com",
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-02T00:00:00.000Z",
    ...overrides,
  };
  database.prepare(`INSERT INTO orders (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map(() => "?").join(", ")})`).run(...Object.values(row));
  return row;
}

export function insertProduct(database, overrides = {}) {
  const row = {
    id: "existing-product", owner_id: "store-one", sku: "REAL-01", name: "Real Legacy Product",
    stock: 23, reserved: 4, inbound: 7, default_fulfillment: "self", status: "paused",
    updated_at: "2026-09-02T00:00:00.000Z", ...overrides,
  };
  database.prepare(`INSERT INTO products (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map(() => "?").join(", ")})`).run(...Object.values(row));
  return row;
}

export function transaction(database, work) {
  database.exec("BEGIN");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
