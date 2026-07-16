CREATE TABLE `instructor_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instructor_id` integer NOT NULL,
	`kind` text NOT NULL,
	`student_id` integer,
	`week_of` text,
	`message` text NOT NULL,
	`acknowledged` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`instructor_id`) REFERENCES `instructors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instructor_notifications_instructor_id_kind_student_id_week_of_unique` ON `instructor_notifications` (`instructor_id`,`kind`,`student_id`,`week_of`);