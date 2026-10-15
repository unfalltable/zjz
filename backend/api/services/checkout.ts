import { env } from "cloudflare:workers";
import { createPendingStorefrontOrder, findStorefrontOrderByIdempotency, type StorefrontOrderReceipt } from "@backend/db/storefront";
import { getStorefrontProduct } from "@backend/db/catalog";
import { checkoutSchema, checkoutRequestFingerprint, IdempotencyConflictError } from "@backend/domain/commerce";
import { quoteShipping } from "@backend/db/shipping";
import { destinations } from "@shared/catalog";
import type { FulfillmentMode } from "@shared/ops-types";
import type { PaymentStatus } from "@backend/payments";
import { variantLabel } from "@shared/variants";

export type CreateOrderResult =
  | { ok: true; orderNumber: string; paymentStatus: PaymentStatus; routeModes: FulfillmentMode[]; totalCents: number; inventoryReserved: false }
  | { ok: false; message: string; status: 409 | 422 | 503; code: string };

export async function createPendingOrder(input: unknown): Promise<CreateOrderResult> {
  if ((env as unknown as Record<string, string | undefined>).MIOVA_MAINTENANCE === "true") {
    return failure(503, "maintenance", "The store is being upgraded. Order saving is temporarily paused; keep your bag and retry shortly.");
  }
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return failure(422, "invalid_checkout", "Some checkout details are incomplete. Review them and try again.");
  const ownerId = (env as unknown as Record<string, string | undefined>).STORE_OWNER_ID?.trim();
  if (!ownerId) return failure(503, "store_unavailable", "Order saving is temporarily unavailable. Please try again later.");
  try {
    const requestFingerprint = await checkoutRequestFingerprint(parsed.data);
    // Read accepted intent before mutable product availability. Retries keep the original snapshot.
    const existing = await findStorefrontOrderByIdempotency(ownerId, parsed.data.idempotencyKey, requestFingerprint);
    if (existing) return success(existing);
    const rejectMutableState = async (status: 409 | 422, code: string, message: string): Promise<CreateOrderResult> => {
      // Another same-key request may have been accepted after our first read.
      // The lookup also checks the fingerprint, so different intent remains a conflict.
      const accepted = await findStorefrontOrderByIdempotency(ownerId, parsed.data.idempotencyKey, requestFingerprint);
      return accepted ? success(accepted) : failure(status, code, message);
    };
    const lineItems = [];
    let weightGrams = 0;
    for (const requested of parsed.data.items) {
      // checkoutSchema bounds distinct lines to 20. Resolve only those IDs using the
      // owner/storefront index, never load the entire growing catalogue to save a draft.
      const product = await getStorefrontProduct(ownerId, requested.id);
      if (!product || requested.quantity > product.inventory || !Number.isSafeInteger(product.priceCents)) {
        return await rejectMutableState(422, "item_unavailable", "One item is no longer available in the requested quantity.");
      }
      lineItems.push({ sku: product.sku, name: [product.name, variantLabel(product.variantAttributes)].filter(Boolean).join(" — "), quantity: requested.quantity,
        priceCents: product.priceCents!, fulfillmentMode: product.fulfillmentMode });
      const shippingWeight = product.shippingWeightGrams ?? 500;
      if (!Number.isSafeInteger(shippingWeight) || shippingWeight < 1 || shippingWeight > 1_000_000) {
        return await rejectMutableState(422, "item_unavailable", "One item does not have a valid shipping weight.");
      }
      weightGrams += shippingWeight * requested.quantity;
    }
    const subtotalCents = lineItems.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
    if (parsed.data.expectedSubtotalCents !== undefined && parsed.data.expectedSubtotalCents !== subtotalCents) {
      return await rejectMutableState(409, "price_quote_changed", "Product prices have changed. Review an updated estimate before saving.");
    }
    const shipping = await quoteShipping(ownerId, { country: parsed.data.destination, method: parsed.data.deliveryMethod,
      subtotalCents, weightGrams });
    if (parsed.data.shippingRevision && parsed.data.shippingRevision !== shipping.revision) {
      return await rejectMutableState(409, "shipping_quote_changed", "Shipping settings have changed. Review an updated delivery quote and try again.");
    }
    if (!shipping.available || shipping.shippingCents === null) {
      return await rejectMutableState(422, "shipping_unavailable", "This delivery service is not available for your destination. Choose another service.");
    }
    const shippingCents = shipping.shippingCents;
    if (parsed.data.expectedShippingCents !== undefined && parsed.data.expectedShippingCents !== shippingCents) {
      return await rejectMutableState(409, "shipping_quote_changed", "Shipping prices have changed. Review an updated quote before saving.");
    }
    const routeModes = Array.from(new Set(lineItems.map((item) => item.fulfillmentMode)));
    const order = await createPendingStorefrontOrder({
      ownerId, idempotencyKey: parsed.data.idempotencyKey, requestFingerprint,
      customerEmail: parsed.data.email, customerName: `${parsed.data.firstName} ${parsed.data.lastName}`,
      phone: parsed.data.phone, destination: `${parsed.data.city}, ${destinations[parsed.data.destination].en}`,
      postalCode: parsed.data.postal,
      shippingAddress: [parsed.data.address, parsed.data.apartment, parsed.data.city, parsed.data.region,
        parsed.data.postal, destinations[parsed.data.destination].en].filter(Boolean).join(", "),
      deliveryMethod: parsed.data.deliveryMethod, lineItems, subtotalCents, shippingCents,
      amountCents: subtotalCents + shippingCents, fulfillmentMode: routeModes[0], marketingOptIn: parsed.data.marketingOptIn,
    });
    // A draft is not a paid sale and does not reserve inventory. Payment/fulfillment remain separate.
    return success(order);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) return failure(409, "idempotency_conflict", "This checkout key belongs to different details. Start a new checkout attempt.");
    console.error("Failed to save pending order", error instanceof Error ? error.name : "unknown_error");
    return failure(503, "order_unavailable", "We could not save the order yet. Your bag is still here—please try again.");
  }
}

function success(order: StorefrontOrderReceipt): CreateOrderResult {
  return { ok: true, orderNumber: order.orderNumber, paymentStatus: order.paymentStatus,
    routeModes: order.routeModes, totalCents: order.amountCents, inventoryReserved: false };
}
function failure(status: 409 | 422 | 503, code: string, message: string): CreateOrderResult {
  return { ok: false, status, code, message };
}
