import { getD1 } from "./index";
import { resolveCarrierTracking } from "./shipping";
import type { FulfillmentMode } from "@shared/ops-types";
import type { AdminAfterSale, AdminAfterSalesPage, AdminOrderDetail, AdminOrderLine, AdminOrderSummary, AdminOrdersPage, AdminShipment, CreateAfterSaleInput, CreateShipmentInput, OperationResult, ShipmentLineInput, UpdateAfterSaleInput, UpdateShipmentInput } from "@shared/admin-commerce";

type Statement = ReturnType<ReturnType<typeof getD1>["prepare"]>;
type RawOrder = AdminOrderSummary & { id: string; lineItemsJson: string | null; phone: string | null; postalCode: string | null; shippingAddress: string | null; deliveryMethod: string | null; shippingCents: number; fulfillmentMode: FulfillmentMode; reviewNote: string | null };
type Product = { id: string; sku: string; stock: number; reserved: number; version: number };
type Reservation = { id: string; productId: string; sku: string; quantity: number; remaining: number; shipped: number };
type RawShipment = Omit<AdminShipment, "lines"> & { orderId: string; linesJson: string };
type RawAfterSale = Omit<AdminAfterSale, "lines" | "restocked"> & { orderId: string; linesJson: string; restocked: number };
const orderColumns = `id, order_number AS orderNumber, customer_name AS customerName, customer_email AS customerEmail,
  destination, product_name AS productName, amount_cents AS amountCents, currency, payment_status AS paymentStatus,
  status, review_status AS reviewStatus, review_note AS reviewNote, version, created_at AS createdAt, updated_at AS updatedAt,
  phone, postal_code AS postalCode, shipping_address AS shippingAddress, delivery_method AS deliveryMethod,
  shipping_cents AS shippingCents, fulfillment_mode AS fulfillmentMode, line_items_json AS lineItemsJson`;
const shipmentColumns = `s.id,s.order_id AS orderId,o.order_number AS orderNumber,s.fulfillment_mode AS fulfillmentMode,
  s.carrier_code AS carrierCode,s.tracking_number AS trackingNumber,s.tracking_url AS trackingUrl,s.lines_json AS linesJson,
  s.status,s.note,s.version,s.created_at AS createdAt,s.updated_at AS updatedAt`;
const afterSaleColumns = `a.id,a.order_id AS orderId,o.order_number AS orderNumber,a.kind,a.reason,a.lines_json AS linesJson,
  a.amount_cents AS amountCents,a.status,a.restocked,a.note,a.version,a.created_at AS createdAt,a.updated_at AS updatedAt`;
