"use server";

import { env } from "cloudflare:workers";
import { z } from "zod";

import { createPendingStorefrontOrder } from "@/db/storefront";
import { destinations, products } from "@/lib/catalog";
import type { FulfillmentMode } from "@/lib/ops-types";

const destinationCodes = Object.keys(destinations) as [keyof typeof destinations, ...(keyof typeof destinations)[]];

const checkoutSchema = z.object({
  idempotencyKey: z.string().uuid(),
  email: z.string().trim().email().max(254),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  address: z.string().trim().min(3).max(180),
  apartment: z.string().trim().max(80),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100),
  postal: z.string().trim().min(3).max(20),
  phone: z.string().trim().min(7).max(30),
  destination: z.enum(destinationCodes),
  deliveryMethod: z.enum(["standard", "express", "priority"]),
  marketingOptIn: z.boolean(),
  website: z.string().max(0),
  items: z.array(z.object({ id: z.string(), quantity: z.number().int().min(1).max(10) })).min(1).max(20),
});

export type CreateOrderResult =
  | {
      ok: true;
      orderNumber: string;
      paymentStatus: "pending";
      routeModes: FulfillmentMode[];
      totalCents: number;
    }
  | { ok: false; message: string };

export async function createPendingOrderAction(input: unknown): Promise<CreateOrderResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Some checkout details are incomplete. Review them and try again." };
  }

  const ownerId = readRuntimeValue("STORE_OWNER_ID");
  if (!ownerId) {
    console.error("STORE_OWNER_ID is not configured");
    return { ok: false, message: "Order saving is temporarily unavailable. Please try again later." };
  }

  const catalogById = new Map(products.map((product) => [product.id, product]));
  const lineItems = [];
  for (const requested of parsed.data.items) {
    const product = catalogById.get(requested.id);
    if (!product || requested.quantity > product.inventory) {
      return { ok: false, message: "One item is no longer available in the requested quantity." };
    }
    lineItems.push({
      sku: product.sku,
      name: product.name,
      quantity: requested.quantity,
      priceCents: Math.round(product.price * 100),
      fulfillmentMode: product.fulfillmentMode,
    });
  }

  const subtotalCents = lineItems.reduce(
    (sum, item) => sum + item.priceCents * item.quantity,
    0
  );
  const shippingCents = calculateShipping(parsed.data.deliveryMethod, subtotalCents);
  const routeModes = Array.from(new Set(lineItems.map((item) => item.fulfillmentMode)));

  try {
    const order = await createPendingStorefrontOrder({
      ownerId,
      idempotencyKey: parsed.data.idempotencyKey,
      customerEmail: parsed.data.email.toLowerCase(),
      customerName: `${parsed.data.firstName} ${parsed.data.lastName}`,
      phone: parsed.data.phone,
      destination: `${parsed.data.city}, ${destinations[parsed.data.destination].en}`,
      postalCode: parsed.data.postal,
      shippingAddress: [
        parsed.data.address,
        parsed.data.apartment,
        parsed.data.city,
        parsed.data.region,
        parsed.data.postal,
        destinations[parsed.data.destination].en,
      ].filter(Boolean).join(", "),
      deliveryMethod: parsed.data.deliveryMethod,
      lineItems,
      subtotalCents,
      shippingCents,
      amountCents: subtotalCents + shippingCents,
      fulfillmentMode: routeModes[0],
      marketingOptIn: parsed.data.marketingOptIn,
    });

    return {
      ok: true,
      orderNumber: order.orderNumber,
      paymentStatus: "pending",
      routeModes: order.routeModes,
      totalCents: order.amountCents,
    };
  } catch (error) {
    console.error("Failed to save pending order", error);
    return { ok: false, message: "We could not save the order yet. Your bag is still here—please try again." };
  }
}

function calculateShipping(method: "standard" | "express" | "priority", subtotalCents: number) {
  if (method === "standard") return subtotalCents >= 7500 ? 0 : 890;
  if (method === "express") return 1890;
  return 3200;
}

function readRuntimeValue(key: string) {
  return (env as unknown as Record<string, string | undefined>)[key]?.trim() ?? "";
}
