export const orderStatuses = [
  "purchase",
  "packing",
  "handoff",
  "transit",
  "delivered",
] as const;

export const fulfillmentModes = ["marketplace", "self", "supplier"] as const;

export type OrderStatus = (typeof orderStatuses)[number];
export type FulfillmentMode = (typeof fulfillmentModes)[number];

export type OpsOrder = {
  orderNumber: string;
  customerName: string;
  destination: string;
  productName: string;
  amountCents: number;
  currency: string;
  fulfillmentMode: FulfillmentMode;
  status: OrderStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
};

export type OpsProduct = {
  sku: string;
  name: string;
  stock: number;
  reserved: number;
  inbound: number;
  defaultFulfillment: FulfillmentMode;
  status: "active" | "paused";
  updatedAt: string;
};

export type OpsSnapshot = {
  orders: OpsOrder[];
  products: OpsProduct[];
};
