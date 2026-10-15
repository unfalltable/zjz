import { env } from "cloudflare:workers";
import { z } from "zod";
import { MAX_BAG_LINES } from "@shared/catalog";
import { getStorefrontProduct } from "@backend/db/catalog";
import { getShippingSettings, quoteShippingFromSettings } from "@backend/db/shipping";
import { shippingCountries, shippingMethods, type ShippingQuotesResponse } from "@shared/shipping";
import { errorResponse, HttpError, json } from "./json";

const requestSchema = z.object({
  country: z.enum(shippingCountries),
  items: z.array(z.object({ id: z.string().trim().min(1).max(64), quantity: z.number().int().min(1).max(10) }))
    .min(1).max(MAX_BAG_LINES).refine((items) => new Set(items.map((item) => item.id)).size === items.length),
});

// Public, read-only quote. Client prices and package weights are never authoritative.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const rawItems = params.get("items") ?? "";
    if (rawItems.length > 8192) throw new HttpError(400, "The shipping request is too large.");
    let items: unknown;
    try { items = JSON.parse(rawItems); }
    catch { throw new HttpError(400, "Provide a country and a valid shopping bag."); }
    const parsed = requestSchema.safeParse({ country: params.get("country"), items });
    if (!parsed.success) throw new HttpError(400, "Provide a supported country and up to 20 distinct items.");
    const ownerId = (env as unknown as Record<string, string | undefined>).STORE_OWNER_ID?.trim();
    if (!ownerId) throw new HttpError(503, "Shipping quotes are temporarily unavailable.");
    let subtotalCents = 0;
    let weightGrams = 0;
    for (const item of parsed.data.items) {
      const product = await getStorefrontProduct(ownerId, item.id);
      if (!product || item.quantity > product.inventory || !Number.isSafeInteger(product.priceCents)) {
        throw new HttpError(422, "An item is no longer available in the requested quantity.");
      }
      const weight = product.shippingWeightGrams ?? 500;
      if (!Number.isSafeInteger(weight) || weight < 1 || weight > 1_000_000) throw new Error("invalid_product_shipping_weight");
      subtotalCents += product.priceCents! * item.quantity;
      weightGrams += weight * item.quantity;
    }
    const settings = await getShippingSettings(ownerId);
    const body: ShippingQuotesResponse = { ok: true, apiVersion: "v1", country: parsed.data.country,
      currency: "USD", subtotalCents, weightGrams, configured: settings.configured, revision: settings.revision,
      quotes: shippingMethods.map((method) => ({ ...quoteShippingFromSettings(settings, {
        country: parsed.data.country, method, subtotalCents, weightGrams,
      }), ruleId: null, carrierCode: null })),
    };
    return json(body);
  } catch (error) { return errorResponse(error); }
}
