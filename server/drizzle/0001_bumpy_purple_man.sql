CREATE TABLE `quiz_assignment_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quiz_id` integer NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_assignment_tokens_token_unique` ON `quiz_assignment_tokens` (`token`);--> statement-breakpoint
CREATE TABLE `quiz_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quiz_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`answers` text NOT NULL,
	`score` integer NOT NULL,
	`passed` integer NOT NULL,
	`submitted_at` integer NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quiz_lessons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level_id` integer NOT NULL,
	`name` text NOT NULL,
	`module` text NOT NULL,
	`path` text NOT NULL,
	`order` integer NOT NULL,
	FOREIGN KEY (`level_id`) REFERENCES `quiz_levels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_lessons_level_id_name_unique` ON `quiz_lessons` (`level_id`,`name`);--> statement-breakpoint
CREATE TABLE `quiz_levels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`order` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_levels_slug_unique` ON `quiz_levels` (`slug`);--> statement-breakpoint
CREATE TABLE `quiz_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` integer NOT NULL,
	`concept_id` text,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`question` text NOT NULL,
	`code` text,
	`options` text,
	`answer` text NOT NULL,
	`explanation` text NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `quiz_lessons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quiz_seen_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`question_id` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `quiz_questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_seen_questions_student_id_question_id_unique` ON `quiz_seen_questions` (`student_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`instructor_id` integer,
	`lesson_id` integer NOT NULL,
	`status` text DEFAULT 'assigned' NOT NULL,
	`bypass_reason` text,
	`question_ids` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instructor_id`) REFERENCES `instructors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_id`) REFERENCES `quiz_lessons`(`id`) ON UPDATE no action ON DELETE no action
);
