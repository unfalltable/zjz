import { getD1 } from "./index";
import type { FulfillmentMode, OrderStatus } from "@shared/ops-types";
import type { PaymentStatus } from "@backend/payments";
import { assertMatchingFingerprint, commerceFulfillmentModes, isValidPriceCents } from "@backend/domain/commerce";

export type PersistedLineItem = {
  sku: string;
  name: string;
  quantity: number;
  priceCents: number;
  fulfillmentMode: FulfillmentMode;
};

export type PendingOrderInput = {
  ownerId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  customerEmail: string;
  customerName: string;
  phone: string;
  destination: string;
  postalCode: string;
  shippingAddress: string;
  deliveryMethod: string;
  lineItems: PersistedLineItem[];
  subtotalCents: number;
  shippingCents: number;
  amountCents: number;
  fulfillmentMode: FulfillmentMode;
  marketingOptIn: boolean;
};

export type StorefrontOrderReceipt = {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  destination: string;
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
  inventoryReserved: false;
};

type StorefrontOrderRow = Omit<StorefrontOrderReceipt, "routeModes" | "inventoryReserved"> & {
  lineItemsJson: string | null;
  requestFingerprint: string | null;
};

export async function createPendingStorefrontOrder(
  input: PendingOrderInput
): Promise<StorefrontOrderReceipt> {
  const db = getD1();
  const existing = await findByIdempotency(input.ownerId, input.idempotencyKey);
  if (existing) {
    assertMatchingFingerprint(existing.requestFingerprint, input.requestFingerprint);
    return toReceipt(existing);
  }

  const now = new Date().toISOString();
  const productName = summarizeProducts(input.lineItems);
  const lineItemsJson = JSON.stringify(input.lineItems);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const orderNumber = createOrderNumber();
    const id = crypto.randomUUID();
    const insert = db
      .prepare(
        `INSERT INTO orders (
          id, owner_id, order_number, customer_name, destination, product_name,
          amount_cents, currency, fulfillment_mode, status, progress,
          customer_email, phone, postal_code, shipping_address, line_items_json,
          delivery_method, shipping_cents, payment_status, source, idempotency_key,
          marketing_opt_in, created_at, updated_at, request_fingerprint, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?, 'payment_pending', 5, ?, ?, ?, ?, ?, ?, ?, 'pending', 'storefront', ?, ?, ?, ?, ?, 0)
        ON CONFLICT DO NOTHING`
      )
      .bind(
        id,
        input.ownerId,
        orderNumber,
        input.customerName,
        input.destination,
        productName,
        input.amountCents,
        input.fulfillmentMode,
        input.customerEmail,
        input.phone,
        input.postalCode,
        input.shippingAddress,
        lineItemsJson,
        input.deliveryMethod,
        input.shippingCents,
        input.idempotencyKey,
        input.marketingOptIn ? 1 : 0,
        now,
        now,
        input.requestFingerprint
      );
    const results = await db.batch([insert, db.prepare(`INSERT INTO order_events
      (id, owner_id, order_id, event_type, from_status, to_status, actor_id, order_version, created_at)
      SELECT ?, owner_id, id, 'draft_created', NULL, status, 'guest-checkout', version, ?
      FROM orders WHERE id = ? AND owner_id = ? AND changes() > 0`)
      .bind(crypto.randomUUID(), now, id, input.ownerId)]);

    if ((results[0].meta.changes ?? 0) > 0) {
      return {
        orderNumber,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        destination: input.destination,
        productName,
        amountCents: input.amountCents,
        currency: "USD",
        deliveryMethod: input.deliveryMethod,
        fulfillmentMode: input.fulfillmentMode,
        routeModes: uniqueRoutes(input.lineItems),
        paymentStatus: "pending",
        status: "payment_pending",
        progress: 5,
        createdAt: now,
        updatedAt: now,
        inventoryReserved: false,
      };
    }

    const concurrent = await findByIdempotency(input.ownerId, input.idempotencyKey);
    if (concurrent) {
      assertMatchingFingerprint(concurrent.requestFingerprint, input.requestFingerprint);
      return toReceipt(concurrent);
    }
  }

  throw new Error("order_number_generation_failed");
}

