ALTER TABLE orders ADD review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(review_status IN ('unreviewed','confirmed','cancelled'));
--> statement-breakpoint
ALTER TABLE orders ADD review_note TEXT;
--> statement-breakpoint
CREATE INDEX idx_orders_owner_review_created ON orders(owner_id,review_status,created_at);
--> statement-breakpoint
CREATE TABLE order_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  remaining INTEGER NOT NULL CHECK(remaining >= 0 AND remaining <= quantity),
  shipped INTEGER NOT NULL DEFAULT 0 CHECK(shipped >= 0 AND shipped <= quantity),
  created_at TEXT NOT NULL,
  CHECK(remaining + shipped <= quantity)
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_order_reservations_owner_order_sku ON order_reservations(owner_id,order_id,sku);
--> statement-breakpoint
CREATE TABLE shipments (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  fulfillment_mode TEXT NOT NULL CHECK(fulfillment_mode IN ('marketplace','self','supplier')),
  carrier_code TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  tracking_url TEXT,
  lines_json TEXT NOT NULL CHECK(json_valid(lines_json)),
  status TEXT NOT NULL CHECK(status IN ('shipped','transit','delivered')),
  note TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_shipments_owner_carrier_number ON shipments(owner_id,carrier_code,tracking_number);
--> statement-breakpoint
CREATE INDEX idx_shipments_owner_order ON shipments(owner_id,order_id);
--> statement-breakpoint
CREATE TABLE after_sales (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL CHECK(kind IN ('return','refund')),
  reason TEXT NOT NULL,
  lines_json TEXT NOT NULL CHECK(json_valid(lines_json)),
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  status TEXT NOT NULL CHECK(status IN ('requested','approved','rejected','received','refund_pending','closed')),
  restocked INTEGER NOT NULL DEFAULT 0 CHECK(restocked IN (0,1)),
  note TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_after_sales_owner_order ON after_sales(owner_id,order_id);
--> statement-breakpoint
CREATE TABLE admin_order_audit (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  action TEXT NOT NULL,
  note TEXT,
  details_json TEXT,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_admin_order_audit_owner_order ON admin_order_audit(owner_id,order_id,created_at);
--> statement-breakpoint
-- A short-lived row forces an atomic batch to fail if any concurrency/business guard is false.
-- It is deleted within the same successful transaction; CHECK failure rolls all statements back.
CREATE TABLE admin_operation_guards (
  id TEXT PRIMARY KEY NOT NULL,
  allowed INTEGER NOT NULL CHECK(allowed = 1)
);
