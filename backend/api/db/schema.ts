import { index, integer, sqliteTable, text, uniqueIndex, primaryKey, foreignKey, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

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
    reviewStatus: text("review_status").notNull().default("unreviewed"),
    reviewNote: text("review_note"),
  },
  (table) => [
    uniqueIndex("idx_orders_owner_number").on(table.ownerId, table.orderNumber),
    uniqueIndex("idx_orders_owner_idempotency").on(table.ownerId, table.idempotencyKey),
    index("idx_orders_owner_status").on(table.ownerId, table.status),
    index("idx_orders_owner_review_created").on(table.ownerId, table.reviewStatus, table.createdAt),
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
    productGroupId: text("product_group_id"),
    variantAttributesJson: text("variant_attributes_json"),
    variantSignature: text("variant_signature"),
    version: integer("version").notNull().default(0),
    stock: integer("stock").notNull().default(0),
    shippingWeightGrams: integer("shipping_weight_grams").notNull().default(500),
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
    index("idx_products_owner_group").on(table.ownerId, table.productGroupId),
    uniqueIndex("idx_products_group_variant").on(table.ownerId, sql`coalesce(${table.productGroupId}, ${table.id})`, table.variantSignature),
    foreignKey({ columns: [table.productGroupId], foreignColumns: [table.id] }),
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

export const orderReservations = sqliteTable("order_reservations", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), orderId: text("order_id").notNull().references(() => orders.id),
  productId: text("product_id").notNull().references(() => products.id), sku: text("sku").notNull(),
  quantity: integer("quantity").notNull(), remaining: integer("remaining").notNull(), shipped: integer("shipped").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_order_reservations_owner_order_sku").on(table.ownerId, table.orderId, table.sku)]);

export const shipments = sqliteTable("shipments", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), orderId: text("order_id").notNull().references(() => orders.id),
  fulfillmentMode: text("fulfillment_mode").notNull(), carrierCode: text("carrier_code").notNull(),
  trackingNumber: text("tracking_number").notNull(), trackingUrl: text("tracking_url"), linesJson: text("lines_json").notNull(),
  status: text("status").notNull(), note: text("note"), version: integer("version").notNull().default(0),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_shipments_owner_carrier_number").on(table.ownerId, table.carrierCode, table.trackingNumber), index("idx_shipments_owner_order").on(table.ownerId, table.orderId)]);

export const afterSales = sqliteTable("after_sales", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), orderId: text("order_id").notNull().references(() => orders.id),
  kind: text("kind").notNull(), reason: text("reason").notNull(), linesJson: text("lines_json").notNull(), amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull(), restocked: integer("restocked", { mode: "boolean" }).notNull().default(false), note: text("note"),
  version: integer("version").notNull().default(0), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_after_sales_owner_order").on(table.ownerId, table.orderId)]);

export const adminOrderAudit = sqliteTable("admin_order_audit", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), orderId: text("order_id").notNull().references(() => orders.id),
  action: text("action").notNull(), note: text("note"), detailsJson: text("details_json"), actorId: text("actor_id").notNull(), createdAt: text("created_at").notNull(),
}, (table) => [index("idx_admin_order_audit_owner_order").on(table.ownerId, table.orderId, table.createdAt)]);

export const adminOperationGuards = sqliteTable("admin_operation_guards", { id: text("id").primaryKey(), allowed: integer("allowed").notNull() });

export const shippingCarriers = sqliteTable("shipping_carriers", {
  ownerId: text("owner_id").notNull(), code: text("code").notNull(), name: text("name").notNull(), trackingUrlTemplate: text("tracking_url_template").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(), version: integer("version").notNull().default(0), updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.ownerId, table.code] })]);

export const shippingRules = sqliteTable("shipping_rules", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), name: text("name").notNull(), method: text("method").notNull(), countriesJson: text("countries_json").notNull(),
  baseCents: integer("base_cents").notNull(), includedWeightGrams: integer("included_weight_grams").notNull(), stepWeightGrams: integer("step_weight_grams").notNull(), stepCents: integer("step_cents").notNull(),
  freeAboveCents: integer("free_above_cents"), minDays: integer("min_days").notNull(), maxDays: integer("max_days").notNull(), carrierCode: text("carrier_code"),
  enabled: integer("enabled", { mode: "boolean" }).notNull(), version: integer("version").notNull().default(0), updatedAt: text("updated_at").notNull(), mutationId: text("mutation_id").notNull(),
}, (table) => [index("idx_shipping_rules_owner").on(table.ownerId), foreignKey({ columns: [table.ownerId, table.carrierCode], foreignColumns: [shippingCarriers.ownerId, shippingCarriers.code] })]);

