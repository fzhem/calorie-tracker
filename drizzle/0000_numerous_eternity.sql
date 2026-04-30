CREATE TABLE `body_fat_history` (
	`id` text PRIMARY KEY NOT NULL,
	`recorded_at` text NOT NULL,
	`body_fat_percentage` real NOT NULL,
	`source` text DEFAULT 'health-connect' NOT NULL,
	`origin_app_id` text,
	`origin_app_name` text,
	`origin_device` text
);
--> statement-breakpoint
CREATE INDEX `idx_bodyfat_recorded_at` ON `body_fat_history` (`recorded_at`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`calories` integer NOT NULL,
	`protein_g` real,
	`fat_g` real,
	`carbs_g` real,
	`fibre_g` real,
	`logged_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_meals_logged_at` ON `meals` (`logged_at`);--> statement-breakpoint
CREATE TABLE `weight_history` (
	`id` text PRIMARY KEY NOT NULL,
	`recorded_at` text NOT NULL,
	`weight_kg` real NOT NULL,
	`source` text NOT NULL,
	`origin_app_id` text,
	`origin_app_name` text,
	`origin_device` text
);
--> statement-breakpoint
CREATE INDEX `idx_weight_recorded_at` ON `weight_history` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_weight_source` ON `weight_history` (`source`);