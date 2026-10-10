import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
import { createDatabase, insertProduct } from "./commerce-db-fixture.mjs";
import { createD1Adapter } from "./commerce-d1-fixture.mjs";
import { env } from "./commerce-test-env.mjs";

register("./commerce-module-loader.mjs", import.meta.url);
const catalog = await import("../backend/api/db/catalog.ts");
const { GET } = await import("../backend/api/http/catalog.ts");
const { CatalogQueryError, normalizeCatalogQuery } = await import("../shared/catalog-query.ts");
const owner = "catalog-test-owner";
const localized = (en = "", zh = "", es = "") => ({ en, zh, es });
const metadata = (description = localized("Useful item", "实用商品", "Artículo útil"), detail = localized("More details", "商品详情", "Más detalles")) =>
  JSON.stringify({ color: "blue", badge: localized(), description, detail });

function product(database, index, overrides = {}) {
  const suffix = String(index).padStart(4, "0");
  return insertProduct(database, {
    id: `row-${suffix}`, owner_id: owner, sku: `SKU-${suffix}`, name: `Product ${suffix}`,
    storefront_id: `item-${suffix}`, price_cents: 1000 + index, category: "home",
    image: "/products/kumo.webp", metadata_json: metadata(), status: "active", ...overrides,
  });
}

async function isolated(work) {
  const database = createDatabase();
  const d1 = createD1Adapter(database);
  env.DB = d1;
  env.STORE_OWNER_ID = owner;
  try { return await work(database, d1); }
  finally { delete env.DB; delete env.STORE_OWNER_ID; database.close(); }
}

async function allPages(query = {}) {
  const products = [];
  const cursors = new Set();
  let cursor = null;
  do {
    const page = await catalog.getStorefrontCatalogPage(owner, { ...query, cursor });
    assert.equal(page.pageInfo.hasMore, page.pageInfo.nextCursor !== null);
    products.push(...page.products);
    cursor = page.pageInfo.nextCursor;
    if (cursor) {
      assert.equal(cursors.has(cursor), false, "pagination must advance");
      cursors.add(cursor);
    }
  } while (cursor);
  return products;
}

test("catalogue paging reaches products beyond the old 500-item boundary without reads seeding data", async () => isolated(async (database, d1) => {
  assert.deepEqual(await catalog.getStorefrontCatalogPage(owner), { products: [], pageInfo: { hasMore: false, nextCursor: null } });
  database.exec("BEGIN");
  for (let index = 0; index < 623; index++) product(database, index);
  database.exec("COMMIT");
  const first = await catalog.getStorefrontCatalogPage(owner);
  assert.equal(first.products.length, 50);
  assert.equal(first.pageInfo.hasMore, true);
  const products = await allPages({ limit: 100 });
  assert.equal(products.length, 623);
  assert.equal(new Set(products.map((item) => item.id)).size, 623);
  assert.equal(products.at(-1).id, "item-0622");
  assert.equal((await catalog.getStorefrontProducts(owner)).length, 623, "server compatibility reader must not silently truncate");
  assert.equal((await catalog.getStorefrontProduct(owner, "item-0622")).id, "item-0622");
  assert.equal(await catalog.getStorefrontProduct("different-owner", "item-0622"), null);
  assert.equal(await catalog.getStorefrontProduct(owner, "../item-0622"), null);
  const search = await catalog.getStorefrontCatalogPage(owner, { q: "0622" });
  assert.deepEqual(search.products.map((item) => item.id), ["item-0622"]);
  assert.equal(d1.mutations(), 0);
}));

test("equal names and prices use deterministic ID ties in every allowed order", async () => isolated(async (database) => {
  for (let index = 0; index < 8; index++) product(database, index, { name: "Same name", price_cents: index < 4 ? 1000 : 2000 });
  assert.deepEqual((await allPages({ limit: 2 })).map((item) => item.id), Array.from({ length: 8 }, (_, index) => `item-000${index}`));
  assert.deepEqual((await allPages({ limit: 2, sort: "price-low" })).map((item) => item.id), Array.from({ length: 8 }, (_, index) => `item-000${index}`));
  assert.deepEqual((await allPages({ limit: 2, sort: "price-high" })).map((item) => item.id), ["item-0004", "item-0005", "item-0006", "item-0007", "item-0000", "item-0001", "item-0002", "item-0003"]);
}));

