import { z } from "zod";
import { shippingCountries, shippingMethods } from "@shared/shipping";
import type { ShippingQuotesResponse } from "@shared/shipping";

const quotesSchema = z.object({
  ok: z.literal(true), apiVersion: z.literal("v1"), country: z.enum(shippingCountries), currency: z.literal("USD"),
  subtotalCents: z.number().int().min(0), weightGrams: z.number().int().min(0), configured: z.boolean(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  quotes: z.array(z.object({ available: z.boolean(), country: z.enum(shippingCountries), method: z.enum(shippingMethods),
    revision: z.string().regex(/^[a-f0-9]{64}$/), shippingCents: z.number().int().min(0).nullable(),
    minDays: z.number().int().min(0).nullable(), maxDays: z.number().int().min(0).nullable(),
    ruleId: z.string().nullable(), carrierCode: z.string().nullable(),
    reason: z.enum(["country_not_served", "route_disabled", "carrier_disabled", "no_rule"]).nullable() })).max(3),
});
export async function fetchShippingQuotes(country: string, items: Array<{ id: string; quantity: number }>, signal?: AbortSignal): Promise<ShippingQuotesResponse> {
  const query = new URLSearchParams({ country, items: JSON.stringify(items) });
  const response = await fetch(`/api/v1/shipping?${query}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error("shipping_unavailable");
  const value = quotesSchema.parse(await response.json());
  if (value.country !== country || value.quotes.some((quote) => quote.country !== country || quote.revision !== value.revision)
    || new Set(value.quotes.map((quote) => quote.method)).size !== value.quotes.length
    || value.quotes.some((quote) => quote.available && (quote.shippingCents === null || quote.minDays === null || quote.maxDays === null))) {
    throw new Error("invalid_shipping_quote");
  }
  return value;
}
