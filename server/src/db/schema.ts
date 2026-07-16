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

// Records that one instructor took over a shared student's monthly review from
// another. Used to drop the taken-over instructor from the review page's
// shared-instructor note (deleting their review row alone is indistinguishable
// from "never wrote one").
export const reviewTakeovers = sqliteTable(
  'review_takeovers',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    studentId: integer('student_id').notNull().references(() => students.id),
    month: text('month').notNull(), // YYYY-MM
    fromInstructorId: integer('from_instructor_id').notNull().references(() => instructors.id),
    byInstructorId: integer('by_instructor_id').notNull().references(() => instructors.id),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [unique().on(t.studentId, t.month, t.fromInstructorId)],
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
  // Students registered (not cancelled) for this upcoming event, resolved to
  // local student ids where known. Lets us map a specific student to the
  // instructor scheduled with them this week (used by the quiz-completion sweep).
  students: text('students', { mode: 'json' }).$type<Array<{ pike13Id: number; name: string; studentId: number | null }>>(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const pike13AdminToken = sqliteTable('pike13_admin_token', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ---------- Quiz tables ----------

export const quizLevels = sqliteTable('quiz_levels', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  // GitHub repo name for this level (e.g. 'Python-Apprentice'); used to locate
  // the student's fork when gating quizzes on recipe completion.
  repo: text('repo'),
  order: integer('order').notNull(),
});

export const quizLessons = sqliteTable(
  'quiz_lessons',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    levelId: integer('level_id')
      .notNull()
      .references(() => quizLevels.id),
    name: text('name').notNull(),
    module: text('module').notNull(),
    path: text('path').notNull(),
    order: integer('order').notNull(),
  },
  (t) => [unique().on(t.levelId, t.name)],
);

export const quizQuestions = sqliteTable('quiz_questions', {
  id: text('id').primaryKey(), // stable bank id e.g. 'python-apprentice/10_Welcome/q01'
  lessonId: integer('lesson_id')
    .notNull()
    .references(() => quizLessons.id),
  conceptId: text('concept_id'),
  type: text('type').notNull(), // 'multiple_choice' | 'short_answer'
  category: text('category').notNull(),
  question: text('question').notNull(),
  code: text('code'),
  options: text('options', { mode: 'json' }).$type<string[]>(),
  answer: text('answer').notNull(),
  explanation: text('explanation').notNull(),
});

export const quizzes = sqliteTable('quizzes', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  studentId: integer('student_id')
    .notNull()
    .references(() => students.id),
  instructorId: integer('instructor_id')
    .references(() => instructors.id),
  lessonId: integer('lesson_id')
    .notNull()
    .references(() => quizLessons.id),
  status: text('status').notNull().default('assigned'), // 'assigned' | 'completed'
  bypassReason: text('bypass_reason'),
  questionIds: text('question_ids', { mode: 'json' }).notNull().$type<string[]>(),
  // Instructor's review note for the parent/guardian, and when it was last sent.
  // A completed quiz with a null parentNoteSentAt is "awaiting review".
  parentNote: text('parent_note'),
  parentNoteSentAt: integer('parent_note_sent_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const quizAttempts = sqliteTable('quiz_attempts', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  quizId: integer('quiz_id')
    .notNull()
    .references(() => quizzes.id),
  studentId: integer('student_id')
    .notNull()
    .references(() => students.id),
  answers: text('answers', { mode: 'json' }).notNull().$type<Record<string, string>>(),
  score: integer('score').notNull(),
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const quizSeenQuestions = sqliteTable(
  'quiz_seen_questions',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    questionId: text('question_id')
      .notNull()
      .references(() => quizQuestions.id),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [unique().on(t.studentId, t.questionId)],
);

export const quizAssignmentTokens = sqliteTable('quiz_assignment_tokens', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  quizId: integer('quiz_id')
    .notNull()
    .references(() => quizzes.id),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  consumedAt: integer('consumed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ---------- Staff training compliance (AB 506 etc.) ----------

// One profile per Pike13 staff member — instructors AND volunteers. Keyed on the
// Pike13 staff id so volunteers (who have no users/instructors record) are still
// trackable. Populated during Pike13 sync.
export const staffProfiles = sqliteTable('staff_profiles', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  pike13StaffId: integer('pike13_staff_id').notNull().unique(),
  name: text('name').notNull(),
  email: text('email'),
  kind: text('kind').notNull().default('volunteer'), // 'instructor' | 'volunteer'
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Catalog of required trainings (e.g. AB 506 Mandated Reporter).
export const trainingTypes = sqliteTable('training_types', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  order: integer('order').notNull().default(0),
});

// Per-staff, per-training compliance record.
export const staffTrainings = sqliteTable(
  'staff_trainings',
  {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    staffProfileId: integer('staff_profile_id')
      .notNull()
      .references(() => staffProfiles.id),
    trainingTypeId: integer('training_type_id')
      .notNull()
      .references(() => trainingTypes.id),
    met: integer('met', { mode: 'boolean' }).notNull().default(false),
    driveUrl: text('drive_url'),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    notes: text('notes'),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [unique().on(t.staffProfileId, t.trainingTypeId)],
);

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
export type StaffProfile = typeof staffProfiles.$inferSelect;
export type NewStaffProfile = typeof staffProfiles.$inferInsert;
export type TrainingType = typeof trainingTypes.$inferSelect;
export type NewTrainingType = typeof trainingTypes.$inferInsert;
export type StaffTraining = typeof staffTrainings.$inferSelect;
export type NewStaffTraining = typeof staffTrainings.$inferInsert;

// Quiz types
export type QuizRole = 'student' | 'instructor' | 'admin';
export type QuizStatus = 'assigned' | 'completed';
export type QuizQuestionType = 'multiple_choice' | 'short_answer';
export type QuizLevel = typeof quizLevels.$inferSelect;
export type NewQuizLevel = typeof quizLevels.$inferInsert;
export type QuizLesson = typeof quizLessons.$inferSelect;
export type NewQuizLesson = typeof quizLessons.$inferInsert;
export type QuizQuestion = typeof quizQuestions.$inferSelect;
export type NewQuizQuestion = typeof quizQuestions.$inferInsert;
export type Quiz = typeof quizzes.$inferSelect;
export type NewQuiz = typeof quizzes.$inferInsert;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type NewQuizAttempt = typeof quizAttempts.$inferInsert;
export type QuizSeenQuestion = typeof quizSeenQuestions.$inferSelect;
export type NewQuizSeenQuestion = typeof quizSeenQuestions.$inferInsert;
export type QuizAssignmentToken = typeof quizAssignmentTokens.$inferSelect;
export type NewQuizAssignmentToken = typeof quizAssignmentTokens.$inferInsert;
