import type { StoreCategory, StoreLocale, StoreProduct } from "../../shared/catalog.ts";
import { variantLabel } from "../../shared/variants.ts";
import { normalizeCatalogSearchText as normalizeSearch } from "../../shared/catalog-query.ts";

export type ProductSort = "default" | "price-low" | "price-high";
export type ProductCollection = "all" | "deals" | "saved";
export type PriceBand = "any" | "under-25" | "25-50" | "50-100" | "100-plus";

export type DiscoveryFilters = {
  locale: StoreLocale;
  category: StoreCategory;
  query: string;
  sort: ProductSort;
  collection: ProductCollection;
  priceBand: PriceBand;
  inStockOnly: boolean;
  favorites: Record<string, boolean>;
};

function validCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Explicit cents, including zero, take precedence over legacy dollar prices. */
export function productPriceCents(product: StoreProduct): number {
  const available = product.variants?.filter((variant) => variant.inventory > 0);
  const priced = available?.length ? available : product.variants;
  const cents = priced?.length ? Math.min(...priced.map((variant) => variant.priceCents ?? Math.round(variant.price * 100)))
    : product.priceCents === undefined ? Math.round(product.price * 100) : product.priceCents;
  return validCents(cents) ? cents : NaN;
}

function comparePriceCents(product: StoreProduct): number | null {
  const cents = product.compareAtCents === undefined
    ? product.compareAt === null ? null : Math.round(product.compareAt * 100)
    : product.compareAtCents;
  return cents !== null && validCents(cents) ? cents : null;
}

/** A deal is backed by actual catalogue prices, never by a promotional badge. */
export function hasProductDiscount(product: StoreProduct): boolean {
  if (product.variants?.length) {
    const available = product.variants.filter((variant) => variant.inventory > 0);
    return (available.length ? available : product.variants).some((variant) => hasProductDiscount(variant));
  }
  const price = productPriceCents(product);
  const compareAt = comparePriceCents(product);
  return Number.isFinite(price) && compareAt !== null && compareAt > price;
}

/** Round down rather than overstate savings; omit a percentage below one percent. */
export function productDiscountPercent(product: StoreProduct): number | null {
  // A group must not advertise one SKU's discount as the entire group's saving.
  if (product.variants?.length) return null;
  const price = productPriceCents(product);
  const compareAt = comparePriceCents(product);
  if (!Number.isFinite(price) || compareAt === null || compareAt <= price) return null;
  const percent = Math.floor(((compareAt - price) * 100) / compareAt);
  return percent >= 1 ? percent : null;
}

const categorySearchAliases: Record<Exclude<StoreCategory, "all">, string> = {
  home: "家居 家居生活 hogar home living",
  tech: "数码 数码电子 科技 electronics tech tecnología electronica electrónica",
  wear: "箱包 配饰 箱包配饰 bags accessories bolsos accesorios",
};

function searchableText(product: StoreProduct): string {
  const text = [product.name, product.sku, categorySearchAliases[product.category]];
  for (const variant of product.variants ?? []) text.push(variant.sku, variantLabel(variant.variantAttributes));
  // A shopper can search a familiar translation without changing the page language.
  for (const locale of ["en", "zh", "es"] as const) {
    text.push(product.description[locale], product.detail[locale], product.badge[locale]);
  }
  return normalizeSearch(text.join(" "));
}

function matchesPriceBand(cents: number, band: PriceBand): boolean {
  if (band === "any") return true;
  if (!Number.isFinite(cents)) return false;
  switch (band) {
    case "under-25": return cents < 2500;
    case "25-50": return cents >= 2500 && cents < 5000;
    case "50-100": return cents >= 5000 && cents < 10000;
    case "100-plus": return cents >= 10000;
  }
}

/** Return a new array while retaining catalogue order unless a price sort is requested. */
export function discoverProducts(products: StoreProduct[], filters: DiscoveryFilters): StoreProduct[] {
  const tokens = normalizeSearch(filters.query).split(" ").filter(Boolean);
  const matches = products.filter((product) => {
    if (filters.category !== "all" && product.category !== filters.category) return false;
    if (filters.collection === "deals" && !hasProductDiscount(product)) return false;
    if (filters.collection === "saved" &&
        (!Object.hasOwn(filters.favorites, product.id) || filters.favorites[product.id] !== true)) return false;
    const inventory = product.variants?.reduce((sum, variant) => sum + variant.inventory, 0) ?? product.inventory;
    if (filters.inStockOnly && (!Number.isFinite(inventory) || inventory <= 0)) return false;
    if (!matchesPriceBand(productPriceCents(product), filters.priceBand)) return false;
    if (tokens.length) {
      const text = searchableText(product);
      if (!tokens.every((token) => text.includes(token))) return false;
    }
    return true;
  });
  if (filters.sort === "default") return matches;
  const direction = filters.sort === "price-low" ? 1 : -1;
  return matches.sort((left, right) => {
    const leftPrice = productPriceCents(left), rightPrice = productPriceCents(right);
    if (!Number.isFinite(leftPrice)) return Number.isFinite(rightPrice) ? 1 : 0;
    if (!Number.isFinite(rightPrice)) return -1;
    return direction * (leftPrice - rightPrice);
  });
}