const modes = new Set(["marketplace", "self", "supplier"]);
const ok = (message?: string): OperationResult => ({ ok: true, message });
const fail = (code: string, message: string): OperationResult => ({ ok: false, code, message });
const invalid = () => fail("invalid_input", "Please check the required details and quantities.");
const conflict = () => fail("conflict", "The record or inventory changed. Reload and try again.");
const validVersion = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const text = (value: unknown, max: number, required = false): value is string => typeof value === "string" && value.trim().length <= max && (!required || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const quantities = (input: unknown): input is ShipmentLineInput[] => Array.isArray(input) && input.length > 0 && input.length <= 20 && input.every((line) => line && text(line.sku, 100, true) && Number.isSafeInteger(line.quantity) && line.quantity > 0 && line.quantity <= 1000) && new Set(input.map((line) => line.sku)).size === input.length;

function orderLines(json: string | null): AdminOrderLine[] | null {
  try {
    const lines = JSON.parse(json ?? "null");
    if (!quantities(lines)) return null;
    const snapshots = lines as AdminOrderLine[];
    if (!snapshots.every((line) => text(line.name, 300, true) && Number.isSafeInteger(line.priceCents) && line.priceCents >= 0 && line.priceCents <= 100_000_000 && modes.has(line.fulfillmentMode))) return null;
    return snapshots.map((line) => ({ sku: line.sku, name: line.name, quantity: line.quantity, priceCents: line.priceCents, fulfillmentMode: line.fulfillmentMode, reservedQuantity: 0, shippedQuantity: 0, afterSaleQuantity: 0 }));
  } catch { return null; }
}
function safeLines(json: string): ShipmentLineInput[] {
  try { const value = JSON.parse(json); return quantities(value) ? value.map(({ sku, quantity }) => ({ sku, quantity })) : []; } catch { return []; }
}
const canonicalLines = (lines: ShipmentLineInput[]) => lines.map(({ sku, quantity }) => ({ sku, quantity }));
function summary(row: RawOrder): AdminOrderSummary {
  const { orderNumber, customerName, customerEmail, destination, productName, amountCents, currency, paymentStatus, status, reviewStatus, version, createdAt, updatedAt } = row;
  return { orderNumber, customerName, customerEmail, destination, productName, amountCents, currency, paymentStatus, status, reviewStatus, version, createdAt, updatedAt };
}
function shipment(row: RawShipment): AdminShipment { const { linesJson, orderId: _id, ...rest } = row; return { ...rest, lines: safeLines(linesJson) }; }
function afterSale(row: RawAfterSale): AdminAfterSale { const { linesJson, orderId: _id, ...rest } = row; return { ...rest, restocked: Boolean(rest.restocked), lines: safeLines(linesJson) }; }
function pageNumber(page: number) { return Number.isSafeInteger(page) && page > 0 && page <= 1_000_000 ? page : 1; }
function searchPattern(query: string) { return `%${String(query ?? "").trim().slice(0, 100).replace(/[\\%_]/g, "\\$&")}%`; }

async function readOrder(ownerId: string, number: string): Promise<RawOrder | null> {
  return getD1().prepare(`SELECT ${orderColumns} FROM orders WHERE owner_id=? AND order_number=?`).bind(ownerId, number).first<RawOrder>();
}
async function readReservations(ownerId: string, orderId: string): Promise<Reservation[]> {
  return (await getD1().prepare(`SELECT id,product_id AS productId,sku,quantity,remaining,shipped FROM order_reservations WHERE owner_id=? AND order_id=?`).bind(ownerId, orderId).all<Reservation>()).results;
}
async function readProducts(ownerId: string, lines: ShipmentLineInput[]): Promise<Product[]> {
  return Promise.all(lines.map(async (line) => getD1().prepare(`SELECT id,sku,stock,reserved,version FROM products WHERE owner_id=? AND sku=?`).bind(ownerId, line.sku).first<Product>())).then((rows) => rows.filter((row): row is Product => row !== null));
}
async function readCases(ownerId: string, orderId: string): Promise<RawAfterSale[]> {
  return (await getD1().prepare(`SELECT ${afterSaleColumns} FROM after_sales a JOIN orders o ON o.id=a.order_id AND o.owner_id=a.owner_id WHERE a.owner_id=? AND a.order_id=?`).bind(ownerId, orderId).all<RawAfterSale>()).results;
}

export async function getAdminOrders(ownerId: string, query = "", page = 1, review: "all" | "unreviewed" | "confirmed" | "cancelled" = "all"): Promise<AdminOrdersPage> {
  const pattern = searchPattern(query); const pageSize = 20; page = pageNumber(page);
  const where = `owner_id=? AND (order_number LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR customer_email LIKE ? ESCAPE '\\' OR product_name LIKE ? ESCAPE '\\' OR review_status LIKE ? ESCAPE '\\' OR payment_status LIKE ? ESCAPE '\\' OR status LIKE ? ESCAPE '\\')${review === "all" ? "" : " AND review_status=?"}`;
  const args = [ownerId, pattern, pattern, pattern, pattern, pattern, pattern, pattern];
  if (review !== "all") args.push(review);
  const count = await getD1().prepare(`SELECT count(*) AS total FROM orders WHERE ${where}`).bind(...args).first<{ total: number }>();
  const result = await getD1().prepare(`SELECT ${orderColumns} FROM orders WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...args, pageSize, (page - 1) * pageSize).all<RawOrder>();
  return { orders: result.results.map(summary), total: count?.total ?? 0, page, pageSize };
}

export async function getAdminAfterSales(ownerId: string, query = "", page = 1): Promise<AdminAfterSalesPage> {
  const pattern = searchPattern(query); const pageSize = 20; page = pageNumber(page);
  const where = `a.owner_id=? AND (o.order_number LIKE ? ESCAPE '\\' OR a.reason LIKE ? ESCAPE '\\' OR a.status LIKE ? ESCAPE '\\' OR a.kind LIKE ? ESCAPE '\\')`;
  const args = [ownerId, pattern, pattern, pattern, pattern]; const from = `FROM after_sales a JOIN orders o ON o.id=a.order_id AND o.owner_id=a.owner_id`;
  const count = await getD1().prepare(`SELECT count(*) AS total ${from} WHERE ${where}`).bind(...args).first<{ total: number }>();
  const result = await getD1().prepare(`SELECT ${afterSaleColumns} ${from} WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`).bind(...args, pageSize, (page - 1) * pageSize).all<RawAfterSale>();
  return { cases: result.results.map(afterSale), total: count?.total ?? 0, page, pageSize };
}

export async function getAdminOrderDetail(ownerId: string, number: string): Promise<AdminOrderDetail | null> {
  const order = await readOrder(ownerId, number); if (!order) return null;
  const [reservations, packages, cases, audit] = await Promise.all([
    readReservations(ownerId, order.id),
    getD1().prepare(`SELECT ${shipmentColumns} FROM shipments s JOIN orders o ON o.id=s.order_id AND o.owner_id=s.owner_id WHERE s.owner_id=? AND s.order_id=? ORDER BY s.created_at,s.id`).bind(ownerId, order.id).all<RawShipment>(),
    readCases(ownerId, order.id),
    getD1().prepare(`SELECT id,action,note,details_json AS details,actor_id AS actorId,created_at AS createdAt FROM admin_order_audit WHERE owner_id=? AND order_id=? ORDER BY created_at DESC,id DESC LIMIT 200`).bind(ownerId, order.id).all<AdminOrderDetail["auditEvents"][number]>(),
  ]);
  const lines = orderLines(order.lineItemsJson) ?? [];
  for (const line of lines) {
    const reservation = reservations.find((item) => item.sku === line.sku);
    line.reservedQuantity = reservation?.remaining ?? 0; line.shippedQuantity = reservation?.shipped ?? 0;
    line.afterSaleQuantity = cases.filter((item) => item.status !== "rejected").reduce((sum, item) => sum + (safeLines(item.linesJson).find((entry) => entry.sku === line.sku)?.quantity ?? 0), 0);
  }
  return { ...summary(order), phone: order.phone, postalCode: order.postalCode, shippingAddress: order.shippingAddress, deliveryMethod: order.deliveryMethod, shippingCents: order.shippingCents, fulfillmentMode: order.fulfillmentMode, reviewNote: order.reviewNote, lines, shipments: packages.results.map(shipment), afterSales: cases.map(afterSale), auditEvents: audit.results };
}

// Every mutation is one atomic D1/SQLite batch. The CHECK gate verifies the complete
// read snapshot INSIDE the transaction, including payment/version and stock guards.
function orderGuard(ownerId: string, order: RawOrder, extra = "1=1", values: unknown[] = []): { sql: string; values: unknown[] } {
  return { sql: `EXISTS(SELECT 1 FROM orders WHERE owner_id=? AND id=? AND version=? AND payment_status=? AND review_status=? AND ${extra})`, values: [ownerId, order.id, order.version, order.paymentStatus, order.reviewStatus, ...values] };
}
function productGuard(ownerId: string, product: Product, extra = "1=1", values: unknown[] = []) {
  return { sql: `EXISTS(SELECT 1 FROM products WHERE owner_id=? AND id=? AND version=? AND ${extra})`, values: [ownerId, product.id, product.version, ...values] };
}
async function atomic(ownerId: string, order: RawOrder, action: string, note: string | null, details: unknown, guards: { sql: string; values: unknown[] }[], statements: Statement[]): Promise<OperationResult> {
  const db = getD1(); const id = crypto.randomUUID(); const now = new Date().toISOString();
  const gate = db.prepare(`INSERT INTO admin_operation_guards(id,allowed) SELECT ?,CASE WHEN ${guards.map((guard) => `(${guard.sql})`).join(" AND ")} THEN 1 ELSE 0 END`).bind(id, ...guards.flatMap((guard) => guard.values));
  try {
    await db.batch([gate, ...statements,
      db.prepare(`INSERT INTO admin_order_audit(id,owner_id,order_id,action,note,details_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), ownerId, order.id, action, note, JSON.stringify(details), ownerId, now),
      db.prepare(`DELETE FROM admin_operation_guards WHERE id=?`).bind(id),
    ]);
    return ok();
  } catch (error) {
    if (error instanceof Error && /constraint|CHECK|UNIQUE/i.test(error.message)) return conflict();
    throw error;
  }
}
function advanceOrder(ownerId: string, order: RawOrder, now: string): Statement {
  return getD1().prepare(`UPDATE orders SET version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?`).bind(now, ownerId, order.id, order.version);
}
function inventoryAudit(ownerId: string, product: Product, quantity: number, now: string, note: string): Statement {
  return getD1().prepare(`INSERT INTO inventory_events(id,owner_id,product_id,quantity,resulting_stock,note,actor_id,created_at) SELECT ?,?,?,?,stock,?,?,? FROM products WHERE owner_id=? AND id=?`).bind(crypto.randomUUID(), ownerId, product.id, quantity, note, ownerId, now, ownerId, product.id);
}

