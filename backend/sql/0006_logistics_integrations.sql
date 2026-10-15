CREATE TABLE logistics_label_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  fulfillment_mode TEXT NOT NULL CHECK(fulfillment_mode IN ('marketplace','self','supplier')),
  carrier_code TEXT NOT NULL,
  lines_json TEXT NOT NULL CHECK(json_valid(lines_json)),
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('quoting','quoted','purchasing','pending','ready','error','unknown')),
  provider_shipment_id TEXT,
  provider_transaction_id TEXT,
  rates_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(rates_json)),
  selected_rate_id TEXT,
  amount_cents INTEGER CHECK(amount_cents IS NULL OR amount_cents >= 0),
  currency TEXT,
  tracking_number TEXT,
  tracking_carrier TEXT,
  label_url TEXT,
  test INTEGER NOT NULL DEFAULT 1 CHECK(test IN (0,1)),
  shipment_id TEXT REFERENCES shipments(id),
  error_code TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_logistics_labels_owner_fingerprint ON logistics_label_drafts(owner_id,order_id,fingerprint);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_logistics_labels_owner_transaction ON logistics_label_drafts(owner_id,provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_logistics_labels_owner_shipment ON logistics_label_drafts(owner_id,shipment_id) WHERE shipment_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_logistics_labels_owner_order ON logistics_label_drafts(owner_id,order_id,created_at);
--> statement-breakpoint
CREATE INDEX idx_logistics_labels_poll ON logistics_label_drafts(owner_id,status,next_attempt_at);
--> statement-breakpoint
CREATE TABLE logistics_tracking_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  tracking_number TEXT NOT NULL,
  tracking_carrier TEXT NOT NULL,
  provider_status TEXT,
  provider_status_date TEXT,
  last_checked_at TEXT,
  next_attempt_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_logistics_tracking_owner_shipment ON logistics_tracking_jobs(owner_id,shipment_id);
--> statement-breakpoint
CREATE INDEX idx_logistics_tracking_poll ON logistics_tracking_jobs(owner_id,next_attempt_at);
