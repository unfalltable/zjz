import { z } from "zod";
import { shippingCountries, shippingMethods } from "../../shared/shipping.ts";
import type { ShippingMethod, ShippingQuote, ShippingQuotesResponse } from "../../shared/shipping.ts";

const quotesSchema = z.object({
  ok: z.literal(true), apiVersion: z.literal("v1"), country: z.enum(shippingCountries), currency: z.literal("USD"),
  subtotalCents: z.number().int().safe().min(0), weightGrams: z.number().int().safe().min(0), configured: z.boolean(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  quotes: z.array(z.object({ available: z.boolean(), country: z.enum(shippingCountries), method: z.enum(shippingMethods),
    revision: z.string().regex(/^[a-f0-9]{64}$/), shippingCents: z.number().int().safe().min(0).nullable(),
    minDays: z.number().int().safe().min(0).nullable(), maxDays: z.number().int().safe().min(0).nullable(),
    ruleId: z.string().nullable(), carrierCode: z.string().nullable(),
    reason: z.enum(["country_not_served", "route_disabled", "carrier_disabled", "no_rule"]).nullable() })).max(3),
});
export async function fetchShippingQuotes(country: string, items: Array<{ id: string; quantity: number }>, signal?: AbortSignal): Promise<ShippingQuotesResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    controller.signal.throwIfAborted();
    const query = new URLSearchParams({ country, items: JSON.stringify(items) });
    const response = await fetch(`/api/v1/shipping?${query}`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("shipping_unavailable");
    const value = quotesSchema.parse(await response.json());
    controller.signal.throwIfAborted();
    if (value.country !== country || value.quotes.some((quote) => quote.country !== country || quote.revision !== value.revision)
      || new Set(value.quotes.map((quote) => quote.method)).size !== value.quotes.length
      || value.quotes.some((quote) => quote.available && (quote.shippingCents === null || quote.minDays === null || quote.maxDays === null))
      || value.quotes.some((quote) => quote.minDays !== null && quote.maxDays !== null && quote.maxDays < quote.minDays)) {
      throw new Error("invalid_shipping_quote");
    }
    return value;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

/** Updating the available choice never counts as accepting a new delivery quote. */
export function availableShippingMethod(response: ShippingQuotesResponse, current: ShippingMethod): ShippingMethod {
  return response.quotes.some((quote) => quote.method === current && quote.available)
    ? current : response.quotes.find((quote) => quote.available)?.method ?? current;
}

type ShippingReview =
  | { status: "ready"; quote: ShippingQuote }
  | { status: "price_changed" }
  | { status: "shipping_changed" };

/** Recheck the exact service the shopper reviewed before creating a draft. */
export function reviewShippingQuote(
  latest: ShippingQuotesResponse,
  reviewed: ShippingQuotesResponse | null,
  method: ShippingMethod,
  subtotalCents: number,
): ShippingReview {
  if (latest.subtotalCents !== reviewed?.subtotalCents || latest.subtotalCents !== subtotalCents) {
    return { status: "price_changed" };
  }
  const quote = latest.quotes.find((item) => item.method === method);
  const previous = reviewed.quotes.find((item) => item.method === method);
  if (latest.country !== reviewed.country || latest.revision !== reviewed.revision ||
      !quote?.available || quote.shippingCents === null || !previous?.available ||
      quote.shippingCents !== previous.shippingCents ||
      quote.minDays !== previous.minDays || quote.maxDays !== previous.maxDays) {
    return { status: "shipping_changed" };
  }
  return { status: "ready", quote };
}
