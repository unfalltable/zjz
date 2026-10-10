export const orderStatuses = [
  "payment_pending",
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
  routeModes: FulfillmentMode[];
  paymentStatus: "pending" | "paid" | "failed" | "refunded";
  status: OrderStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  version?: number;
  inventoryReserved?: false;
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
  storefrontId?: string | null;
  priceCents?: number | null;
  compareAtCents?: number | null;
  inventory?: number;
  category?: "home" | "tech" | "wear" | null;
  image?: string | null;
  version?: number;
  metadata?: OpsProductMetadata | null;
};

export type OpsProductMetadata = {
  color: "blue" | "ice" | "coral";
  badge: Record<"en" | "zh" | "es", string>;
  description: Record<"en" | "zh" | "es", string>;
  detail: Record<"en" | "zh" | "es", string>;
};

export type OpsSnapshot = {
  orders: OpsOrder[];
  products: OpsProduct[];
  auditEvents?: OpsAuditEvent[];
};

export type OpsAuditEvent = {
  id: string;
  time: string;
  entity: "order" | "inventory" | "catalog";
  entityId: string;
  action: string;
  actorId: string;
  details?: string;
};
