import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../server/src/db/schema';
import { db } from '../../server/src/db';

// Mock the GitHub layer so no real API calls are made. Each test sets the
// return per-username via the map below.
jest.mock('../../server/src/services/github');
import { hasLeagueCommitsInRange } from '../../server/src/services/github';
const mockHasCommits = hasLeagueCommitsInRange as jest.MockedFunction<typeof hasLeagueCommitsInRange>;

import { runCommitCheck } from '../../server/src/services/commitAlerts';
import { weekBounds } from '../../server/src/services/quizAlerts';

const NOW = new Date('2026-04-15T12:00:00'); // Wednesday
const { weekStart } = weekBounds(NOW);
const inThisWeek = new Date(weekStart.getTime() + 2 * 24 * 3600 * 1000);

let instrId: number;
let committed: number;   // scheduled, committed last week -> no alert
let noCommit: number;    // scheduled, no commit, established -> ALERT
let newStudent: number;  // scheduled, no commit, but only 2 classes -> exempt
const evtOcc = 'evt-commit-week';

async function newInstructor(email: string, name: string): Promise<number> {
  const [u] = await db.insert(schema.users).values({ email, name }).returning();
  const [i] = await db.insert(schema.instructors).values({ userId: u.id, isActive: true }).returning();
  return i.id;
}

beforeAll(async () => {
  delete process.env.SLACK_BOT_TOKEN; // Slack unconfigured -> dmSent false, no network

  instrId = await newInstructor('ca-instr@test.local', 'Commit Instr');

  const [c] = await db.insert(schema.students).values({ name: 'Committed Kid', githubUsername: 'committed-kid' }).returning();
  const [n] = await db.insert(schema.students).values({ name: 'NoCommit Kid', githubUsername: 'nocommit-kid' }).returning();
  const [nw] = await db.insert(schema.students).values({ name: 'New Kid', githubUsername: 'new-kid' }).returning();
  committed = c.id; noCommit = n.id; newStudent = nw.id;

  // Attendance: committed + noCommit are established (3 classes); new has 2.
  const rows: Array<typeof schema.studentAttendance.$inferInsert> = [];
  for (const sid of [committed, noCommit]) {
    for (let d = 1; d <= 3; d++) rows.push({ studentId: sid, instructorId: instrId, attendedAt: new Date(2026, 0, d), eventOccurrenceId: `att-${sid}-${d}` });
  }
  for (let d = 1; d <= 2; d++) rows.push({ studentId: newStudent, instructorId: instrId, attendedAt: new Date(2026, 0, d), eventOccurrenceId: `att-${newStudent}-${d}` });
  await db.insert(schema.studentAttendance).values(rows);

  // All three scheduled with instr this week.
  await db.insert(schema.volunteerEventSchedule).values({
    eventOccurrenceId: evtOcc,
    startAt: inThisWeek,
    endAt: new Date(inThisWeek.getTime() + 3600 * 1000),
    instructors: [{ pike13Id: 1, name: 'Commit Instr', instructorId: instrId, studentCount: 3 }],
    volunteers: [],
    students: [
      { pike13Id: 0, name: 'Committed Kid', studentId: committed },
      { pike13Id: 0, name: 'NoCommit Kid', studentId: noCommit },
      { pike13Id: 0, name: 'New Kid', studentId: newStudent },
    ],
  });
});

afterAll(async () => {
  await db.delete(schema.studentAttendance).where(inArray(schema.studentAttendance.studentId, [committed, noCommit, newStudent]));
  await db.delete(schema.volunteerEventSchedule).where(eq(schema.volunteerEventSchedule.eventOccurrenceId, evtOcc));
  await db.delete(schema.students).where(inArray(schema.students.id, [committed, noCommit, newStudent]));
  await db.delete(schema.instructors).where(eq(schema.instructors.id, instrId));
  await db.delete(schema.users).where(eq(schema.users.email, 'ca-instr@test.local'));
});

beforeEach(() => {
  mockHasCommits.mockReset();
  mockHasCommits.mockImplementation(async (username: string) => {
    if (username === 'committed-kid') return { hasCommits: true, checked: true };
    return { hasCommits: false, checked: true };
  });
});

describe('runCommitCheck', () => {
  it('alerts the instructor only about established students who did not commit', async () => {
    const result = await runCommitCheck(NOW);
    const instr = result.results.find((r) => r.email === 'ca-instr@test.local');
    expect(instr).toBeDefined();
    // NoCommit Kid only: Committed Kid pushed, New Kid is exempt.
    expect(instr!.studentCount).toBe(1);
    expect(instr!.dmSent).toBe(false); // Slack unconfigured
  });

  it('exempts new students (<=2 classes) even if they did not commit', async () => {
    // Make everyone "no commit"; New Kid must still be excluded.
    mockHasCommits.mockResolvedValue({ hasCommits: false, checked: true });
    const result = await runCommitCheck(NOW);
    const total = result.results.reduce((n, r) => n + r.studentCount, 0);
    expect(total).toBe(2); // committed + noCommit (both established), new excluded
  });

  it('does not alert when everyone committed', async () => {
    mockHasCommits.mockResolvedValue({ hasCommits: true, checked: true });
    const result = await runCommitCheck(NOW);
    expect(result.results).toEqual([]);
  });

  it('returns empty when nothing is scheduled this week', async () => {
    const result = await runCommitCheck(new Date('2020-01-08T12:00:00'));
    expect(result.results).toEqual([]);
  });
});
