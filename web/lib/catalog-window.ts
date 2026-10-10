export const CATALOG_VISIBLE_BATCH_SIZE = 24;
export type CatalogWindow = { scope: string; limit: number };

/** UI-only display window; never use this subset to reconcile a shopping bag. */
export function catalogWindowLimit(window: CatalogWindow, scope: string): number {
  return window.scope === scope && Number.isSafeInteger(window.limit) && window.limit > 0
    ? window.limit : CATALOG_VISIBLE_BATCH_SIZE;
}

export function expandCatalogWindow(window: CatalogWindow, scope: string, total: number): CatalogWindow {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("invalid_catalog_count");
  return { scope, limit: Math.min(catalogWindowLimit(window, scope) + CATALOG_VISIBLE_BATCH_SIZE, total) };
}
