CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`order_number` text NOT NULL,
	`customer_name` text NOT NULL,
	`destination` text NOT NULL,
	`product_name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`fulfillment_mode` text NOT NULL,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_orders_owner_number` ON `orders` (`owner_id`,`order_number`);--> statement-breakpoint
CREATE INDEX `idx_orders_owner_status` ON `orders` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`inbound` integer DEFAULT 0 NOT NULL,
	`default_fulfillment` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_owner_sku` ON `products` (`owner_id`,`sku`);--> statement-breakpoint
CREATE INDEX `idx_products_owner_status` ON `products` (`owner_id`,`status`);--> statement-breakpoint
PRAGMA optimize;
