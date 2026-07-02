CREATE TABLE `staff_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pike13_staff_id` integer NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`kind` text DEFAULT 'volunteer' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_profiles_pike13_staff_id_unique` ON `staff_profiles` (`pike13_staff_id`);--> statement-breakpoint
CREATE TABLE `staff_trainings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`staff_profile_id` integer NOT NULL,
	`training_type_id` integer NOT NULL,
	`met` integer DEFAULT false NOT NULL,
	`drive_url` text,
	`expires_at` integer,
	`notes` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`staff_profile_id`) REFERENCES `staff_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`training_type_id`) REFERENCES `training_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_trainings_staff_profile_id_training_type_id_unique` ON `staff_trainings` (`staff_profile_id`,`training_type_id`);--> statement-breakpoint
CREATE TABLE `training_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`active` integer DEFAULT true NOT NULL,
	`order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `training_types_name_unique` ON `training_types` (`name`);