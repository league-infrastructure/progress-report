import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  unique,
} from 'drizzle-orm/sqlite-core';

// ---------- Enums ----------

export type ReviewStatus = 'pending' | 'draft' | 'sent';

// ---------- Tables ----------

export const users = sqliteTable('users', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  googleId: text('google_id'),
  passwordHash: text('password_hash'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// better-sqlite3-session-store requires sid/sess/expire columns
export const sessions = sqliteTable('sessions', {
  sid: text('sid').primaryKey(),
  sess: text('sess', { mode: 'json' }).notNull(),
  expire: integer('expire', { mode: 'timestamp' }).notNull(),
});

export const instructors = sqliteTable('instructors', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const students = sqliteTable(
  'students',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    guardianEmail: text('guardian_email'),
    guardianName: text('guardian_name'),
    githubUsername: text('github_username'),
    pike13SyncId: text('pike13_sync_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [unique().on(t.pike13SyncId)],
);

export const instructorStudents = sqliteTable(
  'instructor_students',
  {
    instructorId: integer('instructor_id')
      .notNull()
      .references(() => instructors.id),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    assignedAt: integer('assigned_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.instructorId, t.studentId] })],
);

export const monthlyReviews = sqliteTable(
  'monthly_reviews',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    instructorId: integer('instructor_id')
      .notNull()
      .references(() => instructors.id),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    month: text('month').notNull(), // YYYY-MM
    status: text('status').notNull().default('pending'),
    subject: text('subject'),
    body: text('body'),
    sentAt: integer('sent_at', { mode: 'timestamp' }),
    feedbackToken: text('feedback_token').notNull().$defaultFn(() => crypto.randomUUID()),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    unique().on(t.instructorId, t.studentId, t.month),
    unique().on(t.feedbackToken),
  ],
);

export const reviewTemplates = sqliteTable('review_templates', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  instructorId: integer('instructor_id')
    .notNull()
    .references(() => instructors.id),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const serviceFeedback = sqliteTable('service_feedback', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  reviewId: integer('review_id')
    .notNull()
    .references(() => monthlyReviews.id),
  rating: integer('rating').notNull(), // 1–5
  comment: text('comment'),
  suggestion: text('suggestion'), // selected service improvement suggestion
  submittedAt: integer('submitted_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const adminSettings = sqliteTable('admin_settings', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const pike13Tokens = sqliteTable('pike13_tokens', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  instructorId: integer('instructor_id')
    .notNull()
    .references(() => instructors.id),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => [unique().on(t.instructorId)]);

export const taCheckins = sqliteTable(
  'ta_checkins',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    instructorId: integer('instructor_id')
      .notNull()
      .references(() => instructors.id),
    taName: text('ta_name').notNull(),
    weekOf: text('week_of').notNull(), // ISO date of Monday, e.g. "2026-03-02"
    wasPresent: integer('was_present', { mode: 'boolean' }).notNull(),
    submittedAt: integer('submitted_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [unique().on(t.instructorId, t.taName, t.weekOf)],
);

export const adminNotifications = sqliteTable('admin_notifications', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  fromUserId: integer('from_user_id')
    .references(() => users.id),
  message: text('message').notNull(),
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const volunteerHours = sqliteTable(
  'volunteer_hours',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    volunteerName: text('volunteer_name').notNull(),
    category: text('category').notNull(),
    hours: real('hours').notNull(),
    description: text('description'),
    externalId: text('external_id'),
    recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    source: text('source').notNull().default('manual'),
  },
  (t) => [unique().on(t.source, t.externalId)],
);

export const studentAttendance = sqliteTable(
  'student_attendance',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    studentId: integer('student_id').notNull().references(() => students.id),
    instructorId: integer('instructor_id').notNull().references(() => instructors.id),
    attendedAt: integer('attended_at', { mode: 'timestamp' }).notNull(),
    eventOccurrenceId: text('event_occurrence_id').notNull(),
  },
  (t) => [unique().on(t.studentId, t.instructorId, t.eventOccurrenceId)],
);

export const volunteerSchedule = sqliteTable('volunteer_schedule', {
  volunteerName: text('volunteer_name').primaryKey(),
  isScheduled: integer('is_scheduled', { mode: 'boolean' }).notNull().default(false),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const volunteerEventSchedule = sqliteTable('volunteer_event_schedule', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  eventOccurrenceId: text('event_occurrence_id').notNull().unique(),
  startAt: integer('start_at', { mode: 'timestamp' }).notNull(),
  endAt: integer('end_at', { mode: 'timestamp' }).notNull(),
  instructors: text('instructors', { mode: 'json' }).notNull().$type<Array<{ pike13Id: number; name: string; instructorId: number | null; studentCount: number }>>(),
  volunteers: text('volunteers', { mode: 'json' }).notNull().$type<Array<{ pike13Id: number; name: string }>>(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const pike13AdminToken = sqliteTable('pike13_admin_token', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ---------- Exported types ----------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Instructor = typeof instructors.$inferSelect;
export type NewInstructor = typeof instructors.$inferInsert;
export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
export type MonthlyReview = typeof monthlyReviews.$inferSelect;
export type NewMonthlyReview = typeof monthlyReviews.$inferInsert;
export type ReviewTemplate = typeof reviewTemplates.$inferSelect;
export type NewReviewTemplate = typeof reviewTemplates.$inferInsert;
export type ServiceFeedback = typeof serviceFeedback.$inferSelect;
export type NewServiceFeedback = typeof serviceFeedback.$inferInsert;
export type AdminSetting = typeof adminSettings.$inferSelect;
export type Pike13Token = typeof pike13Tokens.$inferSelect;
export type TaCheckin = typeof taCheckins.$inferSelect;
export type NewTaCheckin = typeof taCheckins.$inferInsert;
export type AdminNotification = typeof adminNotifications.$inferSelect;
export type NewAdminNotification = typeof adminNotifications.$inferInsert;
export type VolunteerHour = typeof volunteerHours.$inferSelect;
export type NewVolunteerHour = typeof volunteerHours.$inferInsert;
export type StudentAttendance = typeof studentAttendance.$inferSelect;
export type NewStudentAttendance = typeof studentAttendance.$inferInsert;
export type VolunteerSchedule = typeof volunteerSchedule.$inferSelect;
export type VolunteerEventSchedule = typeof volunteerEventSchedule.$inferSelect;
export type Pike13AdminToken = typeof pike13AdminToken.$inferSelect;
export type NewPike13AdminToken = typeof pike13AdminToken.$inferInsert;
