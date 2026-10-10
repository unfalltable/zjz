import { getD1 } from "./index";
import { getOpsProducts } from "./catalog";
import { statusProgress, validateOrderTransition, validateStockAdjustment } from "@backend/domain/commerce";
import { updateOrderStatusSql, insertOrderStatusEventSql, restockProductSql, insertInventoryEventSql } from "@backend/domain/commerce-sql";
import type { FulfillmentMode, OpsAuditEvent, OpsOrder, OpsSnapshot, OrderStatus } from "@shared/ops-types";

// Compatibility for the admin shell: an unavailable database must not look like live demo sales.
export const demoSnapshot: OpsSnapshot = { orders: [], products: [], auditEvents: [] };

type OrderRow = Omit<OpsOrder, "routeModes"> & { id: string; lineItemsJson: string | null; version: number };

export async function getOpsSnapshot(ownerId: string): Promise<OpsSnapshot> {
  const [orders, products, auditEvents] = await Promise.all([
    getD1().prepare(`SELECT id, order_number AS orderNumber, customer_name AS customerName,
      destination, product_name AS productName, amount_cents AS amountCents, currency,
      fulfillment_mode AS fulfillmentMode, payment_status AS paymentStatus,
      line_items_json AS lineItemsJson, status, progress, version,
      created_at AS createdAt, updated_at AS updatedAt
      FROM orders WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200`).bind(ownerId).all<OrderRow>(),
    getOpsProducts(ownerId),
    getAuditEvents(ownerId),
  ]);
  return {
    orders: orders.results.map(({ id: _id, lineItemsJson, ...order }) => ({
      ...order, routeModes: parseRouteModes(lineItemsJson, order.fulfillmentMode), inventoryReserved: false,
    })), products, auditEvents,
  };
}

export async function setOrderStatus(ownerId: string, orderNumber: string, status: OrderStatus, expectedVersion?: number) {
  const db = getD1();
  const current = await db.prepare(`SELECT status, payment_status AS paymentStatus, version
    FROM orders WHERE owner_id = ? AND order_number = ? LIMIT 1`).bind(ownerId, orderNumber)
    .first<{ status: OrderStatus; paymentStatus: OpsOrder["paymentStatus"]; version: number }>();
  if (!current) return "not_found" as const;
  if (expectedVersion !== undefined && expectedVersion !== current.version) return "conflict" as const;
  const transition = validateOrderTransition(current.status, status, current.paymentStatus);
  if (transition === "unchanged") return "updated" as const;
  if (transition !== "allowed") return transition;
  const now = new Date().toISOString();
  // The payment and version guards live in the UPDATE, not just in the preceding read.
  // D1 batch rolls the mutation back if its audit INSERT fails.
  const results = await db.batch([
    db.prepare(updateOrderStatusSql).bind(status, statusProgress[status], now, ownerId, orderNumber, current.status, current.version),
    db.prepare(insertOrderStatusEventSql).bind(crypto.randomUUID(), current.status, ownerId, now, ownerId, orderNumber),
  ]);
  return (results[0].meta.changes ?? 0) > 0 ? "updated" as const : "conflict" as const;
}

export async function addProductStock(ownerId: string, sku: string, quantity: number, note?: string): Promise<boolean> {
  if (!validateStockAdjustment(quantity, note)) {
    throw new Error("invalid_stock_adjustment");
  }
  const db = getD1();
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(restockProductSql).bind(quantity, now, ownerId, sku, quantity),
    db.prepare(insertInventoryEventSql).bind(crypto.randomUUID(), quantity, ownerId, now, note?.trim() || null, ownerId, sku),
  ]);
  return (results[0].meta.changes ?? 0) > 0;
}

async function getAuditEvents(ownerId: string): Promise<OpsAuditEvent[]> {
  const events = await getD1().prepare(`SELECT id, time, entity, entityId, action, actorId, details FROM (
    SELECT e.id, e.created_at AS time, 'order' AS entity, o.order_number AS entityId,
      e.event_type AS action, e.actor_id AS actorId,
      json_object('from', e.from_status, 'to', e.to_status, 'version', e.order_version) AS details
    FROM order_events e JOIN orders o ON o.id = e.order_id WHERE e.owner_id = ? AND o.owner_id = ?
    UNION ALL
    SELECT e.id, e.created_at AS time, 'inventory' AS entity, p.sku AS entityId,
      'restocked' AS action, e.actor_id AS actorId,
      json_object('quantity', e.quantity, 'stock', e.resulting_stock, 'note', e.note) AS details
    FROM inventory_events e JOIN products p ON p.id = e.product_id WHERE e.owner_id = ? AND p.owner_id = ?
    UNION ALL
    SELECT e.id, e.created_at AS time, 'catalog' AS entity, p.sku AS entityId,
      e.action, e.actor_id AS actorId, e.details_json AS details
    FROM catalog_events e JOIN products p ON p.id = e.product_id WHERE e.owner_id = ? AND p.owner_id = ?
  ) ORDER BY time DESC, id DESC LIMIT 100`).bind(ownerId, ownerId, ownerId, ownerId, ownerId, ownerId).all<OpsAuditEvent>();
  return events.results;
}

function parseRouteModes(value: string | null, fallback: FulfillmentMode): FulfillmentMode[] {
  if (!value) return [fallback];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [fallback];
    const modes = Array.from(new Set(parsed.flatMap((item: unknown) => {
      if (!item || typeof item !== "object" || !("fulfillmentMode" in item)) return [];
      const mode = item.fulfillmentMode;
      return mode === "marketplace" || mode === "self" || mode === "supplier" ? [mode] : [];
    }))) as FulfillmentMode[];
    return modes.length ? modes : [fallback];
  } catch { return [fallback]; }
}