export async function trackStorefrontOrder(
  ownerId: string,
  orderNumber: string,
  email: string
): Promise<StorefrontOrderReceipt | null> {
  const row = await getD1()
    .prepare(
      `SELECT
        order_number AS orderNumber,
        customer_name AS customerName,
        customer_email AS customerEmail,
        destination,
        product_name AS productName,
        amount_cents AS amountCents,
        currency,
        delivery_method AS deliveryMethod,
        fulfillment_mode AS fulfillmentMode,
        payment_status AS paymentStatus,
        status,
        progress,
        line_items_json AS lineItemsJson,
        request_fingerprint AS requestFingerprint,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM orders
      WHERE owner_id = ? AND order_number = ? AND lower(customer_email) = lower(?)
      LIMIT 1`
    )
    .bind(ownerId, orderNumber, email)
    .first<StorefrontOrderRow>();

  return row ? toReceipt(row) : null;
}

export async function findStorefrontOrderByIdempotency(ownerId: string, idempotencyKey: string, requestFingerprint: string) {
  const row = await findByIdempotency(ownerId, idempotencyKey);
  if (!row) return null;
  assertMatchingFingerprint(row.requestFingerprint, requestFingerprint);
  return toReceipt(row);
}

async function findByIdempotency(ownerId: string, idempotencyKey: string) {
  return getD1()
    .prepare(
      `SELECT
        order_number AS orderNumber,
        customer_name AS customerName,
        customer_email AS customerEmail,
        destination,
        product_name AS productName,
        amount_cents AS amountCents,
        currency,
        delivery_method AS deliveryMethod,
        fulfillment_mode AS fulfillmentMode,
        payment_status AS paymentStatus,
        status,
        progress,
        line_items_json AS lineItemsJson,
        request_fingerprint AS requestFingerprint,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM orders
      WHERE owner_id = ? AND idempotency_key = ?
      LIMIT 1`
    )
    .bind(ownerId, idempotencyKey)
    .first<StorefrontOrderRow>();
}

function toReceipt(row: StorefrontOrderRow): StorefrontOrderReceipt {
  const lineItems = parseLineItems(row.lineItemsJson);
  return {
    orderNumber: row.orderNumber, customerName: row.customerName, destination: row.destination,
    productName: row.productName, amountCents: row.amountCents, currency: row.currency,
    fulfillmentMode: row.fulfillmentMode, paymentStatus: row.paymentStatus, status: row.status,
    progress: row.progress, createdAt: row.createdAt, updatedAt: row.updatedAt,
    customerEmail: row.customerEmail ?? "",
    deliveryMethod: row.deliveryMethod ?? "standard",
    routeModes: lineItems.length ? uniqueRoutes(lineItems) : [row.fulfillmentMode],
    inventoryReserved: false,
  };
}

function parseLineItems(value: string | null): PersistedLineItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item: unknown): item is PersistedLineItem => {
      if (!item || typeof item !== "object") return false;
      const line = item as Record<string, unknown>;
      return typeof line.sku === "string" && typeof line.name === "string"
        && typeof line.quantity === "number" && Number.isSafeInteger(line.quantity) && line.quantity > 0
        && isValidPriceCents(line.priceCents) && typeof line.fulfillmentMode === "string"
        && (commerceFulfillmentModes as readonly string[]).includes(line.fulfillmentMode);
    }) : [];
  } catch {
    return [];
  }
}

function uniqueRoutes(items: PersistedLineItem[]) {
  return Array.from(new Set(items.map((item) => item.fulfillmentMode)));
}

function summarizeProducts(items: PersistedLineItem[]) {
  if (items.length === 1) {
    return items[0].quantity > 1 ? `${items[0].name} × ${items[0].quantity}` : items[0].name;
  }
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  return `${items[0].name} + ${totalUnits - items[0].quantity} more`;
}

function createOrderNumber() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  // Eight digits keep existing tracking contracts while reducing collisions as order volume grows.
  return `MW-${String(10000000 + (bytes[0] % 90000000))}`;
}