test("filtered legacy rows never masquerade as the last catalogue page", async () => isolated(async (database, d1) => {
  for (let index = 0; index < 205; index++) product(database, index, { image: "javascript:alert(1)" });
  product(database, 205);
  for (let index = 206; index < 411; index++) product(database, index, { storefront_id: `invalid/${index}` });
  product(database, 411);
  const first = await catalog.getStorefrontCatalogPage(owner, { limit: 1 });
  assert.deepEqual(first.products.map((item) => item.id), ["item-0205"]);
  assert.equal(first.pageInfo.hasMore, true);
  const second = await catalog.getStorefrontCatalogPage(owner, { limit: 1, cursor: first.pageInfo.nextCursor });
  assert.deepEqual(second.products.map((item) => item.id), ["item-0411"]);
  assert.deepEqual(second.pageInfo, { hasMore: false, nextCursor: null });
  assert.equal(await catalog.getStorefrontProduct(owner, "invalid/300"), null);
  assert.equal(d1.mutations(), 0);
}));

test("server search respects category, localized descriptions, literal wildcards and malformed legacy metadata", async () => isolated(async (database) => {
  product(database, 1, { name: "100%_cotton", category: "wear", metadata_json: metadata(localized("Soft fabric", "柔软棉布", "ÁGIL y útil")) });
  product(database, 2, { name: "100Xcotton", category: "tech", metadata_json: "{invalid json" });
  product(database, 3, { name: "Paused cotton", status: "paused" });
  product(database, 4, { name: "Other owner cotton", owner_id: "different-owner" });
  product(database, 5, { name: "O'Reilly\\case" });
  product(database, 6, { name: "\u212aettle", metadata_json: metadata(localized("", "", ""), localized("", "", "")) });
  assert.deepEqual((await allPages({ q: "%_" })).map((item) => item.id), ["item-0001"]);
  assert.deepEqual((await allPages({ q: "柔软", locale: "zh" })).map((item) => item.id), ["item-0001"]);
  assert.deepEqual((await allPages({ q: "ágil", locale: "es" })).map((item) => item.id), ["item-0001"]);
  assert.deepEqual((await allPages({ q: "soft", locale: "en", category: "wear" })).map((item) => item.id), ["item-0001"]);
  assert.deepEqual((await allPages({ q: "soft", category: "tech" })).map((item) => item.id), []);
  assert.deepEqual((await allPages({ q: "O'Reilly\\case" })).map((item) => item.id), ["item-0005"]);
  assert.deepEqual((await allPages({ q: "' OR 1=1 --" })).map((item) => item.id), []);
  assert.deepEqual((await allPages({ q: "100X" })).map((item) => item.id), ["item-0002"]);
  assert.deepEqual((await allPages({ q: "kettle" })).map((item) => item.id), ["item-0006"], "Unicode catalogue text must not be lost by the SQL ASCII optimization");
}));

test("cursor scope rejects changes of store, search, category, locale or sort", async () => isolated(async (database) => {
  product(database, 1);
  product(database, 2);
  const { pageInfo } = await catalog.getStorefrontCatalogPage(owner, { limit: 1 });
  const cursor = pageInfo.nextCursor;
  for (const query of [{ q: "Product" }, { category: "home" }, { locale: "es" }, { sort: "price-low" }]) {
    await assert.rejects(() => catalog.getStorefrontCatalogPage(owner, { ...query, cursor }), CatalogQueryError);
  }
  await assert.rejects(() => catalog.getStorefrontCatalogPage("different-owner", { cursor }), CatalogQueryError);
  await assert.rejects(() => catalog.getStorefrontCatalogPage(owner, { cursor: "not-a-json-cursor" }), CatalogQueryError);
  assert.deepEqual((await catalog.getStorefrontCatalogPage(owner, { cursor, limit: 100 })).products.map((item) => item.id), ["item-0002"]);
}));

