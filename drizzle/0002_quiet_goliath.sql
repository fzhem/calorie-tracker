ALTER TABLE `recipes` ADD `url` text;--> statement-breakpoint
ALTER TABLE `recipes` ADD `servings` real DEFAULT 1 NOT NULL;