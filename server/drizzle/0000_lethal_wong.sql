CREATE TABLE `admin_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_user_id` integer,
	`message` text NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`from_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `admin_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_settings_email_unique` ON `admin_settings` (`email`);--> statement-breakpoint
CREATE TABLE `instructor_students` (
	`instructor_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`assigned_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`instructor_id`, `student_id`),
	FOREIGN KEY (`instructor_id`) REFERENCES `instructors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `instructors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `monthly_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instructor_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`month` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`subject` text,
	`body` text,
	`sent_at` integer,
	`feedback_token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`instructor_id`) REFERENCES `instructors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_reviews_instructor_id_student_id_month_unique` ON `monthly_reviews` (`instructor_id`,`student_id`,`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_reviews_feedback_token_unique` ON `monthly_reviews` (`feedback_token`);--> statement-breakpoint
CREATE TABLE `pike13_admin_token` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pike13_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instructor_id` integer NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`instructor_id`) REFERENCES `instructors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pike13_tokens_instructor_id_unique` ON `pike13_tokens` (`instructor_id`);--> statement-breakpoint
CREATE TABLE `review_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instructor_id` integer NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`instructor_id`) REFERENCES `instructors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `service_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`review_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`comment` text,
	`suggestion` text,
	`submitted_at` integer NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `monthly_reviews`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`sid` text PRIMARY KEY NOT NULL,
	`sess` text NOT NULL,
	`expire` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `student_attendance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`instructor_id` integer NOT NULL,
	`attended_at` integer NOT NULL,
	`event_occurrence_id` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instructor_id`) REFERENCES `instructors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `student_attendance_student_id_instructor_id_event_occurrence_id_unique` ON `student_attendance` (`student_id`,`instructor_id`,`event_occurrence_id`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`guardian_email` text,
	`guardian_name` text,
	`github_username` text,
	`pike13_sync_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_pike13_sync_id_unique` ON `students` (`pike13_sync_id`);--> statement-breakpoint
CREATE TABLE `ta_checkins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instructor_id` integer NOT NULL,
	`ta_name` text NOT NULL,
	`week_of` text NOT NULL,
	`was_present` integer NOT NULL,
	`submitted_at` integer NOT NULL,
	FOREIGN KEY (`instructor_id`) REFERENCES `instructors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ta_checkins_instructor_id_ta_name_week_of_unique` ON `ta_checkins` (`instructor_id`,`ta_name`,`week_of`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`google_id` text,
	`password_hash` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `volunteer_event_schedule` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_occurrence_id` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`instructors` text NOT NULL,
	`volunteers` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `volunteer_event_schedule_event_occurrence_id_unique` ON `volunteer_event_schedule` (`event_occurrence_id`);--> statement-breakpoint
CREATE TABLE `volunteer_hours` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`volunteer_name` text NOT NULL,
	`category` text NOT NULL,
	`hours` real NOT NULL,
	`description` text,
	`external_id` text,
	`recorded_at` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `volunteer_hours_source_external_id_unique` ON `volunteer_hours` (`source`,`external_id`);--> statement-breakpoint
CREATE TABLE `volunteer_schedule` (
	`volunteer_name` text PRIMARY KEY NOT NULL,
	`is_scheduled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
