ALTER TABLE `actors` ADD `origin` text DEFAULT 'participant' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `origin` text DEFAULT 'participant' NOT NULL;--> statement-breakpoint
ALTER TABLE `visits` ADD `origin` text DEFAULT 'participant' NOT NULL;