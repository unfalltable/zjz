import type { FulfillmentMode } from "./ops-types";

export type OperationResult = { ok: boolean; code?: string; message?: string };
export type OrderReviewStatus = "unreviewed" | "confirmed" | "cancelled";
export type AdminOrderLine = { sku: string; name: string; quantity: number; priceCents: number; fulfillmentMode: FulfillmentMode; reservedQuantity: number; shippedQuantity: number; afterSaleQuantity: number };
export type ShipmentLineInput = { sku: string; quantity: number };
export type ShipmentStatus = "shipped" | "transit" | "delivered";
export type CreateShipmentInput = { fulfillmentMode: FulfillmentMode; carrierCode: string; trackingNumber: string; trackingUrl?: string; lines: ShipmentLineInput[]; note?: string };
export type UpdateShipmentInput = { status: ShipmentStatus; note: string; trackingNumber?: string; trackingUrl?: string };
export type AdminShipment = { id: string; orderNumber: string; fulfillmentMode: FulfillmentMode; carrierCode: string; trackingNumber: string; trackingUrl: string | null; status: ShipmentStatus; lines: ShipmentLineInput[]; note: string | null; version: number; createdAt: string; updatedAt: string };
export type AfterSaleStatus = "requested" | "approved" | "rejected" | "received" | "refund_pending" | "closed";
export type CreateAfterSaleInput = { kind: "return" | "refund"; reason: string; lines: ShipmentLineInput[]; amountCents: number };
export type UpdateAfterSaleInput = { action: "approve" | "reject" | "receive" | "queue_refund" | "close"; note: string; restock?: boolean };
export type AdminAfterSale = { id: string; orderNumber: string; kind: "return" | "refund"; reason: string; lines: ShipmentLineInput[]; amountCents: number; status: AfterSaleStatus; restocked: boolean; note: string | null; version: number; createdAt: string; updatedAt: string };
export type AdminOrderSummary = { orderNumber: string; customerName: string; customerEmail: string | null; destination: string; productName: string; amountCents: number; currency: string; paymentStatus: "pending" | "paid" | "failed" | "refunded"; status: string; reviewStatus: OrderReviewStatus; version: number; createdAt: string; updatedAt: string };
export type AdminOrderAudit = { id: string; action: string; note: string | null; details: string | null; actorId: string; createdAt: string };
export type AdminOrderDetail = AdminOrderSummary & { phone: string | null; postalCode: string | null; shippingAddress: string | null; deliveryMethod: string | null; shippingCents: number; fulfillmentMode: FulfillmentMode; reviewNote: string | null; lines: AdminOrderLine[]; shipments: AdminShipment[]; afterSales: AdminAfterSale[]; auditEvents: AdminOrderAudit[] };
export type AdminOrdersPage = { orders: AdminOrderSummary[]; total: number; page: number; pageSize: number };
export type AdminAfterSalesPage = { cases: AdminAfterSale[]; total: number; page: number; pageSize: number };
