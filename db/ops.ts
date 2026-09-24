import { getD1 } from "@/db";
import type {
  FulfillmentMode,
  OpsOrder,
  OpsProduct,
  OpsSnapshot,
  OrderStatus,
} from "@/lib/ops-types";

const seedOrders: OpsOrder[] = [
  {
    orderNumber: "HW-24091",
    customerName: "Amara K.",
    destination: "Berlin, DE",
    productName: "Kumo Cloud Cat",
    amountCents: 8900,
    currency: "USD",
    fulfillmentMode: "marketplace",
    status: "purchase",
    progress: 22,
    createdAt: "2026-09-24T03:18:00.000Z",
    updatedAt: "2026-09-24T04:05:00.000Z",
  },
  {
    orderNumber: "HW-24088",
    customerName: "Lucas M.",
    destination: "Toronto, CA",
    productName: "Nova Orb",
    amountCents: 12900,
    currency: "USD",
    fulfillmentMode: "supplier",
    status: "packing",
    progress: 46,
    createdAt: "2026-09-24T01:42:00.000Z",
    updatedAt: "2026-09-24T03:49:00.000Z",
  },
  {
    orderNumber: "HW-24084",
    customerName: "Mei L.",
    destination: "Melbourne, AU",
    productName: "Loop Mini",
    amountCents: 6400,
    currency: "USD",
    fulfillmentMode: "self",
    status: "handoff",
    progress: 70,
    createdAt: "2026-09-23T22:17:00.000Z",
    updatedAt: "2026-09-24T02:55:00.000Z",
  },
  {
    orderNumber: "HW-24079",
    customerName: "Theo R.",
    destination: "Paris, FR",
    productName: "Kumo Cloud Cat × 2",
    amountCents: 17800,
    currency: "USD",
    fulfillmentMode: "marketplace",
    status: "transit",
    progress: 88,
    createdAt: "2026-09-23T17:03:00.000Z",
    updatedAt: "2026-09-24T02:12:00.000Z",
  },
];

const seedProducts: OpsProduct[] = [
  {
    sku: "KUMO-01",
    name: "Kumo Cloud Cat",
    stock: 42,
    reserved: 12,
    inbound: 80,
    defaultFulfillment: "marketplace",
    status: "active",
    updatedAt: "2026-09-24T04:05:00.000Z",
  },
  {
    sku: "NOVA-02",
    name: "Nova Orb",
    stock: 18,
    reserved: 6,
    inbound: 36,
    defaultFulfillment: "supplier",
    status: "active",
    updatedAt: "2026-09-24T03:49:00.000Z",
  },
  {
    sku: "LOOP-03",
    name: "Loop Mini",
    stock: 67,
    reserved: 9,
    inbound: 0,
    defaultFulfillment: "self",
    status: "active",
    updatedAt: "2026-09-24T02:55:00.000Z",
  },
];

export const demoSnapshot: OpsSnapshot = {
  orders: seedOrders,
  products: seedProducts,
};

const statusProgress: Record<OrderStatus, number> = {
  purchase: 22,
  packing: 46,
  handoff: 70,
  transit: 88,
  delivered: 100,
};

type OrderRow = {
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

type ProductRow = {
  sku: string;
  name: string;
  stock: number;
  reserved: number;
  inbound: number;
  defaultFulfillment: FulfillmentMode;
  status: "active" | "paused";
  updatedAt: string;
};

export async function getOpsSnapshot(ownerId: string): Promise<OpsSnapshot> {
  const db = getD1();
  await ensureWorkspace(ownerId);

  const [orderResult, productResult] = await Promise.all([
    db
      .prepare(
        `SELECT
          order_number AS orderNumber,
          customer_name AS customerName,
          destination,
          product_name AS productName,
          amount_cents AS amountCents,
          currency,
          fulfillment_mode AS fulfillmentMode,
          status,
          progress,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM orders
        WHERE owner_id = ?
        ORDER BY created_at DESC`
      )
      .bind(ownerId)
      .all<OrderRow>(),
    db
      .prepare(
        `SELECT
          sku,
          name,
          stock,
          reserved,
          inbound,
          default_fulfillment AS defaultFulfillment,
          status,
          updated_at AS updatedAt
        FROM products
        WHERE owner_id = ?
        ORDER BY name ASC`
      )
      .bind(ownerId)
      .all<ProductRow>(),
  ]);

  return {
    orders: orderResult.results,
    products: productResult.results,
  };
}

export async function setOrderStatus(
  ownerId: string,
  orderNumber: string,
  status: OrderStatus
) {
  const now = new Date().toISOString();
  const result = await getD1()
    .prepare(
      `UPDATE orders
       SET status = ?, progress = ?, updated_at = ?
       WHERE owner_id = ? AND order_number = ?`
    )
    .bind(status, statusProgress[status], now, ownerId, orderNumber)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

export async function addProductStock(ownerId: string, sku: string, quantity: number) {
  const now = new Date().toISOString();
  const result = await getD1()
    .prepare(
      `UPDATE products
       SET stock = stock + ?, updated_at = ?
       WHERE owner_id = ? AND sku = ?`
    )
    .bind(quantity, now, ownerId, sku)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function ensureWorkspace(ownerId: string) {
  const db = getD1();
  const [orderCount, productCount] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS count FROM orders WHERE owner_id = ?")
      .bind(ownerId)
      .first<{ count: number }>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM products WHERE owner_id = ?")
      .bind(ownerId)
      .first<{ count: number }>(),
  ]);

  const statements = [];

  if (!orderCount?.count) {
    for (const order of seedOrders) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO orders (
              id, owner_id, order_number, customer_name, destination, product_name,
              amount_cents, currency, fulfillment_mode, status, progress, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            `${ownerId}:${order.orderNumber}`,
            ownerId,
            order.orderNumber,
            order.customerName,
            order.destination,
            order.productName,
            order.amountCents,
            order.currency,
            order.fulfillmentMode,
            order.status,
            order.progress,
            order.createdAt,
            order.updatedAt
          )
      );
    }
  }

  if (!productCount?.count) {
    for (const product of seedProducts) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO products (
              id, owner_id, sku, name, stock, reserved, inbound,
              default_fulfillment, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            `${ownerId}:${product.sku}`,
            ownerId,
            product.sku,
            product.name,
            product.stock,
            product.reserved,
            product.inbound,
            product.defaultFulfillment,
            product.status,
            product.updatedAt
          )
      );
    }
  }

  if (statements.length) {
    await db.batch(statements);
  }
}
