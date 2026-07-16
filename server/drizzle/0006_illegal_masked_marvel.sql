CREATE TABLE `review_takeovers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`month` text NOT NULL,
	`from_instructor_id` integer NOT NULL,
	`by_instructor_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_instructor_id`) REFERENCES `instructors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`by_instructor_id`) REFERENCES `instructors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_takeovers_student_id_month_from_instructor_id_unique` ON `review_takeovers` (`student_id`,`month`,`from_instructor_id`);