export const shippingMethods = ["standard", "express", "priority"] as const;
export const shippingCountries = ["US", "CA", "GB", "DE", "AU", "FR"] as const;
export type ShippingMethod = (typeof shippingMethods)[number];
export type ShippingCountry = (typeof shippingCountries)[number];

export type ShippingRule = {
  id: string;
  name: string;
  method: ShippingMethod;
  countries: ShippingCountry[];
  baseCents: number;
  includedWeightGrams: number;
  stepWeightGrams: number;
  stepCents: number;
  freeAboveCents: number | null;
  minDays: number;
  maxDays: number;
  carrierCode: string | null;
  enabled: boolean;
  version: number;
  updatedAt: string;
};

export type Carrier = {
  code: string;
  name: string;
  trackingUrlTemplate: string;
  enabled: boolean;
  version: number;
  updatedAt: string;
};
export type ShippingRuleInput = Omit<ShippingRule, "version" | "updatedAt"> & { expectedVersion: number };
export type CarrierInput = Omit<Carrier, "version" | "updatedAt"> & { expectedVersion: number };
export type ShippingSettings = { rules: ShippingRule[]; carriers: Carrier[]; configured: boolean; revision: string };
export type ShippingQuote = {
  available: boolean;
  country: ShippingCountry;
  method: ShippingMethod;
  revision: string;
  shippingCents: number | null;
  minDays: number | null;
  maxDays: number | null;
  ruleId: string | null;
  carrierCode: string | null;
  reason: "country_not_served" | "route_disabled" | "carrier_disabled" | "no_rule" | null;
};
export type ShippingQuotesResponse = {
  ok: true;
  apiVersion: "v1";
  country: ShippingCountry;
  currency: "USD";
  subtotalCents: number;
  weightGrams: number;
  configured: boolean;
  revision: string;
  quotes: ShippingQuote[];
};

// This is a browser-link template, not an integration or a server-side URL fetch.
// Public HTTPS DNS names only; placeholders must be in path/query, never the authority.
export function isSafeTrackingUrlTemplate(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)
    || value.split("{trackingNumber}").length !== 2 || /\{(?!trackingNumber\})/.test(value)) return false;
  try {
    const url = new URL(value.replace("{trackingNumber}", "TRACKING123"));
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hash) return false;
    const hostname = url.hostname.toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)
      || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(hostname) || hostname.includes("tracking123")) return false;
    return url.pathname.includes("TRACKING123") || url.search.includes("TRACKING123");
  } catch { return false; }
}

export function carrierTrackingUrl(template: string, trackingNumber: string): string | null {
  if (!isSafeTrackingUrlTemplate(template) || !trackingNumber || trackingNumber.length > 128 || /[\u0000-\u001f\u007f]/.test(trackingNumber)) return null;
  return template.replace("{trackingNumber}", encodeURIComponent(trackingNumber));
}
