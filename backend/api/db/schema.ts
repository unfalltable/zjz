import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    orderNumber: text("order_number").notNull(),
    customerName: text("customer_name").notNull(),
    destination: text("destination").notNull(),
    productName: text("product_name").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    fulfillmentMode: text("fulfillment_mode").notNull(),
    status: text("status").notNull(),
    progress: integer("progress").notNull().default(0),
    customerEmail: text("customer_email"),
    phone: text("phone"),
    postalCode: text("postal_code"),
    shippingAddress: text("shipping_address"),
    lineItemsJson: text("line_items_json"),
    deliveryMethod: text("delivery_method"),
    shippingCents: integer("shipping_cents").notNull().default(0),
    paymentStatus: text("payment_status").notNull().default("paid"),
    source: text("source").notNull().default("seed"),
    idempotencyKey: text("idempotency_key"),
    requestFingerprint: text("request_fingerprint"),
    version: integer("version").notNull().default(0),
    marketingOptIn: integer("marketing_opt_in", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_orders_owner_number").on(table.ownerId, table.orderNumber),
    uniqueIndex("idx_orders_owner_idempotency").on(table.ownerId, table.idempotencyKey),
    index("idx_orders_owner_status").on(table.ownerId, table.status),
  ]
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    storefrontId: text("storefront_id"),
    priceCents: integer("price_cents"),
    compareAtCents: integer("compare_at_cents"),
    category: text("category"),
    image: text("image"),
    metadataJson: text("metadata_json"),
    version: integer("version").notNull().default(0),
    stock: integer("stock").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    inbound: integer("inbound").notNull().default(0),
    defaultFulfillment: text("default_fulfillment").notNull(),
    status: text("status").notNull().default("active"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_products_owner_sku").on(table.ownerId, table.sku),
    uniqueIndex("idx_products_owner_storefront").on(table.ownerId, table.storefrontId),
    index("idx_products_owner_status").on(table.ownerId, table.status),
  ]
);

export const orderEvents = sqliteTable("order_events", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  orderId: text("order_id").notNull().references(() => orders.id),
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  actorId: text("actor_id").notNull(),
  orderVersion: integer("order_version").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_order_events_owner_order").on(table.ownerId, table.orderId)]);

export const inventoryEvents = sqliteTable("inventory_events", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  productId: text("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  resultingStock: integer("resulting_stock").notNull(),
  note: text("note"),
  actorId: text("actor_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_inventory_events_owner_product").on(table.ownerId, table.productId)]);

export const catalogEvents = sqliteTable("catalog_events", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  productId: text("product_id").notNull().references(() => products.id),
  action: text("action").notNull(),
  detailsJson: text("details_json"),
  actorId: text("actor_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_catalog_events_owner_product").on(table.ownerId, table.productId)]);
