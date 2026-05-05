import { eq, sql, and, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';

/** Pike13 custom field key for the student's GitHub account name */
export const PIKE13_GITHUB_FIELD_KEY = 'github_acct_name';

/** Normalize a field name for loose comparison: lowercase, strip all non-alphanumeric chars.
 *  "Git Hub Acct Name" → "githubacctname" === "github_acct_name" → "githubacctname" */
function normalizeFieldName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const GITHUB_FIELD_NORMALIZED = normalizeFieldName(PIKE13_GITHUB_FIELD_KEY);

export interface SyncResult {
  studentsUpserted: number;
  instructorsUpserted: number;
  assignmentsCreated: number;
  hoursCreated: number;
}

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

// ---- Pike13 API response shapes ----

interface Pike13Person {
  id: number;
  name: string;
  email?: string;
  custom_fields?: Array<{ name: string; value: string | null }>;
}

interface Pike13StaffMember {
  id: number;
  name: string;
  email?: string;
}

interface Pike13EventOccurrence {
  id: number;
  start_at: string;
  end_at: string;
  staff_members?: Array<{ id: number; name: string }>;
  // People who have visits on this event; id matches desk/people person id
  people?: Array<{ id?: number; name?: string; visit_state?: string }>;
}

// ---- Fetch helpers ----

async function fetchPike13<T>(
  url: string,
  key: string,
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<T[]> {
  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Pike13 API returned ${res.status} for ${url}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return (data[key] as T[]) ?? [];
}

/** Follow Pike13 `next` pagination links and collect all results. */
async function fetchPike13All<T>(
  initialUrl: string,
  key: string,
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<T[]> {
  const results: T[] = [];
  let url: string | null = initialUrl;
  while (url) {
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Pike13 API returned ${res.status} for ${url}`);
    const data = (await res.json()) as Record<string, unknown>;
    const page = (data[key] as T[]) ?? [];
    results.push(...page);
    url = (data['next'] as string | null | undefined) ?? null;
  }
  return results;
}

/** TA/VA names use a "TA" or "VA" prefix (followed by a dash or space) in this Pike13 account.
 *  Matches: "TA-Drake", "TA Drake", "VA-Sam", "VA Sam", case-insensitively. */
const isTaOrVa = (name: string) => /^(TA|VA)[\s\-]/i.test(name);

export async function runSync(
  db: DrizzleDb,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<SyncResult> {
  // PIKE13_API_BASE is the tenant API root (e.g. https://jtl.pike13.com/api/v2/desk);
  // we append our own /api/v2/desk/... paths, so use just the origin.
  const apiBase = process.env.PIKE13_API_BASE ?? 'https://pike13.com';
  const base = new URL(apiBase).origin;
  const ytdStart = `${new Date().getFullYear()}-01-01`;
  const now = new Date();

  // 1. Get all staff from desk/staff_members (has both id and email)
  const allStaff = await fetchPike13<Pike13StaffMember>(
    `${base}/api/v2/desk/staff_members?per_page=200`,
    'staff_members',
    accessToken,
    fetchFn,
  );
  // Regular (non-TA/VA) staff are instructors
  const instructorStaff = allStaff.filter((s) => !isTaOrVa(s.name) && s.email);

  // 2. Upsert a user + instructor record for every Pike13 instructor staff member
  //    so they appear in the admin list even before they log in via OAuth.
  let instructorsUpserted = 0;
  for (const staff of instructorStaff) {
    const email = staff.email!.toLowerCase();

    const existingUsers = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    let userId: number;

    if (existingUsers.length > 0) {
      userId = existingUsers[0].id;
      if (existingUsers[0].name !== staff.name) {
        await db.update(schema.users).set({ name: staff.name }).where(eq(schema.users.id, userId));
      }
    } else {
      const [newUser] = await db
        .insert(schema.users)
        .values({ email, name: staff.name })
        .returning({ id: schema.users.id });
      userId = newUser.id;
    }

    const existingInstructors = await db
      .select()
      .from(schema.instructors)
      .where(eq(schema.instructors.userId, userId));

    if (existingInstructors.length === 0) {
      await db.insert(schema.instructors).values({ userId, isActive: true });
    } else if (!existingInstructors[0].isActive) {
      await db
        .update(schema.instructors)
        .set({ isActive: true })
        .where(eq(schema.instructors.id, existingInstructors[0].id));
    }
    instructorsUpserted++;
  }

  // 2b. VA/TA → instructor transition: when someone's Pike13 name changes from
  //     "VA-Sam" / "VA Sam" to just "Sam", migrate their old volunteer_hours entries
  //     to the new name so historical hours stay visible under their current identity.
  for (const staff of instructorStaff) {
    const possibleOldNames = [
      `TA-${staff.name}`, `TA ${staff.name}`,
      `VA-${staff.name}`, `VA ${staff.name}`,
    ];
    for (const oldName of possibleOldNames) {
      await db
        .update(schema.volunteerHours)
        .set({ volunteerName: staff.name })
        .where(
          and(
            eq(schema.volunteerHours.volunteerName, oldName),
            eq(schema.volunteerHours.source, 'pike13'),
          ),
        );
    }
  }

  // 3. Build pike13StaffId → instructorId map via email lookup
  const instructorRows = await db
    .select({ id: schema.instructors.id, email: schema.users.email })
    .from(schema.instructors)
    .innerJoin(schema.users, eq(schema.instructors.userId, schema.users.id));

  const emailToInstructorId = new Map(
    instructorRows.map((r) => [r.email.toLowerCase(), r.id]),
  );

  // staff_members in event_occurrences only have {id, name} — no email.
  // Resolve instructor id via the email we got from desk/staff_members.
  const pike13StaffIdToInstructorId = new Map<number, number>();
  for (const staff of allStaff) {
    if (!staff.email) continue;
    const instructorId = emailToInstructorId.get(staff.email.toLowerCase());
    if (instructorId !== undefined) {
      pike13StaffIdToInstructorId.set(staff.id, instructorId);
    }
  }

  // All staff who are NOT known instructors are treated as volunteers.
  // This is name-format-agnostic — it catches TAs, VAs, and anyone else
  // who isn't a paid instructor, regardless of how their name is formatted.
  const volunteerStaff = allStaff.filter((s) => !pike13StaffIdToInstructorId.has(s.id));

  // 4. Fetch YTD event occurrences in weekly chunks.
  //    The Pike13 API requires both from= and to= to return historical events.
  const eventOccurrences: Pike13EventOccurrence[] = [];
  const chunkStart = new Date(ytdStart);
  while (chunkStart <= now) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + 6);
    const from = chunkStart.toISOString().slice(0, 10);
    // Always use chunkEnd (never clamp to now) — clamping to now causes from==to
    // on the last chunk, which Pike13 rejects with 422.
    const to = chunkEnd.toISOString().slice(0, 10);
    const chunk = await fetchPike13<Pike13EventOccurrence>(
      `${base}/api/v2/desk/event_occurrences?from=${from}&to=${to}&per_page=200`,
      'event_occurrences',
      accessToken,
      fetchFn,
    );
    eventOccurrences.push(...chunk);
    chunkStart.setDate(chunkStart.getDate() + 7);
  }

  // 5. Fetch upcoming events.
  //    — For volunteer scheduled-status: today → +4 weeks
  //    — For the schedule table: this week's Sunday → +4 weeks (so the full current week is visible)
  const futureEnd = new Date(now);
  futureEnd.setDate(futureEnd.getDate() + 28);
  const futureEndStr = futureEnd.toISOString().slice(0, 10);

  // Sunday of the current UTC week (Pike13 times are UTC-based after JS Date conversion)
  const thisWeekSunday = new Date(now);
  const utcDayOfWeek = thisWeekSunday.getUTCDay(); // 0 = Sunday
  thisWeekSunday.setUTCDate(thisWeekSunday.getUTCDate() - utcDayOfWeek);
  thisWeekSunday.setUTCHours(0, 0, 0, 0);
  const thisWeekSundayStr = thisWeekSunday.toISOString().slice(0, 10);

  // Upcoming events from today (for volunteer scheduled-status only)
  const upcomingEvents = await fetchPike13<Pike13EventOccurrence>(
    `${base}/api/v2/desk/event_occurrences?from=${now.toISOString().slice(0, 10)}&to=${futureEndStr}&per_page=200`,
    'event_occurrences',
    accessToken,
    fetchFn,
  );

  // Schedule window events from this week's Sunday (to populate the full current week)
  const scheduleWindowEvents = thisWeekSundayStr < now.toISOString().slice(0, 10)
    ? await fetchPike13<Pike13EventOccurrence>(
        `${base}/api/v2/desk/event_occurrences?from=${thisWeekSundayStr}&to=${futureEndStr}&per_page=200`,
        'event_occurrences',
        accessToken,
        fetchFn,
      )
    : upcomingEvents;

  // 6. Volunteer scheduled status from upcoming events (any non-instructor staff)
  const scheduledNames = new Set<string>();
  for (const occ of upcomingEvents) {
    for (const staff of occ.staff_members ?? []) {
      if (!pike13StaffIdToInstructorId.has(staff.id)) scheduledNames.add(staff.name);
    }
  }

  // 6c. Upsert schedule table from the full current-week window
  for (const occ of scheduleWindowEvents) {
    const instrList: Array<{ pike13Id: number; name: string; instructorId: number | null; studentCount: number }> = [];
    const volList: Array<{ pike13Id: number; name: string }> = [];

    // Count students registered for this specific event (exclude cancellations).
    // All instructors in the same event get the same per-event count.
    const eventStudentCount = (occ.people ?? []).filter(
      (p) => p.visit_state !== 'cancelled' && p.visit_state !== 'late_cancelled',
    ).length;

    for (const staff of occ.staff_members ?? []) {
      const instructorId = pike13StaffIdToInstructorId.get(staff.id) ?? null;
      if (instructorId !== null) {
        instrList.push({
          pike13Id: staff.id,
          name: staff.name,
          instructorId,
          studentCount: eventStudentCount,
        });
      } else {
        volList.push({ pike13Id: staff.id, name: staff.name });
      }
    }

    if (instrList.length === 0) continue;

    await db
      .insert(schema.volunteerEventSchedule)
      .values({
        eventOccurrenceId: String(occ.id),
        startAt: new Date(occ.start_at),
        endAt: new Date(occ.end_at),
        instructors: instrList,
        volunteers: volList,
      })
      .onConflictDoUpdate({
        target: schema.volunteerEventSchedule.eventOccurrenceId,
        set: {
          startAt: new Date(occ.start_at),
          endAt: new Date(occ.end_at),
          instructors: instrList,
          volunteers: volList,
          updatedAt: new Date(),
        },
      });
  }

  // Delete stale events:
  // 1. Remove anything before this week's Sunday
  db.run(sql`
    DELETE FROM volunteer_event_schedule
    WHERE start_at < ${thisWeekSunday.toISOString()}
  `);

  // 2. Remove events in the schedule window that Pike13 no longer returns
  //    (e.g., classes that were cancelled or deleted since the last sync).
  //    Guard: skip if Pike13 returned nothing — treat empty as a potential API error.
  if (scheduleWindowEvents.length > 0) {
    const freshIds = scheduleWindowEvents.map((occ) => String(occ.id));
    // Remove stale events in the current schedule window: keep only freshIds.
    const deleteStale = db
      .delete(schema.volunteerEventSchedule)
      .where(
        and(
          sql`${schema.volunteerEventSchedule.startAt} >= ${thisWeekSunday.toISOString()}`,
          sql`${schema.volunteerEventSchedule.eventOccurrenceId} NOT IN (${sql.join(freshIds.map((id) => sql`${id}`), sql`, `)})`,
        ),
      );
    await deleteStale;
  }

  // 7. Volunteer hours from YTD events (any non-instructor staff member).
  //    A volunteer can be listed on two simultaneous events — only count once per time slot.

  // Clean up existing duplicates using a CTE (same volunteer, same start time → keep lowest id).
  db.run(sql`
    DELETE FROM volunteer_hours
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY volunteer_name, recorded_at ORDER BY id) AS rn
        FROM volunteer_hours
        WHERE source = 'pike13'
      ) ranked
      WHERE rn > 1
    )
  `);

  // Track (staffId, start_at) slots already processed in this sync run to prevent
  // double-counting a volunteer listed on two simultaneous events.
  const countedSlots = new Set<string>();
  let hoursCreated = 0;

  for (const occ of eventOccurrences) {
    const start = new Date(occ.start_at);
    const end = new Date(occ.end_at);
    const hours = Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);

    for (const staff of occ.staff_members ?? []) {
      // Skip known instructors — everyone else is a volunteer
      if (pike13StaffIdToInstructorId.has(staff.id)) continue;

      // Skip if this volunteer already has hours logged for this start time.
      const slotKey = `${staff.id}|${occ.start_at}`;
      if (countedSlots.has(slotKey)) continue;
      countedSlots.add(slotKey);

      const externalId = `${occ.id}-${staff.id}`;
      const inserted = await db
        .insert(schema.volunteerHours)
        .values({
          volunteerName: staff.name,
          category: 'Teaching',
          hours,
          source: 'pike13',
          externalId,
          recordedAt: start,
        })
        .onConflictDoNothing()
        .returning({ id: schema.volunteerHours.id });
      hoursCreated += inserted.length;
    }
  }

  // 8. Upsert volunteer_schedule for all volunteer (non-instructor) staff
  for (const staff of volunteerStaff) {
    await db
      .insert(schema.volunteerSchedule)
      .values({ volunteerName: staff.name, isScheduled: scheduledNames.has(staff.name) })
      .onConflictDoUpdate({
        target: schema.volunteerSchedule.volunteerName,
        set: { isScheduled: scheduledNames.has(staff.name), updatedAt: new Date() },
      });
  }

  // 9. Paginate through all people for student sync (per_page max = 100 for this endpoint)
  const allPeople = await fetchPike13All<Pike13Person>(
    `${base}/api/v2/desk/people?per_page=100`,
    'people',
    accessToken,
    fetchFn,
  );
  // Include everyone — a person can be both a TA (staff) and a student (attendee)
  const studentPeople = allPeople;

  const pike13IdToStudentId = new Map<number, number>();
  let studentsUpserted = 0;

  for (const person of studentPeople) {
    const githubUsername =
      person.custom_fields?.find((f) => normalizeFieldName(f.name) === GITHUB_FIELD_NORMALIZED)?.value ?? null;

    const [row] = await db
      .insert(schema.students)
      .values({
        name: person.name,
        guardianEmail: person.email ?? null,
        pike13SyncId: String(person.id),
        githubUsername,
      })
      .onConflictDoUpdate({
        target: schema.students.pike13SyncId,
        set: { name: person.name, guardianEmail: person.email ?? null, githubUsername },
      })
      .returning({ id: schema.students.id });

    pike13IdToStudentId.set(person.id, row.id);
    studentsUpserted++;
  }

  // 10. Instructor-student assignments from event people (confirmed attendance only)
  //     Track pairs seen in this sync run so we count each new assignment only once,
  //     even if the same student-instructor pair appears across multiple event chunks.
  let assignmentsCreated = 0;
  const seenAssignmentPairs = new Set<string>();

  for (const occ of eventOccurrences) {
    // Identify instructors on this event via pike13StaffId
    const instructorIds: number[] = [];
    for (const staff of occ.staff_members ?? []) {
      if (isTaOrVa(staff.name)) continue;
      const instructorId = pike13StaffIdToInstructorId.get(staff.id);
      if (instructorId !== undefined) instructorIds.push(instructorId);
    }
    if (instructorIds.length === 0) continue;

    for (const person of occ.people ?? []) {
      if (!person.id || !person.name) continue;
      // Only confirmed attendance
      if (person.visit_state !== 'completed') continue;

      // Resolve student — create a record on-the-fly if this person wasn't in desk/people
      // (e.g. TAs who are staff members but also attend some classes as students)
      let studentId = pike13IdToStudentId.get(person.id);
      if (studentId === undefined) {
        const [row] = await db
          .insert(schema.students)
          .values({ name: person.name, pike13SyncId: String(person.id) })
          .onConflictDoUpdate({
            target: schema.students.pike13SyncId,
            set: { name: person.name },
          })
          .returning({ id: schema.students.id });
        studentId = row.id;
        pike13IdToStudentId.set(person.id, studentId);
        studentsUpserted++;
      }

      const occStart = new Date(occ.start_at);
      const occurrenceId = String(occ.id);

      for (const instructorId of instructorIds) {
        const pairKey = `${instructorId}:${studentId}`;

        // Only attempt insert (and count) if we haven't already seen this pair in
        // this sync run. Pairs seen before will just have their lastSeenAt updated.
        if (!seenAssignmentPairs.has(pairKey)) {
          seenAssignmentPairs.add(pairKey);

          // Try to insert; if the row already exists this returns an empty array.
          const inserted = await db
            .insert(schema.instructorStudents)
            .values({ instructorId, studentId, lastSeenAt: occStart })
            .onConflictDoNothing()
            .returning({ instructorId: schema.instructorStudents.instructorId });
          assignmentsCreated += inserted.length;
        }

        // Always keep the most recent lastSeenAt across all occurrences.
        await db
          .update(schema.instructorStudents)
          .set({ lastSeenAt: occStart })
          .where(
            and(
              eq(schema.instructorStudents.instructorId, instructorId),
              eq(schema.instructorStudents.studentId, studentId),
            ),
          );

        // Record individual attendance session
        await db
          .insert(schema.studentAttendance)
          .values({ studentId, instructorId, attendedAt: occStart, eventOccurrenceId: occurrenceId })
          .onConflictDoNothing();
      }
    }
  }

  return { studentsUpserted, instructorsUpserted, assignmentsCreated, hoursCreated };
}
