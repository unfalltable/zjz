import { z } from "zod";
import { env } from "cloudflare:workers";
import { getD1 } from "./index";
import type { CreateShipmentInput, ShipmentLineInput } from "@shared/admin-commerce";
import type { LabelDraft, LabelDraftInput, LabelPurchaseInput, LabelRate, LogisticsDashboard, LogisticsResult, TrackingJobSummary } from "@shared/logistics";
import { downloadLabelPdf, findTransaction, getLogisticsConfiguration, LogisticsProviderError, requestLabelPurchase, requestShipmentQuote, retrieveShipmentQuote, retrieveTracking, retrieveTransaction, safeLabelUrl, type ProviderTransaction } from "@backend/logistics/shippo";

const addressSchema = z.object({ name: z.string().trim().min(1).max(100), street1: z.string().trim().min(1).max(200), street2: z.string().trim().max(200).optional(), city: z.string().trim().min(1).max(100),
  state: z.string().trim().max(100), zip: z.string().trim().min(1).max(30), country: z.string().regex(/^[A-Z]{2}$/), phone: z.string().trim().min(5).max(40), email: z.string().email().max(200).optional() });
const lineSchema = z.object({ sku: z.string().trim().min(1).max(100), quantity: z.number().int().min(1).max(1000) });
const inputSchema = z.object({ fulfillmentMode: z.enum(["marketplace", "self", "supplier"]), carrierCode: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
  lines: z.array(lineSchema).min(1).max(20).refine((lines) => new Set(lines.map((line) => line.sku)).size === lines.length), addressFrom: addressSchema, addressTo: addressSchema,
  parcel: z.object({ lengthCm: z.number().positive().max(300), widthCm: z.number().positive().max(300), heightCm: z.number().positive().max(300), weightGrams: z.number().int().min(1).max(150_000) }),
  customs: z.object({ certifySigner: z.string().trim().min(1).max(100), nonDeliveryOption: z.enum(["RETURN", "ABANDON"]), items: z.array(z.object({ sku: z.string().trim().min(1).max(100), description: z.string().trim().min(3).max(200),
    originCountry: z.string().regex(/^[A-Z]{2}$/), hsCode: z.string().regex(/^\d{6,12}$/), weightGrams: z.number().int().min(1).max(150_000) })).min(1).max(20).refine((items) => new Set(items.map((item) => item.sku)).size === items.length) }).optional(), confirmAddress: z.literal(true) });
const purchaseSchema = z.object({ rateId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), expectedAmountCents: z.number().int().min(0).max(100_000_000), expectedCurrency: z.string().regex(/^[A-Z]{3}$/), confirmCharge: z.literal(true) });
const uuid = z.string().uuid();
const activeStates = "'purchasing','pending','ready','unknown'";
type Order = { id: string; orderNumber: string; version: number; customerName: string; postalCode: string | null; destination: string; paymentStatus: string; reviewStatus: string; lineItemsJson: string | null; currency: string };
type DraftRow = { id: string; ownerId: string; orderId: string; orderNumber: string; fulfillmentMode: LabelDraft["fulfillmentMode"]; carrierCode: string; linesJson: string; inputJson: string; fingerprint: string; status: LabelDraft["status"];
  providerShipmentId: string | null; providerTransactionId: string | null; ratesJson: string; selectedRateId: string | null; amountCents: number | null; currency: string | null; trackingNumber: string | null; trackingCarrier: string | null;
  labelUrl: string | null; test: number; shipmentId: string | null; errorCode: string | null; version: number; leaseToken: string | null; leaseExpiresAt: string | null; nextAttemptAt: string | null; attempts: number; createdAt: string; updatedAt: string };
const draftColumns = `d.id,d.owner_id AS ownerId,d.order_id AS orderId,o.order_number AS orderNumber,d.fulfillment_mode AS fulfillmentMode,d.carrier_code AS carrierCode,d.lines_json AS linesJson,d.input_json AS inputJson,d.fingerprint,d.status,
  d.provider_shipment_id AS providerShipmentId,d.provider_transaction_id AS providerTransactionId,d.rates_json AS ratesJson,d.selected_rate_id AS selectedRateId,d.amount_cents AS amountCents,d.currency,d.tracking_number AS trackingNumber,d.tracking_carrier AS trackingCarrier,
  d.label_url AS labelUrl,d.test,d.shipment_id AS shipmentId,d.error_code AS errorCode,d.version,d.lease_token AS leaseToken,d.lease_expires_at AS leaseExpiresAt,d.next_attempt_at AS nextAttemptAt,d.attempts,d.created_at AS createdAt,d.updated_at AS updatedAt`;
