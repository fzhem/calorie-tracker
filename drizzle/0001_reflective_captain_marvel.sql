CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`items_json` text NOT NULL,
	`total_calories` integer NOT NULL,
	`total_protein_g` real,
	`total_fat_g` real,
	`total_carbs_g` real,
	`total_fibre_g` real,
	`created_at` text NOT NULL
);
