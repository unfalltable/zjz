import { env } from "cloudflare:workers";
import type { LabelDraftInput, LabelRate, LogisticsConfiguration } from "@shared/logistics";

/** Fixed upstream origin: neither the browser nor a persisted URL can change the API destination. */
const API = "https://api.goshippo.com";
const API_VERSION = "2018-02-08";
const objectId = /^[a-zA-Z0-9_-]{1,100}$/;
const carrierToken = /^[a-z0-9][a-z0-9_-]{0,50}$/;
const defaults: Record<string, string> = { usps: "usps", ups: "ups", fedex: "fedex", dhl: "dhl_express", dhl_express: "dhl_express", royal_mail: "royal_mail", canada_post: "canada_post", australia_post: "australia_post" };
export class LogisticsProviderError extends Error {
  constructor(public readonly code: string, public readonly ambiguous = false) { super(code); }
}
function runtime() { return env as unknown as Record<string, string | undefined>; }
export function getLogisticsConfiguration(): LogisticsConfiguration {
  const config = runtime(); const token = config.SHIPPO_API_TOKEN?.trim();
  const valid = !!token && /^shippo_(?:test|live)_[a-zA-Z0-9_-]{16,200}$/.test(token);
  let overrides: Record<string, string> = {};
  if (config.LOGISTICS_CARRIER_MAP) {
    try {
      const value = JSON.parse(config.LOGISTICS_CARRIER_MAP);
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.entries(value).some(([key, mapped]) => !carrierToken.test(key) || typeof mapped !== "string" || !carrierToken.test(mapped))) throw new Error();
      overrides = value;
    } catch { throw new LogisticsProviderError("invalid_carrier_mapping"); }
  }
  return { provider: "shippo", tokenConfigured: valid, mode: !valid ? "disabled" : token!.startsWith("shippo_test_") ? "test" : "live",
    purchaseEnabled: valid && config.LOGISTICS_LABEL_PURCHASE_ENABLED === "true", pollingEnabled: valid && config.LOGISTICS_POLL_ENABLED === "true", carrierMap: { ...defaults, ...overrides } };
}
function configuredToken() {
  if (!getLogisticsConfiguration().tokenConfigured) throw new LogisticsProviderError("configuration_missing");
  return runtime().SHIPPO_API_TOKEN!.trim();
}
async function boundedBytes(response: Response, max: number): Promise<Uint8Array> {
  const size = Number(response.headers.get("content-length"));
  if (Number.isFinite(size) && size > max) { await response.body?.cancel(); throw new LogisticsProviderError("upstream_response_too_large"); }
  if (!response.body) throw new LogisticsProviderError("upstream_response_empty");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > max) { await reader.cancel(); throw new LogisticsProviderError("upstream_response_too_large"); } chunks.push(value); }
  const all = new Uint8Array(total); let offset = 0; for (const part of chunks) { all.set(part, offset); offset += part.length; } return all;
}
async function api(path: string, method = "GET", body?: unknown): Promise<Record<string, unknown>> {
  const token = configuredToken();
  try {
    const response = await fetch(`${API}${path}`, { method, headers: { Authorization: `ShippoToken ${token}`, "Content-Type": "application/json", "SHIPPO-API-VERSION": API_VERSION },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) { await response.body?.cancel(); throw new LogisticsProviderError(response.status === 401 || response.status === 403 ? "provider_authentication_failed" : response.status === 429 ? "provider_rate_limited" : response.status >= 500 ? "provider_unavailable" : "provider_rejected", method === "POST" && (response.status >= 500 || response.status === 429)); }
    const value: unknown = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 1_048_576)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new LogisticsProviderError("provider_invalid_response", method === "POST");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof LogisticsProviderError) throw error;
    // A timeout after a transaction POST can already have billed the account. Never blindly retry it.
    throw new LogisticsProviderError("provider_network_error", method === "POST");
  }
}
function requiredId(value: unknown): string { if (typeof value !== "string" || !objectId.test(value)) throw new LogisticsProviderError("provider_invalid_response"); return value; }
function cents(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split("."); const result = Number(integer) * 100 + Number(fraction.padEnd(2, "0")); return Number.isSafeInteger(result) && result <= 100_000_000 ? result : null;
}
const safeText = (value: unknown, limit: number) => typeof value === "string" && !/[\u0000-\u001f]/.test(value) ? value.slice(0, limit) : "";
function rateCarrier(provider: string, carrierMap: Record<string, string>) {
  const normalized = provider.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return Object.hasOwn(carrierMap, normalized) ? carrierMap[normalized] : null;
}
export function parseRates(value: unknown, carrierMap: Record<string, string> = defaults): LabelRate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item): LabelRate[] => {
    if (!item || typeof item !== "object") return []; const rate = item as Record<string, unknown>; const amount = cents(rate.amount);
    if (typeof rate.object_id !== "string" || !objectId.test(rate.object_id) || amount === null || typeof rate.currency !== "string" || !/^[A-Z]{3}$/.test(rate.currency)) return [];
    const service = rate.servicelevel && typeof rate.servicelevel === "object" ? (rate.servicelevel as Record<string, unknown>).name : rate.servicelevel_name;
    const provider = safeText(rate.provider, 100); if (!provider) return [];
    return [{ id: rate.object_id, provider, trackingCarrier: rateCarrier(provider, carrierMap), service: safeText(service, 100) || provider, amountCents: amount, currency: rate.currency,
      estimatedDays: Number.isSafeInteger(rate.estimated_days) && Number(rate.estimated_days) >= 0 && Number(rate.estimated_days) <= 365 ? Number(rate.estimated_days) : null }];
  });
}
export async function requestShipmentQuote(input: LabelDraftInput, metadata: string, customsItems?: Record<string, unknown>[]) {
  const payload: Record<string, unknown> = { address_from: input.addressFrom, address_to: input.addressTo,
    parcels: [{ length: String(input.parcel.lengthCm), width: String(input.parcel.widthCm), height: String(input.parcel.heightCm), distance_unit: "cm", weight: String(input.parcel.weightGrams), mass_unit: "g" }], metadata, async: false };
  if (input.customs && customsItems) payload.customs_declaration = { contents_type: "MERCHANDISE", contents_explanation: "Online retail goods", non_delivery_option: input.customs.nonDeliveryOption,
    certify: true, certify_signer: input.customs.certifySigner, items: customsItems };
  const result = await api("/shipments/", "POST", payload);
  return { shipmentId: requiredId(result.object_id), rates: parseRates(result.rates, getLogisticsConfiguration().carrierMap), status: safeText(result.status, 30) };
}
export async function retrieveShipmentQuote(id: string) {
  const result = await api(`/shipments/${encodeURIComponent(requiredId(id))}/`);
  return { shipmentId: requiredId(result.object_id), rates: parseRates(result.rates, getLogisticsConfiguration().carrierMap), status: safeText(result.status, 30) };
}
export type ProviderTransaction = { id: string; status: string; rateId: string | null; trackingNumber: string | null; labelUrl: string | null; test: boolean; metadata: string };
function transaction(value: Record<string, unknown>): ProviderTransaction {
  const rate = typeof value.rate === "string" ? value.rate : value.rate && typeof value.rate === "object" ? (value.rate as Record<string, unknown>).object_id : null;
  if (typeof value.test !== "boolean" || !["WAITING", "QUEUED", "SUCCESS", "ERROR", "REFUNDED", "REFUNDPENDING", "REFUNDREJECTED"].includes(String(value.status))) throw new LogisticsProviderError("provider_invalid_response", true);
  return { id: requiredId(value.object_id), status: String(value.status), rateId: typeof rate === "string" && objectId.test(rate) ? rate : null,
    trackingNumber: safeText(value.tracking_number, 100) || null, labelUrl: safeText(value.label_url, 4096) || null, test: value.test, metadata: safeText(value.metadata, 100) };
}
export async function requestLabelPurchase(rateId: string, metadata: string): Promise<ProviderTransaction> {
  return transaction(await api("/transactions/", "POST", { rate: requiredId(rateId), label_file_type: "PDF_4x6", metadata, async: true }));
}
export async function retrieveTransaction(id: string): Promise<ProviderTransaction> { return transaction(await api(`/transactions/${encodeURIComponent(requiredId(id))}/`)); }
/** Reconciliation reads only: metadata is checked locally, and pagination is bounded. No second POST. */
export async function findTransaction(metadata: string, createdAt: string): Promise<ProviderTransaction | null> {
  const start = new Date(Date.parse(createdAt) - 60_000).toISOString();
  for (let page = 1; page <= 3; page++) {
    const value = await api(`/transactions/?results=100&page=${page}&object_created_gt=${encodeURIComponent(start)}`);
    if (!Array.isArray(value.results)) throw new LogisticsProviderError("provider_invalid_response");
    const matches = value.results.filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).metadata === metadata).map((item) => transaction(item as Record<string, unknown>));
    if (matches.length > 1) throw new LogisticsProviderError("multiple_provider_transactions");
    if (matches.length === 1) return matches[0];
    if (!value.next) break;
  }
  return null;
}
export async function retrieveTracking(carrier: string, trackingNumber: string) {
  if (!carrierToken.test(carrier) || !trackingNumber || trackingNumber.length > 100 || /[\u0000-\u001f]/.test(trackingNumber)) throw new LogisticsProviderError("invalid_tracking_number");
  const value = await api(`/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`);
  if (value.carrier !== carrier || value.tracking_number !== trackingNumber || !value.tracking_status || typeof value.tracking_status !== "object") throw new LogisticsProviderError("provider_tracking_mismatch");
  const status = value.tracking_status as Record<string, unknown>;
  if (!["UNKNOWN", "PRE_TRANSIT", "TRANSIT", "DELIVERED", "RETURNED", "FAILURE"].includes(String(status.status))) throw new LogisticsProviderError("provider_invalid_response");
  const date = typeof status.status_date === "string" && Number.isFinite(Date.parse(status.status_date)) && Date.parse(status.status_date) <= Date.now() + 3_600_000 ? new Date(status.status_date).toISOString() : null;
  return { status: String(status.status), date, details: safeText(status.status_details, 500) };
}
export function safeLabelUrl(value: string): boolean {
  try {
    const url = new URL(value); const allowed = new Set(["shippo-delivery.s3.amazonaws.com"]);
    // Additional CDN hosts are reviewed server configuration, never caller-controlled URLs.
    for (const host of (runtime().LOGISTICS_LABEL_ALLOWED_HOSTS ?? "").split(",").filter(Boolean)) {
      if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes(".") || /^\d+(?:\.\d+){3}$/.test(host) || /(?:^|\.)localhost$/.test(host)) return false;
      allowed.add(host);
    }
    return url.protocol === "https:" && !url.username && !url.password && !url.port && allowed.has(url.hostname) && /\.pdf$/i.test(url.pathname);
  } catch { return false; }
}
export async function downloadLabelPdf(url: string): Promise<Uint8Array> {
  configuredToken(); if (!safeLabelUrl(url)) throw new LogisticsProviderError("unsafe_label_url");
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) { await response.body?.cancel(); throw new LogisticsProviderError("label_download_unavailable"); }
    const type = response.headers.get("content-type")?.split(";")[0].toLowerCase();
    if (type !== "application/pdf" && type !== "application/octet-stream") { await response.body?.cancel(); throw new LogisticsProviderError("label_not_pdf"); }
    const bytes = await boundedBytes(response, 8 * 1_048_576);
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new LogisticsProviderError("label_not_pdf"); return bytes;
  } catch (error) { if (error instanceof LogisticsProviderError) throw error; throw new LogisticsProviderError("label_download_unavailable"); }
}
