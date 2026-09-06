CREATE TABLE `actors` (
	`id` text PRIMARY KEY NOT NULL,
	`cohort` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `actors_created` ON `actors` (`created`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`cohort` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_created` ON `events` (`created`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`visit` text NOT NULL,
	`cohort` text NOT NULL,
	`room` text NOT NULL,
	`alias` text NOT NULL,
	`text` text NOT NULL,
	`parent` text,
	`created` text NOT NULL,
	`idem` text NOT NULL,
	FOREIGN KEY (`actor`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_actor_idem` ON `messages` (`actor`,`idem`);--> statement-breakpoint
CREATE INDEX `messages_room_created` ON `messages` (`room`,`created`);--> statement-breakpoint
CREATE INDEX `messages_visit` ON `messages` (`visit`);--> statement-breakpoint
CREATE INDEX `messages_created` ON `messages` (`created`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`cohort` text NOT NULL,
	`alias` text NOT NULL,
	`room` text NOT NULL,
	`created` text NOT NULL,
	`expires` text NOT NULL,
	`left` text,
	`discovery` text NOT NULL,
	`directed` text NOT NULL,
	FOREIGN KEY (`actor`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `visits_actor_created` ON `visits` (`actor`,`created`);--> statement-breakpoint
CREATE INDEX `visits_room_expires` ON `visits` (`room`,`expires`);--> statement-breakpoint
CREATE INDEX `visits_created` ON `visits` (`created`);