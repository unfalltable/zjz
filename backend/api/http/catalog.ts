import { env } from "cloudflare:workers";
import { destinations } from "@shared/catalog";
import { getStorefrontCatalogPage } from "@backend/db/catalog";
import { CatalogQueryError, catalogQueryFromSearchParams } from "@shared/catalog-query";
import { paymentAvailability } from "@backend/payments";
import { json, errorResponse, HttpError } from "./json";
export async function GET(request?: Request) {
  try {
    const query = catalogQueryFromSearchParams(request ? new URL(request.url).searchParams : new URLSearchParams());
    const ownerId = (env as unknown as Record<string, string | undefined>).STORE_OWNER_ID?.trim();
    if (!ownerId) throw new HttpError(503, "The store catalogue is temporarily unavailable.");
    const page = await getStorefrontCatalogPage(ownerId, query);
    return json({ ok: true, apiVersion: "v1", currency: "USD", locales: ["en", "zh", "es"],
      destinations, payments: paymentAvailability, ...page,
    });
  } catch (error) {
    return errorResponse(error instanceof CatalogQueryError ? new HttpError(400, error.message) : error);
  }
}
