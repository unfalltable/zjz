import { MAX_BAG_LINES, type StoreLocale, type StoreProduct } from "../../shared/catalog.ts";
import type { CatalogQuery } from "@shared/catalog-query";
import { isProductImage } from "../../shared/assets.ts";
import { isStorefrontProductId } from "../../shared/product-id.ts";
import { variantAttributesSchema } from "../../shared/variants.ts";

export const LOCALE_STORAGE_KEY = "miova_locale_v1";
export const CHECKOUT_RETRY_STORAGE_KEY = "miova_checkout_retry_v1";
export const MAX_LINE_QUANTITY = 10;
export type ShoppingBag = Record<string, number>;
let inMemoryRetry: { fingerprint: string; key: string; attempted?: boolean } | null = null;

export function readBrowserValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const temporary = window.sessionStorage.getItem(key);
    if (temporary !== null) return temporary;
  } catch { /* A blocked storage area must not break shopping. */ }
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function writeBrowserValue(key: string, value: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    try { window.sessionStorage.removeItem(key); } catch { /* Optional fallback. */ }
    return true;
  } catch {
    try {
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
      return true;
    } catch { return false; }
  }
}

export function isStoreLocale(value: unknown): value is StoreLocale {
  return value === "en" || value === "zh" || value === "es";
}

export function parseShoppingBag(raw: string | null): { bag: ShoppingBag; recovered: boolean } {
  const bag: ShoppingBag = {};
  if (!raw) return { bag, recovered: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { bag, recovered: true };
    let recovered = false;
    for (const [id, quantity] of Object.entries(parsed)) {
      if (!isStorefrontProductId(id) ||
          typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0) {
        recovered = true;
        continue;
      }
      bag[id] = Math.min(MAX_LINE_QUANTITY, quantity);
      if (quantity > MAX_LINE_QUANTITY) recovered = true;
    }
    return { bag, recovered };
  } catch { return { bag, recovered: true }; }
}

export function productQuantityLimit(product: StoreProduct): number {
  return Math.max(0, Math.min(MAX_LINE_QUANTITY, product.inventory));
}

export function reconcileShoppingBag(bag: ShoppingBag, products: StoreProduct[]): ShoppingBag {
  const reconciled: ShoppingBag = {};
  for (const product of flattenCatalogProducts(products)) {
    const quantity = Math.min(bag[product.id] ?? 0, productQuantityLimit(product));
    if (quantity > 0) reconciled[product.id] = quantity;
  }
  return reconciled;
}

export function canAddShoppingBagLine(bag: ShoppingBag, id: string): boolean {
  return (Object.hasOwn(bag, id) && bag[id] > 0) || Object.values(bag).filter((quantity) => quantity > 0).length < MAX_BAG_LINES;
}

export function shoppingBagNeedsReview(bag: ShoppingBag, products: StoreProduct[]): boolean {
  if (Object.values(bag).filter((quantity) => quantity > 0).length > MAX_BAG_LINES) return true;
  const current = new Map(flattenCatalogProducts(products).map((product) => [product.id, product]));
  return Object.entries(bag).some(([id, quantity]) => {
    const product = current.get(id);
    return !product || quantity > productQuantityLimit(product);
  });
}

/** Catalogue listings are groups; bags always contain actual, independently stocked SKUs. */
export function flattenCatalogProducts(products: StoreProduct[]): StoreProduct[] {
  return products.flatMap((product) => product.variants?.length ? product.variants : [product]);
}
/** Defaults choose an available SKU; an explicit choice is never silently replaced. */
export function selectProductVariant(listing: StoreProduct, selectedId?: string | null): StoreProduct | null {
  const variants = listing.variants?.length ? listing.variants : [listing];
  if (selectedId != null) return variants.find((variant) => variant.id === selectedId) ?? null;
  return variants.find((variant) => variant.inventory > 0) ?? variants[0];
}
export function listingInventory(product: StoreProduct): number {
  return product.variants?.reduce((sum, variant) => sum + variant.inventory, 0) ?? product.inventory;
}
export function listingPriceCents(product: StoreProduct): number {
  return product.variants?.length ? Math.min(...product.variants.map((variant) => variant.priceCents ?? Math.round(variant.price * 100)))
    : product.priceCents ?? Math.round(product.price * 100);
}