test("public catalogue parameters are bounded and malformed queries return 400 without DB writes", async () => isolated(async (database, d1) => {
  product(database, 1);
  const defaultResponse = await GET();
  const body = await defaultResponse.json();
  assert.equal(defaultResponse.status, 200);
  assert.equal(body.currency, "USD");
  assert.equal(body.payments.enabled, false);
  assert.deepEqual(body.pageInfo, { hasMore: false, nextCursor: null });
  for (const search of ["limit=0", "limit=101", "limit=1.5", "limit=1e2", "limit=01", "sort=name%20DESC", "category=other", "locale=fr", "cursor=", "limit=1&limit=2", `q=${"a".repeat(101)}`]) {
    const response = await GET(new Request(`https://store.example/api/v1/catalog?${search}`));
    assert.equal(response.status, 400, search);
    assert.equal((await response.json()).ok, false);
  }
  for (const input of [{ limit: NaN }, { limit: Infinity }, { q: "a".repeat(101) }]) assert.throws(() => normalizeCatalogQuery(input), CatalogQueryError);
  delete env.STORE_OWNER_ID;
  assert.equal((await GET()).status, 503);
  assert.equal(d1.mutations(), 0);
}));

test("shared product IDs preserve legacy ASCII basenames and reject reserved or unsafe bag keys", async () => {
  const { isStorefrontProductId } = await import("../shared/product-id.ts");
  const { parseShoppingBag } = await import("../web/lib/storefront.ts");
  for (const id of ["item-1", "LEGACY_01", "a", "a".repeat(64), "Constructor"]) {
    assert.equal(isStorefrontProductId(id), true, id);
  }
  for (const id of ["__proto__", "constructor", "prototype", "", "../item", "item/1", "item.1", "a".repeat(65), "妙物", null, 1]) {
    assert.equal(isStorefrontProductId(id), false, String(id));
  }
  const restored = parseShoppingBag('{"__proto__":1,"constructor":1,"prototype":1,"../item":1,"LEGACY_01":2}');
  assert.deepEqual(restored, { bag: { LEGACY_01: 2 }, recovered: true });
});

test("reserved legacy product IDs cannot poison the public catalogue or direct product lookup", async () => isolated(async (database, d1) => {
  const { parseCatalogResponse } = await import("../web/lib/storefront.ts");
  const reserved = ["__proto__", "constructor", "prototype"];
  for (const [index, id] of reserved.entries()) product(database, index, { storefront_id: id });
  product(database, 3, { storefront_id: "LEGACY_01" });
  const page = await catalog.getStorefrontCatalogPage(owner, { limit: 1 });
  assert.deepEqual(page.products.map((item) => item.id), ["LEGACY_01"]);
  assert.deepEqual(page.pageInfo, { hasMore: false, nextCursor: null });
  assert.deepEqual(parseCatalogResponse({ ok: true, products: page.products }).map((item) => item.id), ["LEGACY_01"]);
  for (const id of reserved) assert.equal(await catalog.getStorefrontProduct(owner, id), null);
  assert.equal((await catalog.getStorefrontProduct(owner, "LEGACY_01")).id, "LEGACY_01");
  assert.equal(database.prepare("SELECT count(*) AS count FROM products").get().count, 4, "reads preserve legacy records");
  assert.equal(d1.mutations(), 0);
}));

test("catalogue create/edit/publish rejects reserved URLs while permitting explicit legacy repair", async () => isolated(async (database, d1) => {
  const reserved = ["__proto__", "constructor", "prototype"];
  for (const id of reserved) {
    await assert.rejects(catalog.createCatalogProduct(owner, {
      sku: "NEW-01", name: "New item", storefrontId: id, priceCents: 1000,
      category: "home", image: "/products/kumo.webp", defaultFulfillment: "self",
    }), /invalid_product_update/);
  }
  product(database, 9);
  const original = database.prepare("SELECT * FROM products WHERE sku = 'SKU-0009'").get();
  for (const id of reserved) {
    for (const status of ["active", "paused"]) {
      await assert.rejects(catalog.updateCatalogProduct(owner, "SKU-0009", { priceCents: 1000, status, storefrontId: id }), /invalid_product_update/);
    }
  }
  assert.deepEqual(database.prepare("SELECT * FROM products WHERE sku = 'SKU-0009'").get(), original);
  assert.equal(d1.mutations(), 0);
  database.prepare("UPDATE products SET storefront_id = 'constructor' WHERE sku = 'SKU-0009'").run();
  await assert.rejects(catalog.updateCatalogProduct(owner, "SKU-0009", { priceCents: 1000, status: "active" }), /invalid_product_update/);
  assert.equal(d1.mutations(), 0);
  assert.equal(await catalog.updateCatalogProduct(owner, "SKU-0009", { priceCents: 1000, status: "active", storefrontId: "repaired-url" }), true);
  assert.equal((await catalog.getStorefrontProduct(owner, "repaired-url")).id, "repaired-url");
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_events").get().count, 1);
}));
