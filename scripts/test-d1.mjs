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
  const variants = await import("../backend/api/db/variants.ts");
  const root = (await variants.getProductVariants(env.STORE_OWNER_ID, "KUMO-01"))[0];
  const variantInput = { attributes: { Color: "Blue" }, priceCents: 4990, compareAtCents: null,
    shippingWeightGrams: 500, defaultFulfillment: "self", status: "active" };
  assert.equal(await variants.updateProductVariant(env.STORE_OWNER_ID, "KUMO-01", root.version, variantInput), "updated");
  const changedRoot = (await variants.getProductVariants(env.STORE_OWNER_ID, "KUMO-01"))[0];
  assert.equal(await variants.createProductVariant(env.STORE_OWNER_ID, "KUMO-01", changedRoot.version, {
    sku: "D1-RED", storefrontId: "d1-red", attributes: { Color: "Ｒｅｄ" }, priceCents: 2990,
    shippingWeightGrams: 500, defaultFulfillment: "self",
  }), "created");
  assert.equal(await variants.updateProductVariant(env.STORE_OWNER_ID, "D1-RED", 0, {
    ...variantInput, attributes: { Color: "Ｒｅｄ" }, priceCents: 2990,
  }), "updated");
  for (const q of ["D1-RED", "Color: Red", "cloud red"]) {
    const page = await catalog.getStorefrontCatalogPage(env.STORE_OWNER_ID, { q });
    assert.deepEqual(page.products.map((item) => item.id), ["kumo"], q);
    assert.equal(page.products[0].variants.length, 2);
  }
  assert.equal(await variants.updateProductVariant(env.STORE_OWNER_ID, "D1-RED", 1, {
    ...variantInput, attributes: { Color: "Ｒｅｄ" }, priceCents: 2990, status: "paused",
  }), "updated");
  assert.deepEqual((await catalog.getStorefrontCatalogPage(env.STORE_OWNER_ID, { q: "D1-RED" })).products, []);

  // A searched scan can contain 101 roots; each variant query must respect D1's 100-parameter bound.
  await db.batch(Array.from({ length: 105 }, (_, index) => {
    const id = "d1-scan-" + String(index).padStart(3, "0");
    return db.prepare(`INSERT INTO products (id, owner_id, sku, name, storefront_id, price_cents, category,
      image, stock, reserved, inbound, default_fulfillment, status, version, updated_at,
      variant_attributes_json, variant_signature)
      VALUES (?, ?, ?, ?, ?, 1990, 'home', '/products/kumo.webp', 0, 0, 0, 'self', 'active', 0,
        ?, '{"Color":"Blue"}', '[["Color","Blue"]]')`)
      .bind(id, env.STORE_OWNER_ID, "SKU-" + id, "Scan root " + id, id, new Date().toISOString());
  }));
  await db.prepare(`INSERT INTO products (id, owner_id, sku, name, storefront_id, price_cents, category,
    image, stock, reserved, inbound, default_fulfillment, status, version, updated_at,
    product_group_id, variant_attributes_json, variant_signature)
    VALUES ('d1-last-child', ?, 'D1-LAST-RED', 'Private child', 'd1-last-child', 2990, 'home',
      '/products/kumo.webp', 0, 0, 0, 'self', 'active', 0, ?, 'd1-scan-104',
      '{"Color":"Red"}', '[["Color","Red"]]')`).bind(env.STORE_OWNER_ID, new Date().toISOString()).run();
  const sparse = await catalog.getStorefrontCatalogPage(env.STORE_OWNER_ID, { q: "scan red", limit: 100 });
  assert.deepEqual(sparse.products.map((item) => item.id), ["d1-scan-104"]);
  assert.deepEqual(sparse.pageInfo, { hasMore: false, nextCursor: null });
  const full = await catalog.getStorefrontCatalogPage(env.STORE_OWNER_ID, { limit: 100 });
  assert.equal(full.products.length, 100);
  assert.equal(full.pageInfo.hasMore, true);
  console.log("Isolated workerd/D1 checks passed: migrations, zero-write reads, catalog/inventory audit transactions, concurrent draft idempotency, 409 binding, unpaid fulfillment guard, snapshot retry, Unicode/SKU variant search and 100-parameter batch limits.");
} finally {
  delete env.DB;
  delete env.STORE_OWNER_ID;
  await mf.dispose();
}
