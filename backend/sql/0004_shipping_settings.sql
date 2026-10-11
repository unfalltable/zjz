-- Carrier links are manually configured. No automatic carrier integration is implied.
CREATE TABLE shipping_carriers (
  owner_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  tracking_url_template TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, code)
);

CREATE TABLE shipping_rules (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('standard', 'express', 'priority')),
  countries_json TEXT NOT NULL CHECK (json_valid(countries_json)),
  base_cents INTEGER NOT NULL CHECK (base_cents BETWEEN 0 AND 100000000),
  included_weight_grams INTEGER NOT NULL CHECK (included_weight_grams BETWEEN 0 AND 1000000),
  step_weight_grams INTEGER NOT NULL CHECK (step_weight_grams BETWEEN 1 AND 1000000),
  step_cents INTEGER NOT NULL CHECK (step_cents BETWEEN 0 AND 100000000),
  free_above_cents INTEGER CHECK (free_above_cents BETWEEN 1 AND 100000000),
  min_days INTEGER NOT NULL CHECK (min_days BETWEEN 1 AND 365),
  max_days INTEGER NOT NULL CHECK (max_days BETWEEN min_days AND 365),
  carrier_code TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  FOREIGN KEY (owner_id, carrier_code) REFERENCES shipping_carriers(owner_id, code)
);
CREATE INDEX idx_shipping_rules_owner ON shipping_rules(owner_id);

-- The unique partial index closes races between concurrent rule updates. A country
-- can have at most one enabled rule per delivery method in a given store.
CREATE TABLE shipping_rule_countries (
  rule_id TEXT NOT NULL REFERENCES shipping_rules(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('standard', 'express', 'priority')),
  country TEXT NOT NULL CHECK (country IN ('US', 'CA', 'GB', 'DE', 'AU', 'FR')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  PRIMARY KEY (rule_id, country)
);
CREATE UNIQUE INDEX idx_shipping_active_route ON shipping_rule_countries(owner_id, method, country) WHERE enabled = 1;

CREATE TABLE shipping_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  entity TEXT NOT NULL CHECK (entity IN ('rule', 'carrier')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_shipping_events_owner ON shipping_events(owner_id, created_at);

-- Historical goods retain a conservative 500 g estimate until an operator edits it.
ALTER TABLE products ADD COLUMN shipping_weight_grams INTEGER NOT NULL DEFAULT 500 CHECK (shipping_weight_grams BETWEEN 1 AND 1000000);
