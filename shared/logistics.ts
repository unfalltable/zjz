import type { FulfillmentMode } from "./ops-types";
import type { ShipmentLineInput } from "./admin-commerce";

/** No API keys, signed label URLs, or private address snapshots leave this DTO. */
export type LogisticsConfiguration = {
  provider: "shippo"; mode: "disabled" | "test" | "live"; tokenConfigured: boolean;
  purchaseEnabled: boolean; pollingEnabled: boolean; carrierMap: Record<string, string>;
};
export type LogisticsAddress = {
  name: string; street1: string; street2?: string; city: string; state: string;
  zip: string; country: string; phone: string; email?: string;
};
export type LogisticsParcel = { lengthCm: number; widthCm: number; heightCm: number; weightGrams: number };
export type LogisticsCustoms = {
  certifySigner: string; nonDeliveryOption: "RETURN" | "ABANDON";
  items: { sku: string; description: string; originCountry: string; hsCode: string; weightGrams: number }[];
};
export type LabelDraftInput = {
  fulfillmentMode: FulfillmentMode; carrierCode: string; lines: ShipmentLineInput[];
  addressFrom: LogisticsAddress; addressTo: LogisticsAddress; parcel: LogisticsParcel;
  customs?: LogisticsCustoms; confirmAddress: true;
};
export type LabelRate = {
  id: string; provider: string; trackingCarrier: string | null; service: string;
  amountCents: number; currency: string; estimatedDays: number | null;
};
export type LabelDraftStatus = "quoting" | "quoted" | "purchasing" | "pending" | "ready" | "error" | "unknown";
export type LabelDraft = {
  id: string; orderNumber: string; fulfillmentMode: FulfillmentMode; carrierCode: string;
  lines: ShipmentLineInput[]; status: LabelDraftStatus; rates: LabelRate[];
  selectedRateId: string | null; amountCents: number | null; currency: string | null;
  trackingNumber: string | null; trackingCarrier: string | null; labelAvailable: boolean;
  test: boolean; shipmentId: string | null; errorCode: string | null;
  version: number; createdAt: string; updatedAt: string;
};
export type TrackingJobSummary = {
  shipmentId: string; orderNumber: string; carrierCode: string; trackingNumber: string;
  providerStatus: string | null; lastCheckedAt: string | null; nextAttemptAt: string;
  attempts: number; errorCode: string | null;
};
export type LogisticsDashboard = { configuration: LogisticsConfiguration; drafts: LabelDraft[]; tracking: TrackingJobSummary[] };
export type LogisticsResult = { ok: boolean; code?: string; message?: string; draft?: LabelDraft };
export type LabelPurchaseInput = { rateId: string; expectedAmountCents: number; expectedCurrency: string; confirmCharge: true };
