/**
 * DB schema round-trip tests.
 *
 * Uses an in-memory SQLite database (better-sqlite3) — no external
 * database or DATABASE_URL environment variable required.
 */
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../server/src/db/schema';
import { eq } from 'drizzle-orm';

let sqlite: InstanceType<typeof Database>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(() => {
  sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: path.resolve(__dirname, '../../server/drizzle'),
  });
});

afterAll(() => {
  sqlite.close();
});

describe('users', () => {
  it('inserts and retrieves a user', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'test@example.com', name: 'Test User' })
      .returning();
    expect(user.id).toBeDefined();
    expect(user.email).toBe('test@example.com');
    expect(user.name).toBe('Test User');
    expect(user.createdAt).toBeInstanceOf(Date);
  });
});

describe('sessions', () => {
  it('inserts and retrieves a session', async () => {
    const expire = new Date(Date.now() + 86400_000);
    await db.insert(schema.sessions).values({
      sid: 'test-sid-001',
      sess: { cookie: { expires: expire.toISOString() } },
      expire,
    });
    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.sid, 'test-sid-001'));
    expect(session.sid).toBe('test-sid-001');
    expect(session.expire).toBeInstanceOf(Date);
  });
});

describe('instructors', () => {
  it('inserts and retrieves an instructor linked to a user', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'instructor@example.com', name: 'Instructor User' })
      .returning();
    const [instructor] = await db
      .insert(schema.instructors)
      .values({ userId: user.id })
      .returning();
    expect(instructor.id).toBeDefined();
    expect(instructor.isActive).toBe(false);
    expect(instructor.userId).toBe(user.id);
  });
});

describe('students', () => {
  it('inserts and retrieves a student', async () => {
    const [student] = await db
      .insert(schema.students)
      .values({ name: 'Student One', guardianEmail: 'guardian@example.com' })
      .returning();
    expect(student.id).toBeDefined();
    expect(student.name).toBe('Student One');
  });
});

describe('instructor_students', () => {
  it('inserts and retrieves an assignment', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'instr2@example.com', name: 'Instr2' })
      .returning();
    const [instructor] = await db
      .insert(schema.instructors)
      .values({ userId: user.id })
      .returning();
    const [student] = await db
      .insert(schema.students)
      .values({ name: 'Student Two' })
      .returning();
    await db
      .insert(schema.instructorStudents)
      .values({ instructorId: instructor.id, studentId: student.id });
    const [row] = await db
      .select()
      .from(schema.instructorStudents)
      .where(eq(schema.instructorStudents.instructorId, instructor.id));
    expect(row.studentId).toBe(student.id);
  });
});

describe('monthly_reviews', () => {
  it('inserts with default pending status', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'instr3@example.com', name: 'Instr3' })
      .returning();
    const [instructor] = await db
      .insert(schema.instructors)
      .values({ userId: user.id })
      .returning();
    const [student] = await db
      .insert(schema.students)
      .values({ name: 'Student Three' })
      .returning();
    const [review] = await db
      .insert(schema.monthlyReviews)
      .values({ instructorId: instructor.id, studentId: student.id, month: '2025-01' })
      .returning();
    expect(review.status).toBe('pending');
    expect(review.month).toBe('2025-01');
  });
});

describe('review_templates', () => {
  it('inserts and retrieves a template', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'instr4@example.com', name: 'Instr4' })
      .returning();
    const [instructor] = await db
      .insert(schema.instructors)
      .values({ userId: user.id })
      .returning();
    const [tmpl] = await db
      .insert(schema.reviewTemplates)
      .values({ instructorId: instructor.id, name: 'Default', subject: 'Hi', body: 'Body' })
      .returning();
    expect(tmpl.name).toBe('Default');
  });
});

describe('service_feedback', () => {
  it('inserts and retrieves feedback', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'instr5@example.com', name: 'Instr5' })
      .returning();
    const [instructor] = await db
      .insert(schema.instructors)
      .values({ userId: user.id })
      .returning();
    const [student] = await db
      .insert(schema.students)
      .values({ name: 'Student Four' })
      .returning();
    const [review] = await db
      .insert(schema.monthlyReviews)
      .values({ instructorId: instructor.id, studentId: student.id, month: '2025-02' })
      .returning();
    const [fb] = await db
      .insert(schema.serviceFeedback)
      .values({ reviewId: review.id, rating: 5 })
      .returning();
    expect(fb.rating).toBe(5);
  });
});

describe('admin_settings', () => {
  it('inserts and retrieves an admin email', async () => {
    const [setting] = await db
      .insert(schema.adminSettings)
      .values({ email: 'admin@example.com' })
      .returning();
    expect(setting.email).toBe('admin@example.com');
  });
});

describe('pike13_tokens', () => {
  it('inserts and retrieves a token row', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'instr6@example.com', name: 'Instr6' })
      .returning();
    const [instructor] = await db
      .insert(schema.instructors)
      .values({ userId: user.id })
      .returning();
    const [token] = await db
      .insert(schema.pike13Tokens)
      .values({ instructorId: instructor.id, accessToken: 'tok-abc' })
      .returning();
    expect(token.accessToken).toBe('tok-abc');
    expect(token.instructorId).toBe(instructor.id);
  });
});

