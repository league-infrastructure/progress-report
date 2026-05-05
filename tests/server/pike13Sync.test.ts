/**
 * Pike13 sync service unit tests.
 *
 * Uses an in-memory SQLite database for full isolation — no external
 * database or DATABASE_URL environment variable required.
 * Fetch is mocked — no real Pike13 network calls are made.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { runSync, PIKE13_GITHUB_FIELD_KEY } from '../../server/src/services/pike13Sync';
import { createTestDb } from './helpers/db';

const { sqlite, db } = createTestDb();

let testUserId: number;
let testInstructorId: number;
const INSTRUCTOR_EMAIL = 'pike13sync-test@test.local';

beforeAll(async () => {
  // Create a test user + instructor used to verify assignment creation
  const [user] = await db
    .insert(schema.users)
    .values({ email: INSTRUCTOR_EMAIL, name: 'Test Sync Instructor' })
    .onConflictDoUpdate({ target: schema.users.email, set: { name: 'Test Sync Instructor' } })
    .returning({ id: schema.users.id });
  testUserId = user.id;

  const [instr] = await db
    .insert(schema.instructors)
    .values({ userId: testUserId, isActive: true })
    .returning({ id: schema.instructors.id });
  testInstructorId = instr.id;
});

afterAll(() => {
  sqlite.close();
});

afterEach(async () => {
  await db.delete(schema.studentAttendance);
  await db.delete(schema.volunteerHours);
  await db.delete(schema.instructorStudents);
  await db.delete(schema.students);
  await db.delete(schema.volunteerSchedule);
  await db.delete(schema.volunteerEventSchedule);
  // Remove any extra instructors/users created by the sync (keep the test instructor)
  const syncInstructors = await db
    .select({ id: schema.instructors.id })
    .from(schema.instructors)
    .where(eq(schema.instructors.id, testInstructorId));
  if (syncInstructors.length === 0) {
    // testInstructorId was deleted — should not happen, but reset if so
  }
  await db.delete(schema.pike13Tokens);
  // Delete any users/instructors added by the sync (those other than the test instructor's user)
  const syncedInstructors = await db
    .select({ id: schema.instructors.id, userId: schema.instructors.userId })
    .from(schema.instructors);
  for (const row of syncedInstructors) {
    if (row.id !== testInstructorId) {
      await db.delete(schema.instructors).where(eq(schema.instructors.id, row.id));
      await db.delete(schema.users).where(eq(schema.users.id, row.userId));
    }
  }
});

// ---- Mock fetch helper ----
//
// Routes Pike13 API requests based on URL path segment:
//   desk/staff_members  → { staff_members: data.staff_members }
//   desk/people         → { people: data.people }
//   desk/event_occurrences → { event_occurrences: data.event_occurrences }
//
// The service never calls the visits endpoint directly; visits data is embedded
// in event_occurrences as the `people` array on each occurrence.
function buildFetch(data: {
  staff_members?: object[];
  people?: object[];
  event_occurrences?: object[];
}): typeof fetch {
  return async (url: Parameters<typeof fetch>[0]) => {
    const s = String(url);
    let body: object;
    if (s.includes('/staff_members')) body = { staff_members: data.staff_members ?? [] };
    else if (s.includes('/people')) body = { people: data.people ?? [] };
    else if (s.includes('/event_occurrences')) body = { event_occurrences: data.event_occurrences ?? [] };
    else body = {};
    return { ok: true, json: async () => body } as Response;
  };
}

// ---- TA/VA filter ----

describe('TA/VA filter', () => {
  it('includes TA and VA people in student upserts (they can also be students)', async () => {
    const fetchFn = buildFetch({
      // TA/VA names in staff_members are treated as volunteers (not instructors)
      staff_members: [
        { id: 1, name: 'TA Alice', email: 'ta-alice@test.local' },
        { id: 2, name: 'VA Bob', email: 'va-bob@test.local' },
      ],
      // All desk/people are synced as students — TA/VA included
      people: [
        { id: 1, name: 'TA Alice' },
        { id: 2, name: 'VA Bob' },
        { id: 3, name: 'Regular Student' },
      ],
    });

    const result = await runSync(db, 'tok', fetchFn);

    // All three people are upserted as students
    expect(result.studentsUpserted).toBe(3);
    const rows = await db.select().from(schema.students);
    expect(rows).toHaveLength(3);
    // TA/VA staff are volunteers (not instructors)
    expect(result.instructorsUpserted).toBe(0);
  });
});

// ---- GitHub username ----

describe('GitHub username', () => {
  it('populates githubUsername from custom field', async () => {
    const fetchFn = buildFetch({
      people: [
        {
          id: 10,
          name: 'Student With GH',
          custom_fields: [{ name: PIKE13_GITHUB_FIELD_KEY, value: 'gh-handle' }],
        },
      ],
    });

    await runSync(db, 'tok', fetchFn);

    const [s] = await db
      .select()
      .from(schema.students)
      .where(eq(schema.students.pike13SyncId, '10'));
    expect(s.githubUsername).toBe('gh-handle');
  });

  it('sets githubUsername to null when field is absent', async () => {
    const fetchFn = buildFetch({ people: [{ id: 11, name: 'Student No GH' }] });

    await runSync(db, 'tok', fetchFn);

    const [s] = await db
      .select()
      .from(schema.students)
      .where(eq(schema.students.pike13SyncId, '11'));
    expect(s.githubUsername).toBeNull();
  });
});

// ---- Idempotency ----

describe('Idempotency', () => {
  it('running sync twice produces one student row', async () => {
    const fetchFn = buildFetch({ people: [{ id: 20, name: 'Idempotent Student' }] });

    await runSync(db, 'tok', fetchFn);
    await runSync(db, 'tok', fetchFn);

    const rows = await db.select().from(schema.students);
    expect(rows).toHaveLength(1);
  });
});

// ---- Volunteer hours ----

describe('Volunteer hours', () => {
  it('creates hour with correct source, externalId, and hours', async () => {
    // TA Charlie appears as a staff_member (volunteer) on the event occurrence.
    // Hours are computed from start_at/end_at and attributed to the volunteer name.
    const fetchFn = buildFetch({
      staff_members: [{ id: 30, name: 'TA Charlie' }],
      event_occurrences: [
        {
          id: 100,
          start_at: '2026-03-01T10:00:00Z',
          end_at: '2026-03-01T11:30:00Z',
          staff_members: [{ id: 30, name: 'TA Charlie' }],
        },
      ],
    });

    const result = await runSync(db, 'tok', fetchFn);

    expect(result.hoursCreated).toBe(1);
    const [hr] = await db.select().from(schema.volunteerHours);
    expect(hr.source).toBe('pike13');
    expect(hr.externalId).toBe('100-30');
    expect(hr.hours).toBeCloseTo(1.5);
    expect(hr.category).toBe('Teaching');
    expect(hr.volunteerName).toBe('TA Charlie');
  });

  it('does not create duplicate hours on second sync', async () => {
    const fetchFn = buildFetch({
      staff_members: [{ id: 31, name: 'VA Diana' }],
      event_occurrences: [
        {
          id: 101,
          start_at: '2026-03-01T09:00:00Z',
          end_at: '2026-03-01T10:00:00Z',
          staff_members: [{ id: 31, name: 'VA Diana' }],
        },
      ],
    });

    await runSync(db, 'tok', fetchFn);
    const result2 = await runSync(db, 'tok', fetchFn);

    expect(result2.hoursCreated).toBe(0);
    const rows = await db.select().from(schema.volunteerHours);
    expect(rows).toHaveLength(1);
  });
});

// ---- Instructor-student assignments ----

describe('Instructor-student assignments', () => {
  it('creates assignment when student visits an instructor session', async () => {
    // The instructor must appear in desk/staff_members (so allStaff is populated)
    // AND in the event_occurrences.staff_members list (so the assignment is created).
    // The student must appear in desk/people AND have visit_state='completed'
    // in the event occurrence's people list.
    const fetchFn = buildFetch({
      staff_members: [{ id: 999, name: 'Test Instructor', email: INSTRUCTOR_EMAIL }],
      people: [{ id: 40, name: 'Assignment Student' }],
      event_occurrences: [
        {
          id: 200,
          start_at: '2026-03-01T10:00:00Z',
          end_at: '2026-03-01T11:00:00Z',
          staff_members: [{ id: 999, name: 'Test Instructor' }],
          people: [{ id: 40, name: 'Assignment Student', visit_state: 'completed' }],
        },
      ],
    });

    const result = await runSync(db, 'tok', fetchFn);

    expect(result.assignmentsCreated).toBe(1);
    const [student] = await db
      .select()
      .from(schema.students)
      .where(eq(schema.students.pike13SyncId, '40'));
    const assignments = await db
      .select()
      .from(schema.instructorStudents)
      .where(eq(schema.instructorStudents.studentId, student.id));
    expect(assignments).toHaveLength(1);
    expect(assignments[0].instructorId).toBe(testInstructorId);
  });

  it('does not create duplicate assignments on second sync', async () => {
    const fetchFn = buildFetch({
      staff_members: [{ id: 999, name: 'Test Instructor', email: INSTRUCTOR_EMAIL }],
      people: [{ id: 41, name: 'Dup Assignment Student' }],
      event_occurrences: [
        {
          id: 201,
          start_at: '2026-03-01T10:00:00Z',
          end_at: '2026-03-01T11:00:00Z',
          staff_members: [{ id: 999, name: 'Test Instructor' }],
          people: [{ id: 41, name: 'Dup Assignment Student', visit_state: 'completed' }],
        },
      ],
    });

    await runSync(db, 'tok', fetchFn);
    const result2 = await runSync(db, 'tok', fetchFn);

    expect(result2.assignmentsCreated).toBe(0);
  });
});
