"use server";

import { env } from "cloudflare:workers";
import { z } from "zod";

import { trackStorefrontOrder } from "@backend/db/storefront";
import type { TrackActionState } from "./action-state";
export type { TrackActionState } from "./action-state";

const trackSchema = z.object({
  orderNumber: z.string().trim().toUpperCase().regex(/^MW-\d{5,8}$/),
  email: z.string().trim().email().max(254),
});

export async function lookupOrderAction(
  _previous: TrackActionState,
  formData: FormData
): Promise<TrackActionState> {
  const parsed = trackSchema.safeParse({
    orderNumber: formData.get("orderNumber"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { kind: "error", message: "Enter a valid order number and checkout email.", order: null };
  }

  const ownerId = (env as unknown as Record<string, string | undefined>).STORE_OWNER_ID?.trim();
  if (!ownerId) {
    return { kind: "error", message: "Order tracking is temporarily unavailable.", order: null };
  }

  try {
    const order = await trackStorefrontOrder(
      ownerId,
      parsed.data.orderNumber,
      parsed.data.email.toLowerCase()
    );
    if (!order) {
      return {
        kind: "not_found",
        message: "We could not match that order number and email. Check both and try again.",
        order: null,
      };
    }

    // Explicit projection: TypeScript narrowing alone does not remove receipt PII at runtime.
    return { kind: "found", message: "Order found.", order: {
      orderNumber: order.orderNumber,
      productName: order.productName,
      amountCents: order.amountCents,
      currency: order.currency,
      deliveryMethod: order.deliveryMethod,
      fulfillmentMode: order.fulfillmentMode,
      routeModes: order.routeModes,
      paymentStatus: order.paymentStatus,
      status: order.status,
      progress: order.progress,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    } };
  } catch (error) {
    console.error("Order tracking failed", error);
    return { kind: "error", message: "Tracking is temporarily unavailable. Please try again.", order: null };
  }
}
