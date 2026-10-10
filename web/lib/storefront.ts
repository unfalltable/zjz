import type { StoreLocale, StoreProduct } from "@shared/catalog";
import type { CatalogQuery } from "@shared/catalog-query";
import { isProductImage } from "../../shared/assets.ts";
import { isStorefrontProductId } from "../../shared/product-id.ts";

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
  for (const product of products) {
    const quantity = Math.min(bag[product.id] ?? 0, productQuantityLimit(product));
    if (quantity > 0) reconciled[product.id] = quantity;
  }
  return reconciled;
}

export function shoppingBagNeedsReview(bag: ShoppingBag, products: StoreProduct[]): boolean {
  const current = new Map(products.map((product) => [product.id, product]));
  return Object.entries(bag).some(([id, quantity]) => {
    const product = current.get(id);
    return !product || quantity > productQuantityLimit(product);
  });
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
  return payload.products.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("catalog_invalid");
    const product = value as StoreProduct;
    const priceCents = product.priceCents ?? Math.round(product.price * 100);
    if (!isStorefrontProductId(product.id) || seen.has(product.id) ||
        typeof product.name !== "string" || typeof product.sku !== "string" ||
        !Number.isSafeInteger(priceCents) || priceCents < 0 ||
        !Number.isSafeInteger(product.inventory) || product.inventory < 0 ||
        !isSafeProductImage(product.image) ||
        !["home", "tech", "wear"].includes(product.category) ||
        !["blue", "ice", "coral"].includes(product.color) ||
        !["marketplace", "self", "supplier"].includes(product.fulfillmentMode) ||
        !isLocalizedText(product.badge) || !isLocalizedText(product.description) || !isLocalizedText(product.detail)) {
      throw new Error("catalog_invalid");
    }
    seen.add(product.id);
    return { ...product, price: priceCents / 100, priceCents };
  });
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