export const shippingRuleCountries = sqliteTable("shipping_rule_countries", {
  ruleId: text("rule_id").notNull().references(() => shippingRules.id, { onDelete: "cascade" }), ownerId: text("owner_id").notNull(), method: text("method").notNull(), country: text("country").notNull(), enabled: integer("enabled", { mode: "boolean" }).notNull(),
}, (table) => [primaryKey({ columns: [table.ruleId, table.country] }), uniqueIndex("idx_shipping_active_route").on(table.ownerId, table.method, table.country).where(sql`${table.enabled} = 1`)]);

export const shippingEvents = sqliteTable("shipping_events", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), entity: text("entity").notNull(), entityId: text("entity_id").notNull(), action: text("action").notNull(), detailsJson: text("details_json").notNull(), actorId: text("actor_id").notNull(), createdAt: text("created_at").notNull(),
}, (table) => [index("idx_shipping_events_owner").on(table.ownerId, table.createdAt)]);

export const logisticsLabelDrafts = sqliteTable("logistics_label_drafts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  orderId: text("order_id").notNull().references(() => orders.id),
  fulfillmentMode: text("fulfillment_mode").notNull(),
  carrierCode: text("carrier_code").notNull(),
  linesJson: text("lines_json").notNull(),
  inputJson: text("input_json").notNull(),
  fingerprint: text("fingerprint").notNull(),
  status: text("status").notNull(),
  providerShipmentId: text("provider_shipment_id"),
  providerTransactionId: text("provider_transaction_id"),
  ratesJson: text("rates_json").notNull().default("[]"),
  selectedRateId: text("selected_rate_id"),
  amountCents: integer("amount_cents"),
  currency: text("currency"),
  trackingNumber: text("tracking_number"),
  trackingCarrier: text("tracking_carrier"),
  labelUrl: text("label_url"),
  test: integer("test").notNull().default(1),
  shipmentId: text("shipment_id").references(() => shipments.id),
  errorCode: text("error_code"),
  version: integer("version").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  nextAttemptAt: text("next_attempt_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_logistics_labels_owner_fingerprint").on(table.ownerId, table.orderId, table.fingerprint),
  uniqueIndex("idx_logistics_labels_owner_transaction").on(table.ownerId, table.providerTransactionId).where(sql`${table.providerTransactionId} IS NOT NULL`),
  uniqueIndex("idx_logistics_labels_owner_shipment").on(table.ownerId, table.shipmentId).where(sql`${table.shipmentId} IS NOT NULL`),
  index("idx_logistics_labels_owner_order").on(table.ownerId, table.orderId, table.createdAt),
  index("idx_logistics_labels_poll").on(table.ownerId, table.status, table.nextAttemptAt),
  check("logistics_label_fulfillment", sql`${table.fulfillmentMode} IN ('marketplace','self','supplier')`),
  check("logistics_label_lines_json", sql`json_valid(${table.linesJson})`),
  check("logistics_label_input_json", sql`json_valid(${table.inputJson})`),
  check("logistics_label_rates_json", sql`json_valid(${table.ratesJson})`),
  check("logistics_label_status", sql`${table.status} IN ('quoting','quoted','purchasing','pending','ready','error','unknown')`),
  check("logistics_label_amount", sql`${table.amountCents} IS NULL OR ${table.amountCents} >= 0`),
  check("logistics_label_test", sql`${table.test} IN (0,1)`),
]);

export const logisticsTrackingJobs = sqliteTable("logistics_tracking_jobs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  shipmentId: text("shipment_id").notNull().references(() => shipments.id),
  trackingNumber: text("tracking_number").notNull(),
  trackingCarrier: text("tracking_carrier").notNull(),
  providerStatus: text("provider_status"),
  providerStatusDate: text("provider_status_date"),
  lastCheckedAt: text("last_checked_at"),
  nextAttemptAt: text("next_attempt_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  errorCode: text("error_code"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_logistics_tracking_owner_shipment").on(table.ownerId, table.shipmentId),
  index("idx_logistics_tracking_poll").on(table.ownerId, table.nextAttemptAt),
]);
