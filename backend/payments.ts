export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type PaymentSession = {
  provider: string;
  sessionId: string;
  checkoutUrl: string;
};

export type PaymentSessionInput = {
  orderNumber: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  returnUrl: string;
};

export interface PaymentProvider {
  createSession(input: PaymentSessionInput): Promise<PaymentSession>;
}

export const paymentAvailability = {
  enabled: false,
  code: "merchant_verification_required",
  message: "Online payment will open after merchant verification is complete.",
} as const;

export function assertPaymentsEnabled(): never {
  throw new Error(paymentAvailability.code);
}
