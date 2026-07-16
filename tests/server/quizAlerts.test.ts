import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { db } from '../../server/src/db';
import { runQuizCompletionCheck, weekBounds } from '../../server/src/services/quizAlerts';

// These tests exercise the detection + grouping logic. Slack is not configured
// in the test env, so sendSlackDM returns false (no network); we assert on the
// returned `results` (which instructor is alerted, for how many students).

const NOW = new Date('2026-04-15T12:00:00'); // a Wednesday
const { weekStart } = weekBounds(NOW);
// A time inside this week's schedule window.
const inThisWeek = new Date(weekStart.getTime() + 2 * 24 * 3600 * 1000);
const lastWeek = new Date(weekStart.getTime() - 2 * 24 * 3600 * 1000);

let scheduledInstrId: number;
let otherInstrId: number;
let studentA: number; // scheduled this week, has incomplete quiz -> alert
let studentB: number; // scheduled this week, all complete -> no alert
let studentC: number; // has incomplete quiz but scheduled LAST week -> no alert
let levelId: number;
let lessonId: number;
let lesson2Id: number;

async function newInstructor(email: string, name: string): Promise<number> {
  const [u] = await db.insert(schema.users).values({ email, name }).returning();
  const [i] = await db.insert(schema.instructors).values({ userId: u.id, isActive: true }).returning();
  return i.id;
}

const evtOccId = { a: 'evt-this-week', b: 'evt-last-week' };

beforeAll(async () => {
  delete process.env.SLACK_BOT_TOKEN;

  scheduledInstrId = await newInstructor('qa-sched@test.local', 'Scheduled Instr');
  otherInstrId = await newInstructor('qa-other@test.local', 'Other Instr');

  const [sA] = await db.insert(schema.students).values({ name: 'Quiz Student A', pike13SyncId: 'pk-A' }).returning();
  const [sB] = await db.insert(schema.students).values({ name: 'Quiz Student B', pike13SyncId: 'pk-B' }).returning();
  const [sC] = await db.insert(schema.students).values({ name: 'Quiz Student C', pike13SyncId: 'pk-C' }).returning();
  studentA = sA.id; studentB = sB.id; studentC = sC.id;

  const [lvl] = await db.insert(schema.quizLevels).values({ slug: 'level-test-qa', name: 'Level Test', order: 1 }).returning();
  levelId = lvl.id;
  const [les] = await db.insert(schema.quizLessons).values({ levelId, name: 'Level3-Module2', module: 'M2', path: 'p', order: 1 }).returning();
  lessonId = les.id;
  const [les2] = await db.insert(schema.quizLessons).values({ levelId, name: 'Level3-Module3', module: 'M3', path: 'p2', order: 2 }).returning();
  lesson2Id = les2.id;

  const instrJson = [{ pike13Id: 111, name: 'Scheduled Instr', instructorId: scheduledInstrId, studentCount: 2 }];

  // This week's event: A and B registered with the scheduled instructor.
  await db.insert(schema.volunteerEventSchedule).values({
    eventOccurrenceId: evtOccId.a,
    startAt: inThisWeek,
    endAt: new Date(inThisWeek.getTime() + 3600 * 1000),
    instructors: instrJson,
    volunteers: [],
    students: [
      { pike13Id: 0, name: 'Quiz Student A', studentId: studentA },
      { pike13Id: 0, name: 'Quiz Student B', studentId: studentB },
    ],
  });

  // Last week's event: C registered (should NOT trigger — outside this week).
  await db.insert(schema.volunteerEventSchedule).values({
    eventOccurrenceId: evtOccId.b,
    startAt: lastWeek,
    endAt: new Date(lastWeek.getTime() + 3600 * 1000),
    instructors: instrJson,
    volunteers: [],
    students: [{ pike13Id: 0, name: 'Quiz Student C', studentId: studentC }],
  });

  // Quizzes: A incomplete + complete; B complete; C incomplete.
  await db.insert(schema.quizzes).values([
    { studentId: studentA, lessonId, status: 'assigned', questionIds: [] },
    { studentId: studentA, lessonId: lesson2Id, status: 'completed', questionIds: [] },
    { studentId: studentB, lessonId, status: 'completed', questionIds: [] },
    { studentId: studentC, lessonId, status: 'assigned', questionIds: [] },
  ]);
});

afterAll(async () => {
  await db.delete(schema.quizzes).where(inArray(schema.quizzes.studentId, [studentA, studentB, studentC]));
  await db.delete(schema.volunteerEventSchedule).where(inArray(schema.volunteerEventSchedule.eventOccurrenceId, [evtOccId.a, evtOccId.b]));
  await db.delete(schema.quizLessons).where(inArray(schema.quizLessons.id, [lessonId, lesson2Id]));
  await db.delete(schema.quizLevels).where(eq(schema.quizLevels.id, levelId));
  await db.delete(schema.students).where(inArray(schema.students.id, [studentA, studentB, studentC]));
  await db.delete(schema.instructors).where(inArray(schema.instructors.id, [scheduledInstrId, otherInstrId]));
  await db.delete(schema.users).where(inArray(schema.users.email, ['qa-sched@test.local', 'qa-other@test.local']));
});

describe('runQuizCompletionCheck', () => {
  it('alerts the instructor scheduled this week for students with an incomplete quiz', async () => {
    const result = await runQuizCompletionCheck(NOW);
    const sched = result.results.find((r) => r.email === 'qa-sched@test.local');
    expect(sched).toBeDefined();
    expect(sched!.studentCount).toBe(1); // only student A (B is complete)
    expect(sched!.dmSent).toBe(false); // Slack unconfigured in tests
    expect(result.results.some((r) => r.email === 'qa-other@test.local')).toBe(false);
  });

  it('does not alert about students scheduled only in a different week', async () => {
    const result = await runQuizCompletionCheck(NOW);
    const totalStudents = result.results.reduce((n, r) => n + r.studentCount, 0);
    expect(totalStudents).toBe(1); // student C (last week) excluded
  });

  it('returns empty when nothing is scheduled this week', async () => {
    const result = await runQuizCompletionCheck(new Date('2020-01-08T12:00:00'));
    expect(result.results).toEqual([]);
    expect(result.sent).toBe(0);
  });

  it('resolves students by pike13SyncId when the schedule row lacks a studentId', async () => {
    // Overwrite this week's event so A is present only by pike13 id (studentId null).
    await db.update(schema.volunteerEventSchedule)
      .set({ students: [{ pike13Id: 999, name: 'Quiz Student A', studentId: null }] })
      .where(eq(schema.volunteerEventSchedule.eventOccurrenceId, evtOccId.a));
    // pk-A is student A's pike13SyncId, so it must still resolve.
    await db.update(schema.students).set({ pike13SyncId: '999' }).where(eq(schema.students.id, studentA));

    const result = await runQuizCompletionCheck(NOW);
    const sched = result.results.find((r) => r.email === 'qa-sched@test.local');
    expect(sched).toBeDefined();
    expect(sched!.studentCount).toBe(1);
  });
});