function isLocalizedText(value: unknown): value is Record<StoreLocale, string> {
  if (!value || typeof value !== "object") return false;
  const text = value as Record<string, unknown>;
  return ["en", "zh", "es"].every((locale) => typeof text[locale] === "string");
}

export function isSafeProductImage(value: unknown): value is string {
  return typeof value === "string" && isProductImage(value);
}

export function parseCatalogResponse(value: unknown): StoreProduct[] {
  if (!value || typeof value !== "object") throw new Error("catalog_invalid");
  const payload = value as { ok?: unknown; products?: unknown };
  if (payload.ok !== true || !Array.isArray(payload.products)) throw new Error("catalog_invalid");
  const seen = new Set<string>();
  const variantIds = new Set<string>();
  const variantSkus = new Set<string>();
  const parseProduct = (value: unknown, nested = false): StoreProduct => {
    if (!value || typeof value !== "object") throw new Error("catalog_invalid");
    const product = value as StoreProduct;
    const priceCents = product.priceCents ?? Math.round(product.price * 100);
    if (!isStorefrontProductId(product.id) || (!nested && seen.has(product.id)) ||
        typeof product.name !== "string" || typeof product.sku !== "string" ||
        !Number.isSafeInteger(priceCents) || priceCents < 0 ||
        !Number.isSafeInteger(product.inventory) || product.inventory < 0 ||
        !isSafeProductImage(product.image) ||
        !["home", "tech", "wear"].includes(product.category) ||
        !["blue", "ice", "coral"].includes(product.color) ||
        !["marketplace", "self", "supplier"].includes(product.fulfillmentMode) ||
        !isLocalizedText(product.badge) || !isLocalizedText(product.description) || !isLocalizedText(product.detail) ||
        (product.listingId !== undefined && !isStorefrontProductId(product.listingId)) ||
        (product.shippingWeightGrams !== undefined && (!Number.isSafeInteger(product.shippingWeightGrams) || product.shippingWeightGrams < 1 || product.shippingWeightGrams > 1_000_000)) ||
        (product.images !== undefined && (!Array.isArray(product.images) || product.images.length > 8 || product.images.some((image) => !isSafeProductImage(image)))) ||
        (product.variantAttributes !== undefined && !variantAttributesSchema.safeParse(product.variantAttributes).success) ||
        (nested && product.variants !== undefined)) {
      throw new Error("catalog_invalid");
    }
    if (!nested) seen.add(product.id);
    const result = { ...product, price: priceCents / 100, priceCents };
    if (product.variants !== undefined) {
      if (!Array.isArray(product.variants) || !product.variants.length || product.variants.length > 100) throw new Error("catalog_invalid");
      result.variants = product.variants.map((variant) => parseProduct(variant, true));
      if (result.variants.some((variant) => variant.listingId !== product.id)) throw new Error("catalog_invalid");
      const root = result.variants.find((variant) => variant.id === product.id);
      if (!root || root.sku !== product.sku || root.priceCents !== priceCents || root.inventory !== product.inventory) throw new Error("catalog_invalid");
      result.variantInventory = result.variants.reduce((sum, variant) => sum + variant.inventory, 0);
      const prices = result.variants.map((variant) => variant.priceCents!);
      result.priceRangeCents = { min: Math.min(...prices), max: Math.max(...prices) };
    }
    return result;
  };
  const products = payload.products.map((product) => parseProduct(product));
  for (const variant of flattenCatalogProducts(products)) {
    if (variantIds.has(variant.id) || variantSkus.has(variant.sku)) throw new Error("catalog_invalid");
    variantIds.add(variant.id); variantSkus.add(variant.sku);
  }
  return products;
}

