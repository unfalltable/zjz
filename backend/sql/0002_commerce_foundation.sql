CREATE TABLE `catalog_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`product_id` text NOT NULL,
	`action` text NOT NULL,
	`details_json` text,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_events_owner_product` ON `catalog_events` (`owner_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `inventory_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`resulting_stock` integer NOT NULL,
	`note` text,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_events_owner_product` ON `inventory_events` (`owner_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`order_id` text NOT NULL,
	`event_type` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor_id` text NOT NULL,
	`order_version` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_order_events_owner_order` ON `order_events` (`owner_id`,`order_id`);--> statement-breakpoint
ALTER TABLE `orders` ADD `request_fingerprint` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `storefront_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `price_cents` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `compare_at_cents` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `category` text;--> statement-breakpoint
ALTER TABLE `products` ADD `image` text;--> statement-breakpoint
ALTER TABLE `products` ADD `metadata_json` text;--> statement-breakpoint
ALTER TABLE `products` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_owner_storefront` ON `products` (`owner_id`,`storefront_id`);