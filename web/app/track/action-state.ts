import type { FulfillmentMode, OrderStatus } from "@shared/ops-types";
import type { PaymentStatus } from "@backend/payments";

export type TrackActionState = {
  kind: "idle" | "found" | "not_found" | "error";
  message: string;
  order: null | {
    orderNumber: string;
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

// Import this client-safe state directly rather than through a server action.
export const initialTrackState: TrackActionState = {
  kind: "idle",
  message: "",
  order: null,
};