/** Return a complete result set, never a partial page that could erase bag items. */
export async function fetchLiveCatalog(signal?: AbortSignal, query: Partial<Omit<CatalogQuery, "cursor">> = {}): Promise<StoreProduct[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const products: StoreProduct[] = [];
    const ids = new Set<string>();
    const skuIds = new Set<string>();
    const skus = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    let paginated = false;
    for (let page = 0; page < 1000; page += 1) {
      const parameters = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) parameters.set(key, String(value));
      }
      if (cursor) parameters.set("cursor", cursor);
      const suffix = parameters.toString();
      const response = await fetch(`/api/v1/catalog${suffix ? `?${suffix}` : ""}`, {
        cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("catalog_unavailable");
      const payload: unknown = await response.json();
      const items = parseCatalogResponse(payload);
      for (const item of items) {
        if (ids.has(item.id)) throw new Error("catalog_invalid");
        ids.add(item.id);
        products.push(item);
      }
      for (const item of flattenCatalogProducts(items)) {
        if (skuIds.has(item.id) || skus.has(item.sku)) throw new Error("catalog_invalid");
        skuIds.add(item.id);
        skus.add(item.sku);
      }
      const metadata = (payload as { pageInfo?: unknown }).pageInfo;
      if (metadata === undefined) {
        if (paginated) throw new Error("catalog_invalid");
        return products; // Compatibility with the previous single-page service.
      }
      paginated = true;
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("catalog_invalid");
      const info = metadata as { hasMore?: unknown; nextCursor?: unknown };
      if (typeof info.hasMore !== "boolean") throw new Error("catalog_invalid");
      if (!info.hasMore) {
        if (info.nextCursor !== null) throw new Error("catalog_invalid");
        return products;
      }
      if (!items.length || typeof info.nextCursor !== "string" || !info.nextCursor.trim()
        || info.nextCursor.length > 4096 || cursors.has(info.nextCursor)) throw new Error("catalog_invalid");
      cursor = info.nextCursor;
      cursors.add(cursor);
    }
    throw new Error("catalog_too_large");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function scrollWithoutMotion(target?: Element | null): void {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  if (target) target.scrollIntoView({ behavior });
  else window.scrollTo({ top: 0, behavior });
}

/** Only an opaque hash and UUID are persisted, never checkout contact/address fields. */
export async function retryKeyFor(input: unknown): Promise<string> {
  const serialized = new TextEncoder().encode(JSON.stringify(input));
  const digest = await window.crypto.subtle.digest("SHA-256", serialized);
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (inMemoryRetry?.fingerprint === fingerprint) return inMemoryRetry.key;
  const raw = readBrowserValue(CHECKOUT_RETRY_STORAGE_KEY);
  try {
    const saved: unknown = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved === "object") {
      const previous = saved as { fingerprint?: unknown; key?: unknown; attempted?: unknown };
      if (previous.fingerprint === fingerprint && typeof previous.key === "string" &&
          /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(previous.key)) {
        inMemoryRetry = { fingerprint, key: previous.key, attempted: previous.attempted === true };
        return previous.key;
      }
    }
  } catch { /* Replace corrupted retry metadata. */ }
  const key = window.crypto.randomUUID();
  inMemoryRetry = { fingerprint, key };
  writeBrowserValue(CHECKOUT_RETRY_STORAGE_KEY, JSON.stringify({ fingerprint, key }));
  return key;
}

export function clearCheckoutRetry(): void {
  inMemoryRetry = null;
  writeBrowserValue(CHECKOUT_RETRY_STORAGE_KEY, null);
}

export function markCheckoutAttempted(key: string): void {
  if (inMemoryRetry?.key !== key) return;
  inMemoryRetry = { ...inMemoryRetry, attempted: true };
  writeBrowserValue(CHECKOUT_RETRY_STORAGE_KEY, JSON.stringify(inMemoryRetry));
}

export function wasCheckoutAttempted(key: string): boolean {
  return inMemoryRetry?.key === key && inMemoryRetry.attempted === true;
}