export async function reviewOrder(ownerId: string, number: string, expectedVersion: number, decision: "confirm" | "cancel", note = ""): Promise<OperationResult> {
  if (!validVersion(expectedVersion) || !["confirm", "cancel"].includes(decision) || !text(note, 1000, decision === "cancel")) return invalid();
  const order = await readOrder(ownerId, number); if (!order) return fail("not_found", "Order not found.");
  if (order.version !== expectedVersion) return conflict();
  if (order.reviewStatus === "cancelled") return decision === "cancel" ? ok("Already cancelled.") : fail("cancelled", "A cancelled order cannot be confirmed.");
  const reservations = await readReservations(ownerId, order.id);
  const now = new Date().toISOString(); const guards = [orderGuard(ownerId, order)]; const statements: Statement[] = [];
  if (decision === "cancel") {
    const shipped = await getD1().prepare(`SELECT count(*) AS count FROM shipments WHERE owner_id=? AND order_id=?`).bind(ownerId, order.id).first<{ count: number }>();
    if (shipped?.count) return fail("already_shipped", "Dispatched orders require an after-sale case, not cancellation.");
    guards.push({ sql: `NOT EXISTS(SELECT 1 FROM shipments WHERE owner_id=? AND order_id=?)`, values: [ownerId, order.id] });
    for (const reservation of reservations.filter((item) => item.remaining > 0)) {
      const products = await readProducts(ownerId, [{ sku: reservation.sku, quantity: reservation.remaining }]); const product = products[0];
      if (!product || product.reserved < reservation.remaining) return fail("inventory_inconsistent", "Reserved stock requires reconciliation before cancellation.");
      guards.push(productGuard(ownerId, product, "reserved>=?", [reservation.remaining]));
      statements.push(getD1().prepare(`UPDATE products SET reserved=reserved-?,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?`).bind(reservation.remaining, now, ownerId, product.id, product.version));
    }
    statements.push(getD1().prepare(`UPDATE order_reservations SET remaining=0 WHERE owner_id=? AND order_id=?`).bind(ownerId, order.id));
    // Cancellation never claims a refund happened. A paid cancellation enters a manual
    // refund queue; external payment/refund execution remains disabled.
    if (order.paymentStatus === "paid") {
      const lines = orderLines(order.lineItemsJson); if (!lines) return fail("invalid_order_lines", "Legacy order lines require reconciliation before a paid cancellation.");
      statements.push(getD1().prepare(`INSERT INTO after_sales(id,owner_id,order_id,kind,reason,lines_json,amount_cents,status,created_at,updated_at) VALUES(?,?,?,'refund',?,?,?,'refund_pending',?,?)`).bind(crypto.randomUUID(), ownerId, order.id, `Cancelled order: ${note.trim()}`, JSON.stringify(lines.map(({ sku, quantity }) => ({ sku, quantity }))), order.amountCents, now, now));
    }
    statements.push(getD1().prepare(`UPDATE orders SET review_status='cancelled',review_note=?,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?`).bind(note.trim(), now, ownerId, order.id, order.version));
  } else {
    if (!order.shippingAddress?.trim() || !order.customerEmail?.trim() || !order.phone?.trim()) return fail("incomplete_address", "Confirm the recipient address, phone and email before approving the order.");
    const validatedLines = orderLines(order.lineItemsJson);
    if (!validatedLines) return fail("invalid_order_lines", "Order item snapshots are incomplete; do not confirm this order.");
    if (order.paymentStatus === "paid") {
      const lines = validatedLines;
      if (reservations.length) {
        if (order.reviewStatus === "confirmed" && lines.every((line) => reservations.find((item) => item.sku === line.sku)?.quantity === line.quantity)) return ok("Already confirmed and reserved.");
        return fail("inventory_inconsistent", "Existing reservations require reconciliation.");
      }
      if (["handoff", "transit", "delivered"].includes(order.status)) return fail("legacy_fulfillment", "This legacy order already reports dispatch. Reconcile historical shipments before adding reservations.");
      const products = await readProducts(ownerId, lines); if (products.length !== lines.length) return fail("product_missing", "An ordered SKU no longer exists.");
      for (const line of lines) {
        const product = products.find((item) => item.sku === line.sku)!;
        if (product.stock - product.reserved < line.quantity) return fail("insufficient_stock", `Insufficient available stock for ${line.sku}.`);
        guards.push(productGuard(ownerId, product, "stock-reserved>=?", [line.quantity]));
        statements.push(getD1().prepare(`UPDATE products SET reserved=reserved+?,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?`).bind(line.quantity, now, ownerId, product.id, product.version));
        statements.push(getD1().prepare(`INSERT INTO order_reservations(id,owner_id,order_id,product_id,sku,quantity,remaining,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), ownerId, order.id, product.id, line.sku, line.quantity, line.quantity, now));
      }
    } else if (order.paymentStatus !== "pending") return fail("payment_ineligible", "Only pending or paid orders can be confirmed.");
    else if (order.reviewStatus === "confirmed") return ok("Recipient details already confirmed; payment is still pending.");
    statements.push(getD1().prepare(`UPDATE orders SET review_status='confirmed',review_note=?,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?`).bind(note.trim() || null, now, ownerId, order.id, order.version));
  }
  return atomic(ownerId, order, decision === "confirm" ? "order_confirmed" : "order_cancelled", note.trim() || null, { paymentStatus: order.paymentStatus, inventoryReserved: decision === "confirm" && order.paymentStatus === "paid", lines: (orderLines(order.lineItemsJson) ?? []).map(({ sku, quantity }) => ({ sku, quantity })), releasedReservations: decision === "cancel" ? reservations.map(({ sku, remaining }) => ({ sku, quantity: remaining })) : [], refundExecuted: false }, guards, statements);
}

export async function createShipment(ownerId: string, number: string, expectedVersion: number, input: CreateShipmentInput): Promise<OperationResult> {
  if (!validVersion(expectedVersion) || !input || !modes.has(input.fulfillmentMode) || !quantities(input.lines) || !text(input.carrierCode, 40, true) || !text(input.trackingNumber, 100, true) || (input.note !== undefined && !text(input.note, 1000))) return invalid();
  const order = await readOrder(ownerId, number); if (!order) return fail("not_found", "Order not found.");
  if (order.version !== expectedVersion) return conflict();
  if (order.paymentStatus !== "paid") return fail("payment_required", "Payment must be completed before dispatch. Pending requests are not paid orders.");
  if (order.reviewStatus !== "confirmed") return fail("confirmation_required", "Confirm this order and reserve stock before dispatch.");
  const carrier = await resolveCarrierTracking(ownerId, input.carrierCode.trim(), input.trackingNumber.trim());
  if (!carrier) return fail("carrier_unavailable", "Choose an enabled carrier and a valid tracking number.");
  const lines = orderLines(order.lineItemsJson); if (!lines) return fail("invalid_order_lines", "Order item snapshots are incomplete.");
  const reservations = await readReservations(ownerId, order.id); const products = await readProducts(ownerId, input.lines);
  const now = new Date().toISOString(); const guards = [orderGuard(ownerId, order, "payment_status='paid' AND review_status='confirmed'")]; const statements: Statement[] = [];
  guards.push({ sql: `EXISTS(SELECT 1 FROM shipping_carriers WHERE owner_id=? AND code=? AND enabled=1)`, values: [ownerId, carrier.code] });
  for (const line of input.lines) {
    const original = lines.find((item) => item.sku === line.sku); const reservation = reservations.find((item) => item.sku === line.sku); const product = products.find((item) => item.sku === line.sku);
    if (!original || original.fulfillmentMode !== input.fulfillmentMode) return fail("invalid_route", "Each package must contain only ordered SKUs using the selected fulfillment route.");
    if (!reservation || reservation.remaining < line.quantity || !product || product.stock < line.quantity || product.reserved < line.quantity) return fail("insufficient_reserved_stock", `Not enough reserved, unshipped stock for ${line.sku}.`);
    guards.push(productGuard(ownerId, product, "stock>=? AND reserved>=?", [line.quantity, line.quantity]));
    guards.push({ sql: `EXISTS(SELECT 1 FROM order_reservations WHERE owner_id=? AND id=? AND remaining>=?)`, values: [ownerId, reservation.id, line.quantity] });
    statements.push(getD1().prepare(`UPDATE products SET stock=stock-?,reserved=reserved-?,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?`).bind(line.quantity, line.quantity, now, ownerId, product.id, product.version));
    statements.push(getD1().prepare(`UPDATE order_reservations SET remaining=remaining-?,shipped=shipped+? WHERE owner_id=? AND id=?`).bind(line.quantity, line.quantity, ownerId, reservation.id));
    statements.push(inventoryAudit(ownerId, product, -line.quantity, now, `Dispatch ${number}: ${carrier.code} ${input.trackingNumber.trim()}`));
  }
  statements.push(getD1().prepare(`INSERT INTO shipments(id,owner_id,order_id,fulfillment_mode,carrier_code,tracking_number,tracking_url,lines_json,status,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'shipped',?,?,?)`).bind(crypto.randomUUID(), ownerId, order.id, input.fulfillmentMode, carrier.code, input.trackingNumber.trim(), carrier.trackingUrl, JSON.stringify(canonicalLines(input.lines)), input.note?.trim() || null, now, now));
  statements.push(getD1().prepare(`UPDATE orders SET status='handoff',progress=64,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=? AND payment_status='paid' AND review_status='confirmed'`).bind(now, ownerId, order.id, order.version));
  return atomic(ownerId, order, "shipment_dispatched", input.note?.trim() || null, { carrierCode: carrier.code, trackingNumber: input.trackingNumber.trim(), lines: canonicalLines(input.lines), source: "manual", stockDeducted: true }, guards, statements);
}

export async function updateShipment(ownerId: string, id: string, expectedVersion: number, input: UpdateShipmentInput): Promise<OperationResult> {
  if (!validVersion(expectedVersion) || !input || !["shipped", "transit", "delivered"].includes(input.status) || !text(input.note, 1000, true) || (input.trackingNumber !== undefined && !text(input.trackingNumber, 100, true))) return invalid();
  const row = await getD1().prepare(`SELECT ${shipmentColumns} FROM shipments s JOIN orders o ON o.id=s.order_id AND o.owner_id=s.owner_id WHERE s.owner_id=? AND s.id=?`).bind(ownerId, id).first<RawShipment>();
  if (!row) return fail("not_found", "Shipment not found."); if (row.version !== expectedVersion) return conflict();
  const rank = { shipped: 0, transit: 1, delivered: 2 };
  if (rank[input.status] < rank[row.status] || rank[input.status] > rank[row.status] + 1) return fail("invalid_transition", "Record tracking milestones in order: dispatched, in transit, delivered.");
  const order = await readOrder(ownerId, row.orderNumber); if (!order) return fail("not_found", "Order not found.");
  let trackingNumber = row.trackingNumber; let trackingUrl = row.trackingUrl;
  if (input.trackingNumber !== undefined && input.trackingNumber.trim() !== row.trackingNumber) {
    const carrier = await resolveCarrierTracking(ownerId, row.carrierCode, input.trackingNumber.trim()); if (!carrier) return fail("carrier_unavailable", "The carrier is disabled or the tracking number is invalid.");
    trackingNumber = input.trackingNumber.trim(); trackingUrl = carrier.trackingUrl;
  }
  const now = new Date().toISOString();
  const guards = [orderGuard(ownerId, order), { sql: `EXISTS(SELECT 1 FROM shipments WHERE owner_id=? AND id=? AND version=? AND status=?)`, values: [ownerId, id, row.version, row.status] }];
  const statements = [getD1().prepare(`UPDATE shipments SET status=?,tracking_number=?,tracking_url=?,note=?,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?`).bind(input.status, trackingNumber, trackingUrl, input.note.trim(), now, ownerId, id, row.version),
    getD1().prepare(`UPDATE orders SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM order_reservations WHERE owner_id=? AND order_id=? AND remaining>0) AND NOT EXISTS(SELECT 1 FROM shipments WHERE owner_id=? AND order_id=? AND status!='delivered') THEN 'delivered' WHEN NOT EXISTS(SELECT 1 FROM order_reservations WHERE owner_id=? AND order_id=? AND remaining>0) AND NOT EXISTS(SELECT 1 FROM shipments WHERE owner_id=? AND order_id=? AND status='shipped') THEN 'transit' ELSE 'handoff' END,
      progress=CASE WHEN NOT EXISTS(SELECT 1 FROM order_reservations WHERE owner_id=? AND order_id=? AND remaining>0) AND NOT EXISTS(SELECT 1 FROM shipments WHERE owner_id=? AND order_id=? AND status!='delivered') THEN 100 WHEN NOT EXISTS(SELECT 1 FROM order_reservations WHERE owner_id=? AND order_id=? AND remaining>0) AND NOT EXISTS(SELECT 1 FROM shipments WHERE owner_id=? AND order_id=? AND status='shipped') THEN 84 ELSE 64 END,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?`).bind(ownerId, order.id, ownerId, order.id, ownerId, order.id, ownerId, order.id, ownerId, order.id, ownerId, order.id, ownerId, order.id, ownerId, order.id, now, ownerId, order.id, order.version)];
  return atomic(ownerId, order, "shipment_tracking_manual", input.note.trim(), { shipmentId: id, from: row.status, to: input.status, trackingNumber, source: "manual", stockDeducted: false }, guards, statements);
}

export async function createAfterSale(ownerId: string, number: string, expectedVersion: number, input: CreateAfterSaleInput): Promise<OperationResult> {
  if (!validVersion(expectedVersion) || !input || !["return", "refund"].includes(input.kind) || !quantities(input.lines) || !text(input.reason, 1000, true) || !Number.isSafeInteger(input.amountCents) || input.amountCents < 0) return invalid();
  const order = await readOrder(ownerId, number); if (!order) return fail("not_found", "Order not found."); if (order.version !== expectedVersion) return conflict();
  if (order.paymentStatus !== "paid" || order.reviewStatus === "cancelled") return fail("payment_required", "After-sales require a paid, non-cancelled order. Cancel unpaid requests instead.");
  const lines = orderLines(order.lineItemsJson); if (!lines) return fail("invalid_order_lines", "Order item snapshots are incomplete.");
  const reservations = await readReservations(ownerId, order.id); const cases = (await readCases(ownerId, order.id)).filter((item) => item.status !== "rejected");
  let itemAmount = 0;
  for (const line of input.lines) {
    const original = lines.find((item) => item.sku === line.sku); const shipped = reservations.find((item) => item.sku === line.sku)?.shipped ?? 0;
    const claimed = cases.reduce((sum, item) => sum + (safeLines(item.linesJson).find((entry) => entry.sku === line.sku)?.quantity ?? 0), 0);
    if (!original || line.quantity > shipped - claimed) return fail("quantity_exceeded", "After-sale quantities cannot exceed unclaimed dispatched items. Cancel unshipped orders instead.");
    itemAmount += original.priceCents * line.quantity;
  }
  if (input.amountCents > itemAmount || input.amountCents + cases.reduce((sum, item) => sum + item.amountCents, 0) > order.amountCents) return fail("amount_exceeded", "The requested refund exceeds the selected item value or order balance.");
  const now = new Date().toISOString();
  return atomic(ownerId, order, "after_sale_requested", input.reason.trim(), { kind: input.kind, lines: canonicalLines(input.lines), amountCents: input.amountCents, refundExecuted: false }, [orderGuard(ownerId, order, "payment_status='paid' AND review_status!='cancelled'")], [
    getD1().prepare(`INSERT INTO after_sales(id,owner_id,order_id,kind,reason,lines_json,amount_cents,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'requested',?,?)`).bind(crypto.randomUUID(), ownerId, order.id, input.kind, input.reason.trim(), JSON.stringify(canonicalLines(input.lines)), input.amountCents, now, now),
    advanceOrder(ownerId, order, now),
  ]);
}

export async function updateAfterSale(ownerId: string, id: string, expectedVersion: number, input: UpdateAfterSaleInput): Promise<OperationResult> {
  if (!validVersion(expectedVersion) || !input || !["approve", "reject", "receive", "queue_refund", "close"].includes(input.action) || !text(input.note, 1000, true) || (input.restock !== undefined && typeof input.restock !== "boolean") || (input.restock && input.action !== "receive")) return invalid();
  const row = await getD1().prepare(`SELECT ${afterSaleColumns} FROM after_sales a JOIN orders o ON o.id=a.order_id AND o.owner_id=a.owner_id WHERE a.owner_id=? AND a.id=?`).bind(ownerId, id).first<RawAfterSale>();
  if (!row) return fail("not_found", "After-sale case not found."); if (row.version !== expectedVersion) return conflict();
  const order = await readOrder(ownerId, row.orderNumber); if (!order) return fail("not_found", "Order not found.");
  const target = { approve: "approved", reject: "rejected", receive: "received", queue_refund: "refund_pending", close: "closed" } as const;
  const allowed = input.action === "approve" ? row.status === "requested" : input.action === "reject" ? row.status === "requested" : input.action === "receive" ? row.kind === "return" && row.status === "approved" : input.action === "queue_refund" ? (row.kind === "refund" && row.status === "approved") || (row.kind === "return" && row.status === "received") : row.status === "received" && row.amountCents === 0;
  // A refund queue can never be "closed" as proof of payment. Refund integration is
  // suspended, so refund_pending remains explicit until a future verified payment callback.
  if (!allowed) return fail("invalid_transition", row.status === "refund_pending" && input.action === "close" ? "Refund execution is disabled. Keep this case in the pending-refund queue; do not mark it completed." : "This action is not allowed for the current case state.");
  const now = new Date().toISOString(); const guards = [orderGuard(ownerId, order), { sql: `EXISTS(SELECT 1 FROM after_sales WHERE owner_id=? AND id=? AND version=? AND status=? AND restocked=?)`, values: [ownerId, id, row.version, row.status, row.restocked] }]; const statements: Statement[] = [];
  if (input.action === "receive" && input.restock) {
    const lines = safeLines(row.linesJson); if (!lines.length || row.restocked) return fail("invalid_return", "Returned quantities cannot be restocked twice.");
    const products = await readProducts(ownerId, lines); if (products.length !== lines.length) return fail("product_missing", "An original SKU is missing; reconcile it before restocking.");
    for (const line of lines) {
      const product = products.find((item) => item.sku === line.sku)!;
      if (!Number.isSafeInteger(product.stock + line.quantity) || product.stock + line.quantity > 1_000_000) return fail("stock_limit", "Inventory exceeds the supported limit.");
      guards.push(productGuard(ownerId, product));
      statements.push(getD1().prepare(`UPDATE products SET stock=stock+?,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?`).bind(line.quantity, now, ownerId, product.id, product.version));
      statements.push(inventoryAudit(ownerId, product, line.quantity, now, `Verified return ${id}: ${input.note.trim()}`));
    }
  }
  statements.push(getD1().prepare(`UPDATE after_sales SET status=?,note=?,restocked=CASE WHEN ?=1 THEN 1 ELSE restocked END,version=version+1,updated_at=? WHERE owner_id=? AND id=? AND version=?`).bind(target[input.action], input.note.trim(), input.action === "receive" && input.restock ? 1 : 0, now, ownerId, id, row.version));
  statements.push(advanceOrder(ownerId, order, now));
  return atomic(ownerId, order, `after_sale_${input.action}`, input.note.trim(), { caseId: id, from: row.status, to: target[input.action], restocked: Boolean(input.restock), refundExecuted: false, paymentStatusUnchanged: true }, guards, statements);
}
