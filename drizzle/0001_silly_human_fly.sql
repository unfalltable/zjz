ALTER TABLE `orders` ADD `customer_email` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `postal_code` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_address` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `line_items_json` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_method` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `shipping_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_status` text DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `source` text DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `marketing_opt_in` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_owner_idempotency` ON `orders` (`owner_id`,`idempotency_key`);--> statement-breakpoint
PRAGMA optimize;
