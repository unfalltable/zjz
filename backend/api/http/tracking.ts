import { env } from "cloudflare:workers";
import { z } from "zod";
import { trackStorefrontOrder } from "@backend/db/storefront";
import { errorResponse, HttpError, json, readJson } from "./json";
const lookup = z.object({
  orderNumber: z.string().trim().toUpperCase().regex(/^MW-\d{5,8}$/),
  email: z.string().trim().email().max(254),
});
export async function POST(request: Request) {
  try {
    const parsed = lookup.safeParse(await readJson(request));
    if (!parsed.success) throw new HttpError(422, "Enter a valid order number and checkout email.");
    const ownerId = (env as unknown as Record<string, string>).STORE_OWNER_ID?.trim();
    if (!ownerId) throw new HttpError(503, "Order tracking is temporarily unavailable.");
    const order = await trackStorefrontOrder(ownerId, parsed.data.orderNumber, parsed.data.email.toLowerCase());
    if (!order) throw new HttpError(404, "We could not match that order number and email.");
    // Keep personal contact details and recipient addresses off the public API.
    return json({ ok: true, order: {
      orderNumber: order.orderNumber, productName: order.productName,
      amountCents: order.amountCents, currency: order.currency,
      deliveryMethod: order.deliveryMethod, paymentStatus: order.paymentStatus,
      status: order.status, progress: order.progress, routeModes: order.routeModes,
      createdAt: order.createdAt, updatedAt: order.updatedAt,
    } });
  } catch (error) { return errorResponse(error); }
}
