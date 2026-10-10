const reservedProductIds = new Set(["__proto__", "constructor", "prototype"]);

/** Public product IDs are safe URL basenames and safe keys for client shopping bags. */
export function isStorefrontProductId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value)
    && !reservedProductIds.has(value)
    && !Object.prototype.hasOwnProperty.call(Object.prototype, value);
}
