import { getD1 } from "./index";
import type { PublicFulfillment } from "@shared/public-fulfillment";

/** Call only after matching order number + checkout email. No addresses, staff notes or audits. */
export async function getPublicFulfillment(ownerId: string, orderNumber: string): Promise<PublicFulfillment> {
  const order = await getD1().prepare("SELECT id, review_status AS reviewStatus FROM orders WHERE owner_id=? AND order_number=?")
    .bind(ownerId, orderNumber).first<{ id: string; reviewStatus: PublicFulfillment["reviewStatus"] }>();
  if (!order) return { reviewStatus: "unreviewed", shipments: [] };
  const packages = await getD1().prepare(`SELECT COALESCE(c.name,s.carrier_code) AS carrierName,
    s.tracking_number AS trackingNumber, s.tracking_url AS trackingUrl, s.status, s.created_at AS createdAt, s.updated_at AS updatedAt
    FROM shipments s LEFT JOIN shipping_carriers c ON c.owner_id=s.owner_id AND c.code=s.carrier_code
    WHERE s.owner_id=? AND s.order_id=? ORDER BY s.created_at ASC LIMIT 200`).bind(ownerId, order.id)
    .all<Omit<PublicFulfillment["shipments"][number], "source">>();
  return { reviewStatus: order.reviewStatus, shipments: packages.results.map((shipment) => ({ ...shipment,
    trackingUrl: safeCarrierLink(shipment.trackingUrl), source: "manual" })) };
}

function safeCarrierLink(value: string | null): string | null {
  if (!value || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash && (!url.port || url.port === "443")
    && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)
    && !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/i.test(url.hostname) ? url.href : null; }
  catch { return null; }
}
