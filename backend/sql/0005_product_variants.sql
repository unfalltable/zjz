-- Existing products remain independent main SKUs. Orders and inventory are not rewritten.
ALTER TABLE products ADD product_group_id TEXT REFERENCES products(id);
--> statement-breakpoint
ALTER TABLE products ADD variant_attributes_json TEXT;
--> statement-breakpoint
ALTER TABLE products ADD variant_signature TEXT;
--> statement-breakpoint
CREATE INDEX idx_products_owner_group ON products(owner_id, product_group_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_products_group_variant ON products(owner_id, coalesce(product_group_id, id), variant_signature);
--> statement-breakpoint
-- A child cannot join another tenant, another child, or an unnamed dimension set.
CREATE TRIGGER product_variant_group_insert BEFORE INSERT ON products
WHEN NEW.product_group_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM products root WHERE root.id = NEW.product_group_id AND root.owner_id = NEW.owner_id
    AND root.product_group_id IS NULL AND root.variant_signature IS NOT NULL
) BEGIN SELECT RAISE(ABORT, 'invalid_variant_group'); END;
--> statement-breakpoint
CREATE TRIGGER product_variant_group_immutable BEFORE UPDATE OF product_group_id, owner_id ON products
WHEN NEW.product_group_id IS NOT OLD.product_group_id OR NEW.owner_id IS NOT OLD.owner_id
BEGIN SELECT RAISE(ABORT, 'variant_group_immutable'); END;
