import { z } from "zod";
import { products as importTemplates, type StoreProduct } from "@shared/catalog";
import { isProductImage } from "@shared/assets";
import { isStorefrontProductId } from "@shared/product-id";
import type { FulfillmentMode, OpsProduct } from "@shared/ops-types";
import { availableInventory, commerceFulfillmentModes, isValidPriceCents } from "@backend/domain/commerce";
import { CatalogQueryError, normalizeCatalogQuery, type CatalogPage, type CatalogQuery, type NormalizedCatalogQuery } from "@shared/catalog-query";
import { getD1 } from "./index";

const categorySchema = z.enum(["home", "tech", "wear"]);
const imageSchema = z.string().trim().min(1).max(2048).refine(isProductImage, "Use /products/... or an HTTPS image URL");
const localized = z.object({ en: z.string().max(5000), zh: z.string().max(5000), es: z.string().max(5000) });
const metadataSchema = z.object({
  color: z.enum(["blue", "ice", "coral"]), badge: localized, description: localized, detail: localized,
});
const editableProductSchema = z.object({
  priceCents: z.number().int().min(1).max(100_000_000),
  compareAtCents: z.number().int().min(1).max(100_000_000).nullable().optional(),
  status: z.enum(["active", "paused"]),
  defaultFulfillment: z.enum(commerceFulfillmentModes).optional(),
  storefrontId: z.string().trim().refine(isStorefrontProductId, "Use a non-reserved product URL ID").optional(),
  name: z.string().trim().min(1).max(200).optional(),
  category: categorySchema.optional(), image: imageSchema.optional(),
  expectedVersion: z.number().int().min(0).optional(),
  metadata: metadataSchema.optional(),
});
export type CatalogProductUpdate = z.infer<typeof editableProductSchema>;
const newProductSchema = editableProductSchema.omit({ status: true, expectedVersion: true }).extend({
  sku: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_.-]+$/),
  name: z.string().trim().min(1).max(200),
  storefrontId: z.string().trim().refine(isStorefrontProductId, "Use a non-reserved product URL ID"),
  category: categorySchema, image: imageSchema, defaultFulfillment: z.enum(commerceFulfillmentModes),
});
export type NewCatalogProduct = z.infer<typeof newProductSchema>;

const catalogAuditSql = `INSERT INTO catalog_events (id, owner_id, product_id, action, details_json, actor_id, created_at)
  SELECT ?, owner_id, id, ?, ?, ?, ? FROM products WHERE id = ? AND owner_id = ? AND changes() > 0`;

type CatalogRow = {
  id: string; sku: string; name: string; stock: number; reserved: number; inbound: number;
  defaultFulfillment: FulfillmentMode; status: "active" | "paused"; updatedAt: string;
  storefrontId: string | null; priceCents: number | null; compareAtCents: number | null;
  category: string | null; image: string | null; metadataJson: string | null; version: number;
};
const selectProductColumns = `id, sku, name, stock, reserved, inbound,
  default_fulfillment AS defaultFulfillment, status, updated_at AS updatedAt,
  storefront_id AS storefrontId, price_cents AS priceCents, compare_at_cents AS compareAtCents,
  category, image, metadata_json AS metadataJson, version`;

export async function getStorefrontProducts(ownerId: string): Promise<StoreProduct[]> {
  // Compatibility for server callers that explicitly need a complete catalogue.
  const products: StoreProduct[] = [];
  let cursor: string | null = null;
  do {
    const page = await getStorefrontCatalogPage(ownerId, { limit: 100, cursor });
    products.push(...page.products);
    cursor = page.pageInfo.nextCursor;
  } while (cursor !== null);
  return products;
}

export async function getStorefrontProduct(ownerId: string, storefrontId: string): Promise<StoreProduct | null> {
  if (!isStorefrontProductId(storefrontId)) return null;
  const row = await getD1().prepare(`SELECT ${selectProductColumns} FROM products
    WHERE owner_id = ? AND storefront_id = ? AND status = 'active' LIMIT 1`)
    .bind(ownerId, storefrontId).first<CatalogRow>();
  return row ? toStoreProduct(row) : null;
}

