import { z } from "zod";

export const destinationCodes = ["US", "CA", "GB", "DE", "AU", "FR"] as const;
export const deliveryMethods = ["standard", "express", "priority"] as const;
export const commerceOrderStatuses = ["payment_pending", "purchase", "packing", "handoff", "transit", "delivered"] as const;
export const commerceFulfillmentModes = ["marketplace", "self", "supplier"] as const;
export type CommerceOrderStatus = (typeof commerceOrderStatuses)[number];
export type CommercePaymentStatus = "pending" | "paid" | "failed" | "refunded";

export const checkoutSchema = z.object({
  idempotencyKey: z.string().uuid(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  address: z.string().trim().min(3).max(180),
  apartment: z.string().trim().max(80),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100),
  postal: z.string().trim().min(3).max(20),
  phone: z.string().trim().min(7).max(30),
  destination: z.enum(destinationCodes),
  deliveryMethod: z.enum(deliveryMethods),
  marketingOptIn: z.boolean(),
  website: z.string().max(0),
  items: z.array(z.object({ id: z.string().trim().min(1).max(64), quantity: z.number().int().min(1).max(10) }))
    .min(1).max(20)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Duplicate products are not allowed"),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

// Only request intent belongs in the fingerprint. Prices/inventory can change after an accepted draft.
export function canonicalCheckoutRequest(input: CheckoutInput): string {
  return JSON.stringify({
    email: input.email, firstName: input.firstName, lastName: input.lastName,
    address: input.address, apartment: input.apartment, city: input.city, region: input.region,
    postal: input.postal, phone: input.phone, destination: input.destination,
    deliveryMethod: input.deliveryMethod, marketingOptIn: input.marketingOptIn,
    items: [...input.items].map(({ id, quantity }) => ({ id, quantity })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  });
}

export async function checkoutRequestFingerprint(input: CheckoutInput): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalCheckoutRequest(input)));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function availableInventory(stock: number, reserved: number): number {
  if (!Number.isSafeInteger(stock) || !Number.isSafeInteger(reserved) || stock < 0 || reserved < 0) return 0;
  return Math.max(0, stock - reserved);
}

export function isValidPriceCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 100_000_000;
}

export function validateStockAdjustment(quantity: unknown, note?: unknown): boolean {
  return typeof quantity === "number" && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 1000
    && (note === undefined || (typeof note === "string" && note.length <= 200));
}

export function calculateShipping(method: (typeof deliveryMethods)[number], subtotalCents: number): number {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) throw new Error("invalid_subtotal");
  if (method === "standard") return subtotalCents >= 7500 ? 0 : 890;
  if (method === "express") return 1890;
  if (method === "priority") return 3200;
  throw new Error("invalid_delivery_method");
}

export const statusProgress: Record<CommerceOrderStatus, number> = {
  payment_pending: 5, purchase: 22, packing: 46, handoff: 70, transit: 88, delivered: 100,
};
const nextStatus: Partial<Record<CommerceOrderStatus, CommerceOrderStatus>> = {
  payment_pending: "purchase", purchase: "packing", packing: "handoff", handoff: "transit", transit: "delivered",
};

export function validateOrderTransition(current: CommerceOrderStatus, target: CommerceOrderStatus, payment: CommercePaymentStatus):
  "allowed" | "unchanged" | "unpaid" | "invalid_transition" {
  if (!(commerceOrderStatuses as readonly string[]).includes(current) || !(commerceOrderStatuses as readonly string[]).includes(target)) return "invalid_transition";
  if (current === target) return "unchanged";
  if (payment !== "paid") return "unpaid";
  return nextStatus[current] === target ? "allowed" : "invalid_transition";
}

export function legalNextStatuses(current: CommerceOrderStatus, payment: CommercePaymentStatus): CommerceOrderStatus[] {
  const next = nextStatus[current];
  return payment === "paid" && next ? [next] : [];
}

export class IdempotencyConflictError extends Error {
  constructor() { super("idempotency_conflict"); this.name = "IdempotencyConflictError"; }
}

export function assertMatchingFingerprint(existing: string | null, requested: string): void {
  // Historical drafts have no reliable fingerprint: never guess whether a changed request is a retry.
  if (!existing || existing !== requested) throw new IdempotencyConflictError();
}
