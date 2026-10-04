"use server";

import { env } from "cloudflare:workers";
import { z } from "zod";

import { trackStorefrontOrder } from "@backend/db/storefront";
import type { FulfillmentMode, OrderStatus } from "@shared/ops-types";
import type { PaymentStatus } from "@backend/payments";

export type TrackActionState = {
  kind: "idle" | "found" | "not_found" | "error";
  message: string;
  order: null | {
    orderNumber: string;
    customerName: string;
    destination: string;
    productName: string;
    amountCents: number;
    currency: string;
    deliveryMethod: string;
    fulfillmentMode: FulfillmentMode;
    routeModes: FulfillmentMode[];
    paymentStatus: PaymentStatus;
    status: OrderStatus;
    progress: number;
    createdAt: string;
    updatedAt: string;
  };
};

export const initialTrackState: TrackActionState = {
  kind: "idle",
  message: "",
  order: null,
};

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

    return { kind: "found", message: "Order found.", order };
  } catch (error) {
    console.error("Order tracking failed", error);
    return { kind: "error", message: "Tracking is temporarily unavailable. Please try again.", order: null };
  }
}