describe('ta_checkins', () => {
  it('inserts and retrieves a check-in record', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'instr7@example.com', name: 'Instr7' })
      .returning();
    const [instructor] = await db
      .insert(schema.instructors)
      .values({ userId: user.id })
      .returning();
    const [checkin] = await db
      .insert(schema.taCheckins)
      .values({ instructorId: instructor.id, taName: 'Alice TA', weekOf: '2026-03-02', wasPresent: true })
      .returning();
    expect(checkin.taName).toBe('Alice TA');
    expect(checkin.weekOf).toBe('2026-03-02');
    expect(checkin.wasPresent).toBe(true);
  });

  it('rejects duplicate (instructorId, taName, weekOf)', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'instr8@example.com', name: 'Instr8' })
      .returning();
    const [instructor] = await db
      .insert(schema.instructors)
      .values({ userId: user.id })
      .returning();
    await db.insert(schema.taCheckins).values({
      instructorId: instructor.id,
      taName: 'Bob TA',
      weekOf: '2026-03-02',
      wasPresent: true,
    });
    await expect(
      db.insert(schema.taCheckins).values({
        instructorId: instructor.id,
        taName: 'Bob TA',
        weekOf: '2026-03-02',
        wasPresent: false,
      }),
    ).rejects.toThrow();
  });
});

describe('admin_notifications', () => {
  it('inserts and retrieves a notification', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'instr9@example.com', name: 'Instr9' })
      .returning();
    const [notif] = await db
      .insert(schema.adminNotifications)
      .values({ fromUserId: user.id, message: 'Please create TA profile for Alice' })
      .returning();
    expect(notif.message).toBe('Please create TA profile for Alice');
    expect(notif.isRead).toBe(false);
    expect(notif.fromUserId).toBe(user.id);
  });
});

describe('volunteer_hours', () => {
  it('inserts and reads back a row with float hours', async () => {
    const [row] = await db
      .insert(schema.volunteerHours)
      .values({ volunteerName: 'Jane Smith', category: 'Teaching', hours: 1.5 })
      .returning();
    expect(row.volunteerName).toBe('Jane Smith');
    expect(row.category).toBe('Teaching');
    expect(row.hours).toBeCloseTo(1.5);
    expect(row.source).toBe('manual');
    expect(row.description).toBeNull();
  });

  it('preserves source value when explicitly set', async () => {
    const [row] = await db
      .insert(schema.volunteerHours)
      .values({ volunteerName: 'John Doe', category: 'Events', hours: 2.0, source: 'pike13' })
      .returning();
    expect(row.source).toBe('pike13');
  });
});

describe('monthly_reviews feedback_token', () => {
  it('assigns a non-null UUID feedback_token by default', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'instr11@example.com', name: 'Instr11' })
      .returning();
    const [instructor] = await db
      .insert(schema.instructors)
      .values({ userId: user.id })
      .returning();
    const [student] = await db
      .insert(schema.students)
      .values({ name: 'Student FBToken' })
      .returning();
    const [review] = await db
      .insert(schema.monthlyReviews)
      .values({ instructorId: instructor.id, studentId: student.id, month: '2026-01' })
      .returning();
    expect(review.feedbackToken).toBeDefined();
    expect(typeof review.feedbackToken).toBe('string');
    expect(review.feedbackToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('rejects duplicate feedback_token', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'instr12@example.com', name: 'Instr12' })
      .returning();
    const [instructor] = await db
      .insert(schema.instructors)
      .values({ userId: user.id })
      .returning();
    const [student1] = await db
      .insert(schema.students)
      .values({ name: 'Student FBDup1' })
      .returning();
    const [student2] = await db
      .insert(schema.students)
      .values({ name: 'Student FBDup2' })
      .returning();
    const token = '00000000-0000-0000-0000-000000000001';
    await db.insert(schema.monthlyReviews).values({
      instructorId: instructor.id,
      studentId: student1.id,
      month: '2026-02',
      feedbackToken: token,
    });
    await expect(
      db.insert(schema.monthlyReviews).values({
        instructorId: instructor.id,
        studentId: student2.id,
        month: '2026-03',
        feedbackToken: token,
      }),
    ).rejects.toThrow();
  });
});

describe('monthly_reviews unique constraint', () => {
  it('rejects duplicate (instructorId, studentId, month)', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'instr10@example.com', name: 'Instr10' })
      .returning();
    const [instructor] = await db
      .insert(schema.instructors)
      .values({ userId: user.id })
      .returning();
    const [student] = await db
      .insert(schema.students)
      .values({ name: 'Student Uniq' })
      .returning();
    await db.insert(schema.monthlyReviews).values({
      instructorId: instructor.id,
      studentId: student.id,
      month: '2026-03',
    });
    await expect(
      db.insert(schema.monthlyReviews).values({
        instructorId: instructor.id,
        studentId: student.id,
        month: '2026-03',
      }),
    ).rejects.toThrow();
  });
});
