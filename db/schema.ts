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
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_orders_owner_number").on(table.ownerId, table.orderNumber),
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
    stock: integer("stock").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    inbound: integer("inbound").notNull().default(0),
    defaultFulfillment: text("default_fulfillment").notNull(),
    status: text("status").notNull().default("active"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_products_owner_sku").on(table.ownerId, table.sku),
    index("idx_products_owner_status").on(table.ownerId, table.status),
  ]
);
