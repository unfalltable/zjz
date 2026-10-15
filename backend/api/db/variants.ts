import { variantCreateSchema, variantEditSchema, variantSignature, readVariantAttributes, readVariantImages,
  type ProductVariantCreate, type ProductVariantEdit } from "@shared/variants";
import type { OpsProduct } from "@shared/ops-types";
import { availableInventory } from "@backend/domain/commerce";
import { getD1 } from "./index";
import { selectProductColumns, type CatalogRow } from "./catalog";
import { isStorefrontProductId } from "@shared/product-id";
import { isProductImage } from "@shared/assets";

export type VariantResult = "created" | "updated" | "not_found" | "conflict" | "exists";
async function find(owner: string, sku: string): Promise<CatalogRow | null> {
  return getD1().prepare(`SELECT ${selectProductColumns} FROM products WHERE owner_id = ? AND sku = ? LIMIT 1`)
    .bind(owner, sku).first<CatalogRow>();
}
function keys(attributes: Record<string, string>) { return JSON.stringify(Object.keys(attributes).sort()); }
function checkPrice(input: { priceCents: number; compareAtCents?: number | null }) {
  if (input.compareAtCents != null && input.compareAtCents < input.priceCents) throw new Error("invalid_compare_at_price");
}
function withImages(metadataJson: string | null, images: string[] | undefined): string | null {
  if (images === undefined) return metadataJson;
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(metadataJson ?? "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch { /* A damaged legacy value must not erase a valid new gallery. */ }
  return JSON.stringify({ ...metadata, images });
}
function toOps(row: CatalogRow, root: CatalogRow): OpsProduct {
  return { sku: row.sku, name: root.name, stock: row.stock, reserved: row.reserved, inbound: row.inbound,
    defaultFulfillment: row.defaultFulfillment, status: row.status, updatedAt: row.updatedAt,
    storefrontId: row.storefrontId, priceCents: row.priceCents, compareAtCents: row.compareAtCents,
    inventory: availableInventory(row.stock, row.reserved), category: root.category as OpsProduct["category"],
    image: row.image, images: readVariantImages(row.metadataJson) ?? (row.image ? [] : readVariantImages(root.metadataJson) ?? []),
    version: row.version, shippingWeightGrams: row.shippingWeightGrams,
    productGroupId: row.productGroupId, groupSku: root.sku,
    variantAttributes: readVariantAttributes(row.variantAttributesJson), isVariant: row.productGroupId !== null };
}
export async function getProductVariants(owner: string, rootSku: string): Promise<OpsProduct[] | null> {
  const root = await find(owner, rootSku);
  if (!root || root.productGroupId !== null) return null;
  const children = await getD1().prepare(`SELECT ${selectProductColumns} FROM products
    WHERE owner_id = ? AND product_group_id = ? ORDER BY sku ASC`).bind(owner, root.id).all<CatalogRow>();
  return [root, ...children.results].map((row) => toOps(row, root));
}
function guard(id: string, owner: string, root: CatalogRow, child?: CatalogRow) {
  return getD1().prepare(`INSERT INTO admin_operation_guards (id, allowed) SELECT ?, CASE WHEN
    EXISTS (SELECT 1 FROM products WHERE owner_id = ? AND id = ? AND version = ? AND product_group_id IS NULL)
    ${child ? "AND EXISTS (SELECT 1 FROM products WHERE owner_id = ? AND id = ? AND version = ? AND product_group_id = ?)" : ""}
    THEN 1 ELSE 0 END`).bind(id, owner, root.id, root.version,
      ...(child ? [owner, child.id, child.version, root.id] : []));
}
function audit(owner: string, id: string, action: string, details: unknown, now: string) {
  return getD1().prepare(`INSERT INTO catalog_events (id, owner_id, product_id, action, details_json, actor_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), owner, id, action, JSON.stringify(details), owner, now);
}
function conflict(error: unknown): VariantResult | null {
  const message = error instanceof Error ? error.message : "";
  if (/CHECK constraint failed/i.test(message)) return "conflict";
  if (/UNIQUE constraint failed/i.test(message)) return "exists";
  return null;
}
export async function createProductVariant(owner: string, rootSku: string, expectedVersion: number,
  raw: ProductVariantCreate): Promise<VariantResult> {
  const parsed = variantCreateSchema.safeParse(raw);
  if (!parsed.success || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error("invalid_variant");
  const input = parsed.data;
  checkPrice(input);
  const root = await find(owner, rootSku);
  if (!root || root.productGroupId !== null) return "not_found";
  if (root.version !== expectedVersion) return "conflict";
  const attributes = readVariantAttributes(root.variantAttributesJson);
  if (!Object.keys(input.attributes).length || !Object.keys(attributes).length || keys(attributes) !== keys(input.attributes)) {
    throw new Error("variant_dimensions_required");
  }
  const count = await getD1().prepare("SELECT count(*) AS total FROM products WHERE owner_id = ? AND product_group_id = ?")
    .bind(owner, root.id).first<{ total: number }>();
  if ((count?.total ?? 0) >= 99) throw new Error("variant_limit_reached");
  const db = getD1(), id = crypto.randomUUID(), operation = crypto.randomUUID(), now = new Date().toISOString();
  try {
    await db.batch([guard(operation, owner, root),
      db.prepare(`INSERT INTO products (id, owner_id, sku, name, storefront_id, price_cents, compare_at_cents, category,
        image, metadata_json, stock, reserved, inbound, default_fulfillment, status, version, updated_at, shipping_weight_grams,
        product_group_id, variant_attributes_json, variant_signature)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 'paused', 0, ?, ?, ?, ?, ?)`)
        .bind(id, owner, input.sku, root.name, input.storefrontId, input.priceCents, input.compareAtCents ?? null,
          root.category, input.image ?? null, withImages(null, input.images), input.defaultFulfillment, now, input.shippingWeightGrams,
          root.id, JSON.stringify(input.attributes), variantSignature(input.attributes)),
      db.prepare(`UPDATE products SET version = version + 1, updated_at = ? WHERE owner_id = ? AND id = ?`).bind(now, owner, root.id),
      audit(owner, id, "variant_created", { rootSku, attributes: input.attributes, stock: 0, status: "paused" }, now),
      db.prepare("DELETE FROM admin_operation_guards WHERE id = ?").bind(operation)]);
    return "created";
  } catch (error) { const result = conflict(error); if (result) return result; throw error; }
}
export async function updateProductVariant(owner: string, sku: string, expectedVersion: number,
  raw: ProductVariantEdit): Promise<VariantResult> {
  const parsed = variantEditSchema.safeParse(raw);
  if (!parsed.success || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error("invalid_variant");
  const input = parsed.data;
  checkPrice(input);
  const current = await find(owner, sku);
  if (!current) return "not_found";
  if (current.version !== expectedVersion) return "conflict";
  const root = current.productGroupId ? await getD1().prepare(`SELECT ${selectProductColumns} FROM products
    WHERE owner_id = ? AND id = ? AND product_group_id IS NULL LIMIT 1`).bind(owner, current.productGroupId).first<CatalogRow>() : current;
  if (!root) return "not_found";
  const rows = await getD1().prepare("SELECT variant_attributes_json AS attributes FROM products WHERE owner_id = ? AND product_group_id = ?")
    .bind(owner, root.id).all<{ attributes: string | null }>();
  const nextKeys = keys(input.attributes);
  if (current.productGroupId && (!Object.keys(input.attributes).length || nextKeys !== keys(readVariantAttributes(root.variantAttributesJson)))) {
    throw new Error("variant_dimension_mismatch");
  }
  if (!current.productGroupId && rows.results.some((row) => keys(readVariantAttributes(row.attributes)) !== nextKeys)) {
    throw new Error("variant_dimensions_in_use");
  }
  const image = input.image === undefined ? current.image : input.image;
  const effectiveImage = current.productGroupId ? image ?? root.image : image;
  if (input.status === "active" && (!isStorefrontProductId(root.storefrontId) ||
    !["home", "tech", "wear"].includes(root.category ?? "") || !effectiveImage || !isProductImage(effectiveImage))) {
    throw new Error("product_presentation_required");
  }
  const db = getD1(), operation = crypto.randomUUID(), now = new Date().toISOString();
  try {
    await db.batch([guard(operation, owner, root, current.productGroupId ? current : undefined),
      db.prepare(`UPDATE products SET price_cents = ?, compare_at_cents = ?, default_fulfillment = ?, status = ?,
        image = ?, metadata_json = ?, shipping_weight_grams = ?, variant_attributes_json = ?, variant_signature = ?,
        version = version + 1, updated_at = ? WHERE owner_id = ? AND id = ?`)
        .bind(input.priceCents, input.compareAtCents ?? null, input.defaultFulfillment, input.status, image,
          withImages(current.metadataJson, input.images), input.shippingWeightGrams, JSON.stringify(input.attributes),
          variantSignature(input.attributes), now, owner, current.id),
      ...(current.productGroupId ? [db.prepare("UPDATE products SET version = version + 1, updated_at = ? WHERE owner_id = ? AND id = ?").bind(now, owner, root.id)] : []),
      audit(owner, current.id, "variant_updated", { rootSku: root.sku, attributes: input.attributes, status: input.status,
        priceCents: input.priceCents }, now),
      db.prepare("DELETE FROM admin_operation_guards WHERE id = ?").bind(operation)]);
    return "updated";
  } catch (error) { const result = conflict(error); if (result) return result; throw error; }
}
