import type { StoreCategory, StoreLocale, StoreProduct } from "./catalog";

export const CATALOG_DEFAULT_LIMIT = 50;
export const CATALOG_MAX_LIMIT = 100;
export const CATALOG_MAX_QUERY_LENGTH = 100;
export const CATALOG_MAX_CURSOR_LENGTH = 4096;
export const catalogSortOrders = ["featured", "price-low", "price-high"] as const;
export type CatalogSortOrder = (typeof catalogSortOrders)[number];

export type CatalogQuery = {
  q?: string;
  category?: StoreCategory;
  locale?: StoreLocale;
  sort?: CatalogSortOrder;
  limit?: number;
  cursor?: string | null;
};
export type NormalizedCatalogQuery = {
  q: string;
  category: StoreCategory;
  locale: StoreLocale;
  sort: CatalogSortOrder;
  limit: number;
  cursor: string | null;
};
export type CatalogPageInfo = { hasMore: boolean; nextCursor: string | null };
export type CatalogPage = { products: StoreProduct[]; pageInfo: CatalogPageInfo };

export class CatalogQueryError extends Error {
  constructor(message = "Invalid catalogue query.") { super(message); this.name = "CatalogQueryError"; }
}

/** Shared validation; cursor contents are validated again against the store/query in the DB layer. */
export function normalizeCatalogQuery(input: CatalogQuery = {}): NormalizedCatalogQuery {
  const q = input.q ?? "";
  const category = input.category ?? "all";
  const locale = input.locale ?? "en";
  const sort = input.sort ?? "featured";
  const limit = input.limit ?? CATALOG_DEFAULT_LIMIT;
  const cursor = input.cursor ?? null;
  if (typeof q !== "string" || q.length > CATALOG_MAX_QUERY_LENGTH ||
      !["all", "home", "tech", "wear"].includes(category) ||
      !["en", "zh", "es"].includes(locale) ||
      !(catalogSortOrders as readonly string[]).includes(sort) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > CATALOG_MAX_LIMIT ||
      (cursor !== null && (typeof cursor !== "string" || !cursor || cursor.length > CATALOG_MAX_CURSOR_LENGTH))) {
    throw new CatalogQueryError();
  }
  return { q: q.trim().toLowerCase(), category, locale, sort, limit, cursor };
}

export function catalogQueryFromSearchParams(params: URLSearchParams): NormalizedCatalogQuery {
  for (const key of ["q", "category", "locale", "sort", "limit", "cursor"]) {
    if (params.getAll(key).length > 1) throw new CatalogQueryError("Duplicate catalogue parameters are not allowed.");
  }
  const rawLimit = params.get("limit");
  if (rawLimit !== null && !/^[1-9]\d{0,2}$/.test(rawLimit)) throw new CatalogQueryError();
  return normalizeCatalogQuery({
    q: params.get("q") ?? undefined,
    category: (params.get("category") ?? undefined) as StoreCategory | undefined,
    locale: (params.get("locale") ?? undefined) as StoreLocale | undefined,
    sort: (params.get("sort") ?? undefined) as CatalogSortOrder | undefined,
    limit: rawLimit === null ? undefined : Number(rawLimit),
    cursor: params.get("cursor"),
  });
}
