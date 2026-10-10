import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { register } from "node:module";
import { Miniflare, Log, LogLevel } from "miniflare";
import { env } from "../tests/commerce-test-env.mjs";

// Real local workerd/D1 binding, isolated and non-persistent. No credentials or existing DB paths.
register("../tests/commerce-module-loader.mjs", import.meta.url);
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('isolated commerce test'); } };",
  compatibilityDate: "2026-05-15",
  d1Databases: { DB: "commerce-verification" },
  d1Persist: false,
  log: new Log(LogLevel.NONE),
});
try {
  const db = await mf.getD1Database("DB");
  const directory = new URL("../backend/sql/", import.meta.url);
  for (const name of readdirSync(directory).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    const sql = readFileSync(new URL(name, directory), "utf8");
    await db.batch(sql.split(/--> statement-breakpoint/).map((part) => part.trim()).filter(Boolean).map((part) => db.prepare(part)));
  }
  env.DB = db;
  env.STORE_OWNER_ID = "isolated-test-owner";
  const catalog = await import("../backend/api/db/catalog.ts");
  const ops = await import("../backend/api/db/ops.ts");
  const { createPendingOrder } = await import("../backend/api/services/checkout.ts");
  assert.deepEqual(await catalog.getStorefrontProducts(env.STORE_OWNER_ID), []);
  assert.deepEqual((await ops.getOpsSnapshot(env.STORE_OWNER_ID)).orders, []);
  assert.deepEqual(await catalog.importCatalogProducts(env.STORE_OWNER_ID), { imported: 3, skipped: 0 });
  assert.deepEqual(await catalog.importCatalogProducts(env.STORE_OWNER_ID), { imported: 0, skipped: 3 });
  assert.equal((await db.prepare("SELECT count(*) AS count FROM catalog_events").first()).count, 3);
  assert.equal(await ops.addProductStock(env.STORE_OWNER_ID, "KUMO-01", 5, "isolated verification"), true);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM inventory_events").first()).count, 1);
  assert.equal(await ops.addProductStock("wrong-owner", "KUMO-01", 5), false);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM inventory_events").first()).count, 1);
  assert.equal(await catalog.updateCatalogProduct(env.STORE_OWNER_ID, "KUMO-01", { priceCents: 1990, compareAtCents: null, status: "active", expectedVersion: 1 }), true);
  const input = {
    idempotencyKey: crypto.randomUUID(), email: "test@example.com", firstName: "Test", lastName: "Buyer",
    address: "1 Test Street", apartment: "", city: "Test City", region: "CA", postal: "12345",
    phone: "+15555550100", destination: "US", deliveryMethod: "standard", marketingOptIn: false,
    website: "", items: [{ id: "kumo", quantity: 1 }],
  };
  const receipts = await Promise.all(Array.from({ length: 4 }, () => createPendingOrder(input)));
  assert.ok(receipts.every((receipt) => receipt.ok && receipt.orderNumber === receipts[0].orderNumber));
  assert.equal(receipts[0].totalCents, 2880);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM orders").first()).count, 1);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM order_events").first()).count, 1);
  assert.equal(await ops.setOrderStatus(env.STORE_OWNER_ID, receipts[0].orderNumber, "purchase"), "unpaid");
  assert.equal((await createPendingOrder({ ...input, address: "2 Test Street" })).status, 409);
  assert.equal(await catalog.updateCatalogProduct(env.STORE_OWNER_ID, "KUMO-01", { priceCents: 4990, status: "paused" }), true);
  assert.equal((await createPendingOrder(input)).totalCents, 2880);
  const inventory = await db.prepare("SELECT stock, reserved FROM products WHERE sku = 'KUMO-01'").first();
  assert.equal(inventory.stock, 5);
  assert.equal(inventory.reserved, 0);
  console.log("Isolated workerd/D1 checks passed: migrations, zero-write reads, catalog/inventory audit transactions, concurrent draft idempotency, 409 binding, unpaid fulfillment guard, snapshot retry.");
} finally {
  delete env.DB;
  delete env.STORE_OWNER_ID;
  await mf.dispose();
}