const ok = (draft?: LabelDraft, message?: string): LogisticsResult => ({ ok: true, draft, message });
const fail = (code: string, message?: string): LogisticsResult => ({ ok: false, code, message: message ?? code });
const nowIso = () => new Date().toISOString();
const future = (milliseconds: number) => new Date(Date.now() + milliseconds).toISOString();
const validVersion = (version: number) => Number.isSafeInteger(version) && version >= 0;
function requireWritable() { if ((env as unknown as Record<string, string | undefined>).MIOVA_MAINTENANCE === "true") throw new LogisticsProviderError("maintenance"); }
function ownerValid(ownerId: string) { if (!ownerId || ownerId.length > 512 || ownerId.trim() !== ownerId) throw new LogisticsProviderError("invalid_owner"); }
function dto(row: DraftRow): LabelDraft {
  return { id: row.id, orderNumber: row.orderNumber, fulfillmentMode: row.fulfillmentMode, carrierCode: row.carrierCode, lines: JSON.parse(row.linesJson), status: row.status, rates: JSON.parse(row.ratesJson),
    selectedRateId: row.selectedRateId, amountCents: row.amountCents, currency: row.currency, trackingNumber: row.trackingNumber, trackingCarrier: row.trackingCarrier,
    labelAvailable: row.status === "ready" && !!row.labelUrl && safeLabelUrl(row.labelUrl), test: row.test === 1, shipmentId: row.shipmentId, errorCode: row.errorCode, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
async function readDraft(ownerId: string, id: string) {
  return getD1().prepare(`SELECT ${draftColumns} FROM logistics_label_drafts d JOIN orders o ON o.id=d.order_id AND o.owner_id=d.owner_id WHERE d.owner_id=? AND d.id=?`).bind(ownerId, id).first<DraftRow>();
}
async function readOrder(ownerId: string, number: string) {
  return getD1().prepare(`SELECT id,order_number AS orderNumber,version,customer_name AS customerName,postal_code AS postalCode,destination,payment_status AS paymentStatus,review_status AS reviewStatus,line_items_json AS lineItemsJson,currency FROM orders WHERE owner_id=? AND order_number=?`).bind(ownerId, number).first<Order>();
}
function eligible(order: Order | null): LogisticsResult | null {
  if (!order) return fail("not_found"); if (order.paymentStatus !== "paid") return fail("payment_required", "A carrier label requires verified payment; pending orders cannot buy labels.");
  if (order.reviewStatus !== "confirmed") return fail("confirmation_required"); return null;
}
function snapshots(order: Order) {
  try {
    const lines: unknown = JSON.parse(order.lineItemsJson ?? "null");
    const result = z.array(lineSchema.extend({ name: z.string(), priceCents: z.number().int().min(0).max(100_000_000), fulfillmentMode: z.enum(["marketplace", "self", "supplier"]) })).min(1).max(20).safeParse(lines);
    return result.success ? result.data : null;
  } catch { return null; }
}
async function readiness(ownerId: string, order: Order, input: LabelDraftInput) {
  const parsed = snapshots(order); if (!parsed) return "invalid_order_lines";
  for (const line of input.lines) {
    const original = parsed.find((candidate) => candidate.sku === line.sku);
    if (!original || original.fulfillmentMode !== input.fulfillmentMode) return "invalid_route";
    const row = await getD1().prepare(`SELECT r.remaining,p.stock,p.reserved FROM order_reservations r JOIN products p ON p.id=r.product_id AND p.owner_id=r.owner_id WHERE r.owner_id=? AND r.order_id=? AND r.sku=?`).bind(ownerId, order.id, line.sku).first<{ remaining: number; stock: number; reserved: number }>();
    if (!row || row.remaining < line.quantity || row.stock < line.quantity || row.reserved < line.quantity) return "insufficient_reserved_stock";
  }
  return null;
}
function lineGuards(ownerId: string, orderId: string, input: LabelDraftInput, excludedDraftId?: string) {
  const guards: { sql: string; values: (string | number)[] }[] = [];
  for (const line of input.lines) guards.push({ sql: `EXISTS(SELECT 1 FROM order_reservations r JOIN products p ON p.id=r.product_id AND p.owner_id=r.owner_id WHERE r.owner_id=? AND r.order_id=? AND r.sku=? AND r.remaining>=? AND p.stock>=? AND p.reserved>=?
    AND r.remaining>=?+(SELECT COALESCE(SUM(CAST(j.value->>'$.quantity' AS INTEGER)),0) FROM logistics_label_drafts d,json_each(d.lines_json) j WHERE d.owner_id=? AND d.order_id=? AND d.shipment_id IS NULL AND d.status IN (${activeStates}) AND d.id!=? AND j.value->>'$.sku'=?))`,
    values: [ownerId, orderId, line.sku, line.quantity, line.quantity, line.quantity, line.quantity, ownerId, orderId, excludedDraftId ?? "", line.sku] });
  return guards;
}
async function guarded(ownerId: string, order: Order, action: string, guards: { sql: string; values: (string | number)[] }[], statements: ReturnType<ReturnType<typeof getD1>["prepare"]>[], details: unknown = {}) {
  const db = getD1(); const gateId = crypto.randomUUID(); const now = nowIso();
  try {
    await db.batch([db.prepare(`INSERT INTO admin_operation_guards(id,allowed) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM orders WHERE owner_id=? AND id=? AND version=? AND payment_status='paid' AND review_status='confirmed') ${guards.map((guard) => `AND (${guard.sql})`).join(" ")} THEN 1 ELSE 0 END`).bind(gateId, ownerId, order.id, order.version, ...guards.flatMap((guard) => guard.values)), ...statements,
      db.prepare(`INSERT INTO admin_order_audit(id,owner_id,order_id,action,note,details_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), ownerId, order.id, action, null, JSON.stringify(details), ownerId, now),
      db.prepare(`DELETE FROM admin_operation_guards WHERE id=?`).bind(gateId)]); return true;
  } catch (error) { if (error instanceof Error && /constraint|CHECK|UNIQUE/i.test(error.message)) return false; throw error; }
}
async function fingerprint(input: LabelDraftInput) {
  const canonical = { ...input, lines: [...input.lines].sort((a, b) => a.sku.localeCompare(b.sku)), customs: input.customs ? { ...input.customs, items: [...input.customs.items].sort((a, b) => a.sku.localeCompare(b.sku)) } : undefined };
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical)))), (value) => value.toString(16).padStart(2, "0")).join("");
}
function providerFailure(error: unknown) { return error instanceof LogisticsProviderError ? error.code : "logistics_unavailable"; }
async function quoteDraft(ownerId: string, row: DraftRow, token: string) {
  try {
    const input = inputSchema.parse(JSON.parse(row.inputJson)); const order = await readOrder(ownerId, row.orderNumber); if (!order || eligible(order)) throw new LogisticsProviderError("order_ineligible");
    const original = snapshots(order)!;
    const customsItems = input.customs?.items.map((item) => { const line = input.lines.find((entry) => entry.sku === item.sku)!; const snapshot = original.find((entry) => entry.sku === item.sku)!;
      return { description: item.description, quantity: line.quantity, net_weight: String(item.weightGrams * line.quantity), mass_unit: "g", value_amount: ((snapshot.priceCents * line.quantity) / 100).toFixed(2), value_currency: order.currency, origin_country: item.originCountry, tariff_number: item.hsCode }; });
    const result = row.providerShipmentId ? await retrieveShipmentQuote(row.providerShipmentId) : await requestShipmentQuote(input, row.id, customsItems);
    const configuration = getLogisticsConfiguration(); const carrier = configuration.carrierMap[row.carrierCode];
    const rates = result.rates.filter((rate) => rate.trackingCarrier === carrier);
    const status = rates.length ? "quoted" : ["WAITING", "QUEUED"].includes(result.status) ? "quoting" : "error";
    await getD1().prepare(`UPDATE logistics_label_drafts SET status=?,provider_shipment_id=?,rates_json=?,error_code=?,version=version+1,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=?,updated_at=? WHERE owner_id=? AND id=? AND lease_token=?`).bind(status, result.shipmentId, JSON.stringify(rates), status === "error" ? "no_carrier_rates" : null, status === "quoting" ? future(60_000) : null, nowIso(), ownerId, row.id, token).run();
  } catch (error) {
    await getD1().prepare(`UPDATE logistics_label_drafts SET status='error',error_code=?,version=version+1,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,updated_at=? WHERE owner_id=? AND id=? AND lease_token=?`).bind(providerFailure(error), nowIso(), ownerId, row.id, token).run();
  }
  return dto((await readDraft(ownerId, row.id))!);
}
export async function getLogisticsDashboard(ownerId: string, orderNumber?: string): Promise<LogisticsDashboard> {
  ownerValid(ownerId); const configuration = getLogisticsConfiguration(); const db = getD1();
  const filters = orderNumber ? [ownerId, orderNumber] : [ownerId];
  const rows = await db.prepare(`SELECT ${draftColumns} FROM logistics_label_drafts d JOIN orders o ON o.id=d.order_id AND o.owner_id=d.owner_id WHERE d.owner_id=?${orderNumber ? " AND o.order_number=?" : ""} ORDER BY d.created_at DESC,d.id DESC LIMIT 100`).bind(...filters).all<DraftRow>();
  const tracking = await db.prepare(`SELECT j.shipment_id AS shipmentId,o.order_number AS orderNumber,s.carrier_code AS carrierCode,j.tracking_number AS trackingNumber,j.provider_status AS providerStatus,j.last_checked_at AS lastCheckedAt,j.next_attempt_at AS nextAttemptAt,j.attempts,j.error_code AS errorCode FROM logistics_tracking_jobs j JOIN shipments s ON s.id=j.shipment_id AND s.owner_id=j.owner_id JOIN orders o ON o.id=s.order_id AND o.owner_id=s.owner_id WHERE j.owner_id=?${orderNumber ? " AND o.order_number=?" : ""} ORDER BY j.updated_at DESC LIMIT 100`).bind(...filters).all<TrackingJobSummary>();
  return { configuration, drafts: rows.results.map(dto), tracking: tracking.results.map((row) => ({ ...row })) };
}
export async function createLabelDraft(ownerId: string, number: string, orderVersion: number, untrustedInput: LabelDraftInput): Promise<LogisticsResult> {
  ownerValid(ownerId); requireWritable(); const parsed = inputSchema.safeParse(untrustedInput); if (!parsed.success || !validVersion(orderVersion)) return fail("invalid_input");
  const configuration = getLogisticsConfiguration(); if (!configuration.tokenConfigured) return fail("configuration_missing", "Configure a carrier account/API token on the server first. No shipment or charge was created.");
  const input = parsed.data; if (!configuration.carrierMap[input.carrierCode]) return fail("carrier_not_mapped");
  const order = await readOrder(ownerId, number); const ineligible = eligible(order); if (ineligible || !order) return ineligible!; if (order.version !== orderVersion) return fail("conflict");
  const country = order.destination.match(/\b([A-Z]{2})\s*$/)?.[1];
  if (input.addressTo.name !== order.customerName.trim() || (order.postalCode && input.addressTo.zip.replace(/\s/g, "").toUpperCase() !== order.postalCode.replace(/\s/g, "").toUpperCase()) || (country && input.addressTo.country !== country)) return fail("recipient_mismatch", "The structured recipient must match the confirmed order's name, destination country and postal code.");
  if (input.addressFrom.country !== input.addressTo.country && !input.customs) return fail("customs_required", "International parcels need truthful item origins, HS codes, weights and a customs certification.");
  if (input.customs && (input.customs.items.length !== input.lines.length || input.customs.items.some((item) => !input.lines.some((line) => line.sku === item.sku)) || input.customs.items.reduce((sum, item) => sum + item.weightGrams * input.lines.find((line) => line.sku === item.sku)!.quantity, 0) > input.parcel.weightGrams)) return fail("invalid_customs");
  const readyError = await readiness(ownerId, order, input); if (readyError) return fail(readyError);
  const carrier = await getD1().prepare(`SELECT enabled,version FROM shipping_carriers WHERE owner_id=? AND code=? AND enabled=1`).bind(ownerId, input.carrierCode).first<{ enabled: number; version: number }>(); if (!carrier) return fail("carrier_unavailable");
  const digest = await fingerprint(input); const existing = await getD1().prepare(`SELECT ${draftColumns} FROM logistics_label_drafts d JOIN orders o ON o.id=d.order_id AND o.owner_id=d.owner_id WHERE d.owner_id=? AND d.order_id=? AND d.fingerprint=?`).bind(ownerId, order.id, digest).first<DraftRow>();
  if (existing) return ok(dto(existing), "Existing parcel draft returned; no duplicate provider purchase.");
  const id = crypto.randomUUID(); const token = crypto.randomUUID(); const now = nowIso();
  const created = await guarded(ownerId, order, "logistics_quote_requested", [...lineGuards(ownerId, order.id, input), { sql: `EXISTS(SELECT 1 FROM shipping_carriers WHERE owner_id=? AND code=? AND enabled=1 AND version=?)`, values: [ownerId, input.carrierCode, carrier.version] }], [
    getD1().prepare(`INSERT INTO logistics_label_drafts(id,owner_id,order_id,fulfillment_mode,carrier_code,lines_json,input_json,fingerprint,status,test,lease_token,lease_expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'quoting',?,?,?,?,?)`).bind(id, ownerId, order.id, input.fulfillmentMode, input.carrierCode, JSON.stringify(input.lines), JSON.stringify(input), digest, configuration.mode === "test" ? 1 : 0, token, future(60_000), now, now),
  ], { draftId: id, mode: configuration.mode, stockDeducted: false });
  if (!created) return fail("conflict");
  const draft = await quoteDraft(ownerId, (await readDraft(ownerId, id))!, token); return draft.status === "error" ? { ...fail(draft.errorCode ?? "quote_failed"), draft } : ok(draft);
}
async function completeTransaction(ownerId: string, row: DraftRow, token: string, result: ProviderTransaction) {
  if (result.metadata !== row.id || result.rateId !== row.selectedRateId || result.test !== (row.test === 1)) throw new LogisticsProviderError("provider_transaction_mismatch", true);
  const status = result.status === "SUCCESS" && result.trackingNumber && result.labelUrl && safeLabelUrl(result.labelUrl) ? "ready" : ["WAITING", "QUEUED"].includes(result.status) ? "pending" : "error";
  const error = status === "error" ? result.status === "SUCCESS" ? "label_response_incomplete" : "provider_label_rejected" : null;
  const updated = await getD1().prepare(`UPDATE logistics_label_drafts SET status=?,provider_transaction_id=?,tracking_number=?,label_url=?,error_code=?,version=version+1,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=?,updated_at=? WHERE owner_id=? AND id=? AND lease_token=?`).bind(status, result.id, result.trackingNumber, result.labelUrl && safeLabelUrl(result.labelUrl) ? result.labelUrl : null, error, status === "pending" ? future(60_000) : null, nowIso(), ownerId, row.id, token).run();
  if ((updated.meta.changes ?? 0) > 0) await getD1().prepare(`INSERT INTO admin_order_audit(id,owner_id,order_id,action,note,details_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), ownerId, row.orderId, "logistics_label_result", null, JSON.stringify({ draftId: row.id, status, transactionId: result.id, test: result.test, stockDeducted: false }), ownerId, nowIso()).run();
}
async function unknownTransaction(ownerId: string, row: DraftRow, token: string, error: unknown) {
  // Even malformed 2xx responses can mean a successful charge. Retrying a POST is never automatic.
  await getD1().prepare(`UPDATE logistics_label_drafts SET status='unknown',error_code=?,version=version+1,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=?,updated_at=? WHERE owner_id=? AND id=? AND lease_token=?`).bind(providerFailure(error), future(300_000), nowIso(), ownerId, row.id, token).run();
}
export async function purchaseLabel(ownerId: string, id: string, expectedVersion: number, untrustedInput: LabelPurchaseInput): Promise<LogisticsResult> {
  ownerValid(ownerId); requireWritable(); const parsed = purchaseSchema.safeParse(untrustedInput); if (!uuid.safeParse(id).success || !validVersion(expectedVersion) || !parsed.success) return fail("invalid_input");
  const config = getLogisticsConfiguration(); if (!config.tokenConfigured) return fail("configuration_missing"); if (!config.purchaseEnabled) return fail("label_purchase_disabled", "Label purchasing is disabled; no carrier charge was created.");
  const row = await readDraft(ownerId, id); if (!row) return fail("not_found");
  if (["purchasing", "pending", "ready", "unknown"].includes(row.status)) return ok(dto(row), "This purchase already started. Refresh its result; do not buy again.");
  if (row.version !== expectedVersion) return fail("conflict"); if (row.status !== "quoted") return fail("quote_required");
  if (Date.now() - Date.parse(row.updatedAt) > 3_600_000) return fail("quote_expired");
  if ((row.test === 1) !== (config.mode === "test")) return fail("provider_mode_changed");
  const rate = (JSON.parse(row.ratesJson) as LabelRate[]).find((candidate) => candidate.id === parsed.data.rateId);
  if (!rate || rate.amountCents !== parsed.data.expectedAmountCents || rate.currency !== parsed.data.expectedCurrency) return fail("rate_changed", "Confirm the exact quoted currency and amount before buying a label.");
  if (!rate.trackingCarrier || config.carrierMap[row.carrierCode] !== rate.trackingCarrier) return fail("carrier_not_mapped");
  const order = await readOrder(ownerId, row.orderNumber); const ineligible = eligible(order); if (ineligible || !order) return ineligible!;
  const input = inputSchema.parse(JSON.parse(row.inputJson)); const readyError = await readiness(ownerId, order, input); if (readyError) return fail(readyError);
  const token = crypto.randomUUID(); const claimed = await guarded(ownerId, order, "logistics_label_purchase_confirmed", [...lineGuards(ownerId, order.id, input, id),
    { sql: `EXISTS(SELECT 1 FROM logistics_label_drafts WHERE owner_id=? AND id=? AND version=? AND status='quoted')`, values: [ownerId, id, expectedVersion] },
    { sql: `EXISTS(SELECT 1 FROM shipping_carriers WHERE owner_id=? AND code=? AND enabled=1)`, values: [ownerId, row.carrierCode] }], [
    getD1().prepare(`UPDATE logistics_label_drafts SET status='purchasing',selected_rate_id=?,amount_cents=?,currency=?,tracking_carrier=?,version=version+1,lease_token=?,lease_expires_at=?,next_attempt_at=?,updated_at=? WHERE owner_id=? AND id=? AND version=? AND status='quoted'`).bind(rate.id, rate.amountCents, rate.currency, rate.trackingCarrier, token, future(60_000), future(60_000), nowIso(), ownerId, id, expectedVersion),
  ], { draftId: id, rateId: rate.id, amountCents: rate.amountCents, currency: rate.currency, test: row.test === 1, explicitChargeConsent: true, stockDeducted: false });
  if (!claimed) return fail("conflict"); const current = (await readDraft(ownerId, id))!;
  try { await completeTransaction(ownerId, current, token, await requestLabelPurchase(rate.id, id)); }
  catch (error) {
    // A provider rejection before any accepted transaction is safe terminal; other failures remain reconciliation-only.
    if (error instanceof LogisticsProviderError && !error.ambiguous && ["provider_authentication_failed", "provider_rejected"].includes(error.code)) await getD1().prepare(`UPDATE logistics_label_drafts SET status='error',error_code=?,version=version+1,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,updated_at=? WHERE owner_id=? AND id=? AND lease_token=?`).bind(error.code, nowIso(), ownerId, id, token).run();
    else await unknownTransaction(ownerId, current, token, error);
  }
  const draft = dto((await readDraft(ownerId, id))!); return draft.status === "error" ? { ...fail(draft.errorCode ?? "purchase_failed"), draft } : ok(draft);
}
export async function refreshLabel(ownerId: string, id: string, expectedVersion: number): Promise<LogisticsResult> {
  ownerValid(ownerId); requireWritable(); if (!uuid.safeParse(id).success || !validVersion(expectedVersion)) return fail("invalid_input");
  const config = getLogisticsConfiguration(); if (!config.tokenConfigured) return fail("configuration_missing"); const row = await readDraft(ownerId, id); if (!row) return fail("not_found");
  if (row.version !== expectedVersion) return fail("conflict"); if ((row.test === 1) !== (config.mode === "test")) return fail("provider_mode_changed");
  if (row.status === "ready" || (row.status === "error" && row.selectedRateId)) return ok(dto(row));
  if (row.leaseExpiresAt && row.leaseExpiresAt > nowIso()) return fail("operation_in_progress");
  const token = crypto.randomUUID(); const result = await getD1().prepare(`UPDATE logistics_label_drafts SET lease_token=?,lease_expires_at=?,attempts=attempts+1 WHERE owner_id=? AND id=? AND version=? AND (lease_expires_at IS NULL OR lease_expires_at<=?)`).bind(token, future(60_000), ownerId, id, expectedVersion, nowIso()).run();
  if (!(result.meta.changes ?? 0)) return fail("conflict");
  if (!row.selectedRateId) return ok(await quoteDraft(ownerId, row, token));
  try {
    const transaction = row.providerTransactionId ? await retrieveTransaction(row.providerTransactionId) : await findTransaction(row.id, row.createdAt);
    if (transaction) await completeTransaction(ownerId, row, token, transaction);
    else await unknownTransaction(ownerId, row, token, new LogisticsProviderError("provider_result_unknown"));
  } catch (error) { await unknownTransaction(ownerId, row, token, error); }
  return ok(dto((await readDraft(ownerId, id))!));
}
/** Used by existing cancel/dispatch mutations: caller must enforce these same predicates inside its atomic batch. */
export async function getShipmentLabelGuard(ownerId: string, orderId: string, input: CreateShipmentInput) {
  const rows = await getD1().prepare(`SELECT ${draftColumns} FROM logistics_label_drafts d JOIN orders o ON o.id=d.order_id AND o.owner_id=d.owner_id WHERE d.owner_id=? AND d.order_id=? AND d.shipment_id IS NULL AND d.status IN (${activeStates})`).bind(ownerId, orderId).all<DraftRow>();
  const canonical = (lines: ShipmentLineInput[]) => JSON.stringify([...lines].sort((a, b) => a.sku.localeCompare(b.sku)));
  const overlapping = rows.results.filter((row) => (JSON.parse(row.linesJson) as ShipmentLineInput[]).some((line) => input.lines.some((selected) => selected.sku === line.sku)));
  if (!overlapping.length) return { ok: true, draftId: null };
  const match = overlapping.find((row) => row.status === "ready" && row.test === 0 && row.carrierCode === input.carrierCode && row.trackingNumber === input.trackingNumber.trim() && row.fulfillmentMode === input.fulfillmentMode && canonical(JSON.parse(row.linesJson)) === canonical(input.lines));
  if (!match || overlapping.some((row) => row.id !== match.id)) return { ok: false, draftId: null };
  return { ok: true, draftId: match.id };
}
export async function attachLabelToShipment(ownerId: string, id: string, shipmentId: string): Promise<LogisticsResult> {
  ownerValid(ownerId); requireWritable(); if (!uuid.safeParse(id).success || !uuid.safeParse(shipmentId).success) return fail("invalid_input"); const row = await readDraft(ownerId, id); if (!row) return fail("not_found");
  if (row.shipmentId === shipmentId) return ok(dto(row)); if (row.status !== "ready" || row.test || row.shipmentId) return fail("invalid_label_state", "Only a real purchased label can attach to its matching dispatched parcel. Test labels are not valid postage.");
  const shipment = await getD1().prepare(`SELECT id,order_id AS orderId,carrier_code AS carrierCode,tracking_number AS trackingNumber,fulfillment_mode AS fulfillmentMode,lines_json AS linesJson FROM shipments WHERE owner_id=? AND id=?`).bind(ownerId, shipmentId).first<{ id: string; orderId: string; carrierCode: string; trackingNumber: string; fulfillmentMode: string; linesJson: string }>();
  const canonical = (value: string) => JSON.stringify((JSON.parse(value) as ShipmentLineInput[]).sort((a, b) => a.sku.localeCompare(b.sku)));
  if (!shipment || shipment.orderId !== row.orderId || shipment.carrierCode !== row.carrierCode || shipment.trackingNumber !== row.trackingNumber || shipment.fulfillmentMode !== row.fulfillmentMode || canonical(shipment.linesJson) !== canonical(row.linesJson)) return fail("shipment_mismatch");
  const updated = await getD1().prepare(`UPDATE logistics_label_drafts SET shipment_id=?,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=? AND status='ready' AND test=0 AND shipment_id IS NULL AND EXISTS(SELECT 1 FROM shipments WHERE owner_id=? AND id=? AND order_id=? AND tracking_number=? AND carrier_code=?)`).bind(shipmentId, nowIso(), ownerId, id, row.version, ownerId, shipmentId, row.orderId, row.trackingNumber, row.carrierCode).run();
  if (!(updated.meta.changes ?? 0)) return fail("conflict"); return ok(dto((await readDraft(ownerId, id))!));
}
export async function getLabelPdf(ownerId: string, id: string): Promise<Uint8Array | null> {
  ownerValid(ownerId); if (!uuid.safeParse(id).success) return null; const row = await readDraft(ownerId, id); if (!row || row.status !== "ready" || !row.labelUrl) return null;
  return downloadLabelPdf(row.labelUrl);
}

type TrackingRow = { id: string; shipmentId: string; orderId: string; trackingNumber: string; trackingCarrier: string; providerStatus: string | null; providerStatusDate: string | null; attempts: number; leaseToken: string | null };
async function populateTrackingJobs(ownerId: string) {
  const config = getLogisticsConfiguration(); const db = getD1();
  const parcels = await db.prepare(`SELECT s.id,s.carrier_code AS carrierCode,s.tracking_number AS trackingNumber,d.tracking_carrier AS trackingCarrier FROM shipments s LEFT JOIN logistics_label_drafts d ON d.shipment_id=s.id AND d.owner_id=s.owner_id AND d.test=0 WHERE s.owner_id=? AND s.status!='delivered' ORDER BY s.created_at LIMIT 1000`).bind(ownerId).all<{ id: string; carrierCode: string; trackingNumber: string; trackingCarrier: string | null }>();
  for (const parcel of parcels.results) {
    const carrier = parcel.trackingCarrier ?? config.carrierMap[parcel.carrierCode]; if (!carrier) continue;
    // A corrected manual tracking number replaces the old polling identity and invalidates any old lease.
    await db.prepare(`INSERT INTO logistics_tracking_jobs(id,owner_id,shipment_id,tracking_number,tracking_carrier,next_attempt_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,shipment_id) DO UPDATE SET tracking_number=excluded.tracking_number,tracking_carrier=excluded.tracking_carrier,provider_status=NULL,provider_status_date=NULL,last_checked_at=NULL,next_attempt_at=excluded.next_attempt_at,attempts=0,error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=excluded.updated_at WHERE logistics_tracking_jobs.tracking_number!=excluded.tracking_number OR logistics_tracking_jobs.tracking_carrier!=excluded.tracking_carrier`).bind(crypto.randomUUID(), ownerId, parcel.id, parcel.trackingNumber, carrier, nowIso(), nowIso()).run();
  }
}
async function applyAutomaticStatus(ownerId: string, job: TrackingRow, status: string, date: string | null, token: string) {
  const db = getD1(); const now = nowIso(); const target = status === "DELIVERED" ? "delivered" : status === "TRANSIT" ? "transit" : null;
  const parcel = await db.prepare(`SELECT s.status,s.version,o.version AS orderVersion,o.payment_status AS paymentStatus,o.review_status AS reviewStatus FROM shipments s JOIN orders o ON o.id=s.order_id AND o.owner_id=s.owner_id WHERE s.owner_id=? AND s.id=? AND s.tracking_number=?`).bind(ownerId, job.shipmentId, job.trackingNumber).first<{ status: string; version: number; orderVersion: number; paymentStatus: string; reviewStatus: string }>();
  if (!parcel || !target || parcel.paymentStatus !== "paid" || parcel.reviewStatus !== "confirmed" || parcel.status === "delivered" || (parcel.status === "transit" && target === "transit") || (job.providerStatusDate && date && date < job.providerStatusDate)) return;
  const gate = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare(`INSERT INTO admin_operation_guards(id,allowed) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM logistics_tracking_jobs WHERE owner_id=? AND id=? AND lease_token=? AND tracking_number=?) AND EXISTS(SELECT 1 FROM shipments WHERE owner_id=? AND id=? AND version=? AND tracking_number=?) AND EXISTS(SELECT 1 FROM orders WHERE owner_id=? AND id=? AND version=? AND payment_status='paid' AND review_status='confirmed') THEN 1 ELSE 0 END`).bind(gate, ownerId, job.id, token, job.trackingNumber, ownerId, job.shipmentId, parcel.version, job.trackingNumber, ownerId, job.orderId, parcel.orderVersion),
      db.prepare(`UPDATE shipments SET status=?,note=?,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?`).bind(target, `Shippo verified tracking: ${status}${date ? ` at ${date}` : ""}`, now, ownerId, job.shipmentId, parcel.version),
      db.prepare(`UPDATE orders SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM order_reservations WHERE owner_id=? AND order_id=? AND remaining>0) AND NOT EXISTS(SELECT 1 FROM shipments WHERE owner_id=? AND order_id=? AND status!='delivered') THEN 'delivered' WHEN NOT EXISTS(SELECT 1 FROM order_reservations WHERE owner_id=? AND order_id=? AND remaining>0) AND NOT EXISTS(SELECT 1 FROM shipments WHERE owner_id=? AND order_id=? AND status='shipped') THEN 'transit' ELSE 'handoff' END,
        progress=CASE WHEN NOT EXISTS(SELECT 1 FROM order_reservations WHERE owner_id=? AND order_id=? AND remaining>0) AND NOT EXISTS(SELECT 1 FROM shipments WHERE owner_id=? AND order_id=? AND status!='delivered') THEN 100 WHEN NOT EXISTS(SELECT 1 FROM order_reservations WHERE owner_id=? AND order_id=? AND remaining>0) AND NOT EXISTS(SELECT 1 FROM shipments WHERE owner_id=? AND order_id=? AND status='shipped') THEN 84 ELSE 64 END,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?`).bind(ownerId, job.orderId, ownerId, job.orderId, ownerId, job.orderId, ownerId, job.orderId, ownerId, job.orderId, ownerId, job.orderId, ownerId, job.orderId, ownerId, job.orderId, now, ownerId, job.orderId, parcel.orderVersion),
      db.prepare(`INSERT INTO admin_order_audit(id,owner_id,order_id,action,note,details_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), ownerId, job.orderId, "shipment_tracking_automatic", null, JSON.stringify({ shipmentId: job.shipmentId, from: parcel.status, to: target, provider: "shippo", statusDate: date, stockDeducted: false }), "logistics-worker", now),
      db.prepare(`DELETE FROM admin_operation_guards WHERE id=?`).bind(gate),
    ]);
  } catch (error) { if (!(error instanceof Error && /constraint|CHECK|UNIQUE/i.test(error.message))) throw error; }
}
export async function pollLogistics(ownerId: string, options: { limit?: number } = {}) {
  ownerValid(ownerId); requireWritable(); const config = getLogisticsConfiguration(); if (!config.tokenConfigured) return { ok: false, code: "configuration_missing", processed: 0 };
  if (!config.pollingEnabled) return { ok: false, code: "polling_disabled", processed: 0 };
  const limit = options.limit ?? 2; if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) return { ok: false, code: "invalid_input", processed: 0 };
  const db = getD1(); let processed = 0; let failed = 0;
  const drafts = await db.prepare(`SELECT ${draftColumns} FROM logistics_label_drafts d JOIN orders o ON o.id=d.order_id AND o.owner_id=d.owner_id WHERE d.owner_id=? AND d.status IN ('quoting','purchasing','pending','unknown') AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=?) AND (d.lease_expires_at IS NULL OR d.lease_expires_at<=?) ORDER BY d.created_at LIMIT ?`).bind(ownerId, nowIso(), nowIso(), limit).all<DraftRow>();
  for (const draft of drafts.results) { const result = await refreshLabel(ownerId, draft.id, draft.version); processed++; if (!result.ok || result.draft?.status === "unknown" || result.draft?.status === "error") failed++; }
  await populateTrackingJobs(ownerId);
  const jobs = await db.prepare(`SELECT j.id,j.shipment_id AS shipmentId,s.order_id AS orderId,j.tracking_number AS trackingNumber,j.tracking_carrier AS trackingCarrier,j.provider_status AS providerStatus,j.provider_status_date AS providerStatusDate,j.attempts,j.lease_token AS leaseToken FROM logistics_tracking_jobs j JOIN shipments s ON s.id=j.shipment_id AND s.owner_id=j.owner_id WHERE j.owner_id=? AND s.status!='delivered' AND j.next_attempt_at<=? AND (j.lease_expires_at IS NULL OR j.lease_expires_at<=?) ORDER BY j.next_attempt_at,j.id LIMIT ?`).bind(ownerId, nowIso(), nowIso(), Math.max(0, limit - processed)).all<TrackingRow>();
  for (const job of jobs.results) {
    const token = crypto.randomUUID(); const lease = await db.prepare(`UPDATE logistics_tracking_jobs SET lease_token=?,lease_expires_at=? WHERE owner_id=? AND id=? AND tracking_number=? AND next_attempt_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?)`).bind(token, future(60_000), ownerId, job.id, job.trackingNumber, nowIso(), nowIso()).run(); if (!(lease.meta.changes ?? 0)) continue;
    try {
      const update = await retrieveTracking(job.trackingCarrier, job.trackingNumber);
      // Test tracking can return synthetic carrier events. It must never advance a real order.
      if (config.mode === "live") await applyAutomaticStatus(ownerId, job, update.status, update.date, token);
      const fresh = !job.providerStatusDate || !update.date || update.date >= job.providerStatusDate;
      await db.prepare(`UPDATE logistics_tracking_jobs SET provider_status=CASE WHEN ? THEN ? ELSE provider_status END,provider_status_date=CASE WHEN ? THEN ? ELSE provider_status_date END,last_checked_at=?,next_attempt_at=?,attempts=0,error_code=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE owner_id=? AND id=? AND lease_token=?`).bind(fresh ? 1 : 0, update.status, fresh ? 1 : 0, update.date, nowIso(), future(2 * 3_600_000), config.mode === "test" ? "test_tracking_no_order_update" : null, nowIso(), ownerId, job.id, token).run();
    } catch (error) {
      const attempts = job.attempts + 1; await db.prepare(`UPDATE logistics_tracking_jobs SET last_checked_at=?,next_attempt_at=?,attempts=?,error_code=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE owner_id=? AND id=? AND lease_token=?`).bind(nowIso(), future(Math.min(6 * 3_600_000, 300_000 * 2 ** Math.min(attempts, 7))), attempts, providerFailure(error), nowIso(), ownerId, job.id, token).run(); failed++;
    }
    processed++;
  }
  return { ok: true, processed, failed };
}