type CatalogPosition = { key: string | number; id: string };
const cursorSchema = z.object({ v: z.literal(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  key: z.union([z.string().max(200), z.number().int().min(1).max(100_000_000)]), id: z.string().min(1).max(512) });

async function queryFingerprint(ownerId: string, query: NormalizedCatalogQuery): Promise<string> {
  const scope = JSON.stringify([ownerId, query.q, query.category, query.locale, query.sort]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodePosition(position: CatalogPosition, fingerprint: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, fingerprint, ...position }));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodePosition(cursor: string, fingerprint: string, sort: NormalizedCatalogQuery["sort"]): CatalogPosition {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("encoding");
    const binary = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const value = cursorSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (value.fingerprint !== fingerprint || (sort === "featured" ? typeof value.key !== "string" : typeof value.key !== "number")) {
      throw new Error("scope");
    }
    return { key: value.key, id: value.id };
  } catch { throw new CatalogQueryError("The catalogue cursor is invalid or belongs to a different search."); }
}

export async function getStorefrontCatalogPage(ownerId: string, input: CatalogQuery = {}): Promise<CatalogPage> {
  const query = normalizeCatalogQuery(input);
  const fingerprint = await queryFingerprint(ownerId, query);
  let position = query.cursor ? decodePosition(query.cursor, fingerprint, query.sort) : null;
  // These expressions are chosen only from the fixed sort enum, never from request text.
  const sortColumn = query.sort === "featured" ? "name" : "price_cents";
  const descending = query.sort === "price-high";
  const direction = descending ? "DESC" : "ASC";
  const comparison = descending ? "<" : ">";
  const matches: { row: CatalogRow; product: StoreProduct }[] = [];
  const scanSize = Math.max(100, query.limit + 1);
  let exhausted = false;
  while (matches.length <= query.limit && !exhausted) {
    const conditions = ["owner_id = ?", "status = 'active'", "typeof(price_cents) = 'integer'",
      "price_cents BETWEEN 1 AND 100000000", "storefront_id IS NOT NULL", "category IN ('home', 'tech', 'wear')",
      "image IS NOT NULL", "default_fulfillment IN ('marketplace', 'self', 'supplier')"];
    const values: (string | number)[] = [ownerId];
    if (query.category !== "all") { conditions.push("category = ?"); values.push(query.category); }
    if (query.q && /^[\x00-\x7f]+$/.test(query.q)) {
      const pattern = `%${query.q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
      // SQLite LIKE folds ASCII only. Unicode queries are matched on the server below.
      // For ASCII queries, retain non-ASCII text as candidates too (e.g. Kelvin K → k),
      // so this SQL prefilter cannot discard a Unicode case-fold match.
      const description = `CASE WHEN json_valid(metadata_json) THEN COALESCE(json_extract(metadata_json, '$.description.${query.locale}'), '') ELSE '' END`;
      const detail = `CASE WHEN json_valid(metadata_json) THEN COALESCE(json_extract(metadata_json, '$.detail.${query.locale}'), '') ELSE '' END`;
      conditions.push(`(name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' OR ${description} LIKE ? ESCAPE '\\' OR ${detail} LIKE ? ESCAPE '\\'
        OR name GLOB '*[^ -~]*' OR sku GLOB '*[^ -~]*' OR ${description} GLOB '*[^ -~]*' OR ${detail} GLOB '*[^ -~]*')`);
      values.push(pattern, pattern, pattern, pattern);
    }
    if (position) {
      conditions.push(`(${sortColumn} ${comparison} ? OR (${sortColumn} = ? AND id > ?))`);
      values.push(position.key, position.key, position.id);
    }
    const rows = await getD1().prepare(`SELECT ${selectProductColumns} FROM products WHERE ${conditions.join(" AND ")}
      ORDER BY ${sortColumn} ${direction}, id ASC LIMIT ?`).bind(...values, scanSize).all<CatalogRow>();
    exhausted = rows.results.length < scanSize;
    for (const row of rows.results) {
      position = { key: query.sort === "featured" ? row.name : row.priceCents!, id: row.id };
      const product = toStoreProduct(row);
      if (!product || (query.q && !`${product.name} ${product.sku} ${product.description[query.locale]} ${product.detail[query.locale]}`.toLowerCase().includes(query.q))) continue;
      matches.push({ row, product });
      if (matches.length > query.limit) break;
    }
    // Keep scanning past filtered legacy rows until an extra *valid* listing or true EOF.
  }
  const hasMore = matches.length > query.limit;
  const selected = matches.slice(0, query.limit);
  const last = selected.at(-1)?.row;
  return { products: selected.map(({ product }) => product), pageInfo: {
    hasMore,
    nextCursor: hasMore && last ? encodePosition({ key: query.sort === "featured" ? last.name : last.priceCents!, id: last.id }, fingerprint) : null,
  } };
}

export async function getOpsProducts(ownerId: string): Promise<OpsProduct[]> {
  const rows = await getD1().prepare(`SELECT ${selectProductColumns} FROM products
    WHERE owner_id = ? ORDER BY name ASC LIMIT 1000`).bind(ownerId).all<CatalogRow>();
  return rows.results.map((row) => ({
    sku: row.sku, name: row.name, stock: row.stock, reserved: row.reserved, inbound: row.inbound,
    defaultFulfillment: row.defaultFulfillment, status: row.status, updatedAt: row.updatedAt,
    storefrontId: row.storefrontId, priceCents: row.priceCents, compareAtCents: row.compareAtCents,
    inventory: availableInventory(row.stock, row.reserved),
    category: categorySchema.safeParse(row.category).success ? row.category as OpsProduct["category"] : null,
    image: row.image, version: row.version,
    metadata: readMetadata(row.metadataJson),
  }));
}

// Explicit admin action only: no fake orders, no overwritten rows, no fictional available stock.
export async function importCatalogProducts(ownerId: string): Promise<{ imported: number; skipped: number }> {
  const db = getD1();
  const now = new Date().toISOString();
  const statements = importTemplates.flatMap((product) => {
    const id = crypto.randomUUID();
    return [db.prepare(`INSERT INTO products
    (id, owner_id, sku, name, storefront_id, price_cents, compare_at_cents, category, image, metadata_json,
      stock, reserved, inbound, default_fulfillment, status, version, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 'paused', 0, ?)
    ON CONFLICT DO NOTHING`).bind(
    id, ownerId, product.sku, product.name, product.id, Math.round(product.price * 100),
    product.compareAt === null ? null : Math.round(product.compareAt * 100), product.category, product.image,
    JSON.stringify({ color: product.color, badge: { en: "", zh: "", es: "" }, description: product.description, detail: product.detail }),
    product.fulfillmentMode, now,
  ), db.prepare(catalogAuditSql).bind(crypto.randomUUID(), "template_imported", JSON.stringify({ stock: 0, status: "paused" }), ownerId, now, id, ownerId)];
  });
  const results = await db.batch(statements);
  const imported = results.reduce((sum, result, index) => sum + (index % 2 === 0 ? result.meta.changes ?? 0 : 0), 0);
  return { imported, skipped: importTemplates.length - imported };
}

export async function createCatalogProduct(ownerId: string, input: NewCatalogProduct): Promise<"created" | "exists"> {
  const parsed = newProductSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_product_update");
  const product = parsed.data;
  const compareAt = product.compareAtCents ?? null;
  if (compareAt !== null && compareAt < product.priceCents) throw new Error("invalid_compare_at_price");
  const db = getD1();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`INSERT INTO products
      (id, owner_id, sku, name, storefront_id, price_cents, compare_at_cents, category, image, metadata_json,
        stock, reserved, inbound, default_fulfillment, status, version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 'paused', 0, ?) ON CONFLICT DO NOTHING`)
      .bind(id, ownerId, product.sku, product.name, product.storefrontId, product.priceCents, compareAt,
        product.category, product.image, product.metadata ? JSON.stringify(product.metadata) : null, product.defaultFulfillment, now),
    db.prepare(catalogAuditSql).bind(crypto.randomUUID(), "created", JSON.stringify({ stock: 0, status: "paused", priceCents: product.priceCents }), ownerId, now, id, ownerId),
  ]);
  return (results[0].meta.changes ?? 0) > 0 ? "created" : "exists";
}

export async function updateCatalogProduct(ownerId: string, sku: string, input: CatalogProductUpdate): Promise<boolean> {
  const parsed = editableProductSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_product_update");
  const current = await getD1().prepare(`SELECT ${selectProductColumns} FROM products WHERE owner_id = ? AND sku = ? LIMIT 1`)
    .bind(ownerId, sku).first<CatalogRow>();
  if (!current) return false;
  const update = parsed.data;
  if (update.expectedVersion !== undefined && update.expectedVersion !== current.version) return false;
  const compareAtCents = update.compareAtCents === undefined ? current.compareAtCents : update.compareAtCents;
  if (compareAtCents !== null && compareAtCents < update.priceCents) throw new Error("invalid_compare_at_price");
  const storefrontId = update.storefrontId ?? current.storefrontId;
  if (storefrontId !== null && !isStorefrontProductId(storefrontId)) throw new Error("invalid_product_update");
  const category = update.category ?? current.category;
  const image = update.image ?? current.image;
  // Publishing requires intentional completion of historical, unpriced inventory records.
  if (update.status === "active" && (!isStorefrontProductId(storefrontId) || !categorySchema.safeParse(category).success || !imageSchema.safeParse(image).success)) {
    throw new Error("product_presentation_required");
  }
  const now = new Date().toISOString();
  const db = getD1();
  try {
    const results = await db.batch([db.prepare(`UPDATE products SET price_cents = ?, compare_at_cents = ?, status = ?,
      default_fulfillment = ?, storefront_id = ?, name = ?, category = ?, image = ?, metadata_json = ?, version = version + 1, updated_at = ?
      WHERE owner_id = ? AND sku = ? AND version = ?`).bind(
      update.priceCents, compareAtCents, update.status, update.defaultFulfillment ?? current.defaultFulfillment,
      storefrontId, update.name ?? current.name, category, image, update.metadata ? JSON.stringify(update.metadata) : current.metadataJson,
      now, ownerId, sku, current.version,
    ), db.prepare(catalogAuditSql).bind(crypto.randomUUID(), "updated", JSON.stringify({ priceCents: update.priceCents, status: update.status }), ownerId, now, current.id, ownerId)]);
    return (results[0].meta.changes ?? 0) > 0;
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) throw new Error("product_identity_conflict");
    throw error;
  }
}

function toStoreProduct(row: CatalogRow): StoreProduct | null {
  const category = categorySchema.safeParse(row.category);
  if (!isStorefrontProductId(row.storefrontId) || !row.name || row.name.length > 200 || !isValidPriceCents(row.priceCents)
    || !category.success || !imageSchema.safeParse(row.image).success
    || !(commerceFulfillmentModes as readonly string[]).includes(row.defaultFulfillment)) return null;
  const metadata = readMetadata(row.metadataJson);
  const emptyText = { en: "", zh: "", es: "" };
  const nameText = { en: row.name, zh: row.name, es: row.name };
  const compareAtCents = isValidPriceCents(row.compareAtCents) && row.compareAtCents >= row.priceCents ? row.compareAtCents : null;
  return {
    id: row.storefrontId, sku: row.sku, name: row.name,
    price: row.priceCents / 100, priceCents: row.priceCents,
    compareAt: compareAtCents === null ? null : compareAtCents / 100, compareAtCents,
    rating: 0, reviews: 0, category: category.data, image: row.image!,
    color: metadata?.color ?? "blue", inventory: availableInventory(row.stock, row.reserved),
    fulfillmentMode: row.defaultFulfillment, inventoryReserved: false,
    badge: metadata?.badge ?? emptyText, description: metadata?.description ?? nameText, detail: metadata?.detail ?? nameText,
  };
}

function readMetadata(value: string | null): z.infer<typeof metadataSchema> | null {
  try {
    const parsed = metadataSchema.safeParse(JSON.parse(value ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
