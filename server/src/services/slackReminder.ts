import { eq, and, notLike, count, gte, lt } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';
import { instructors, users, instructorStudents, monthlyReviews, students, studentAttendance } from '../db/schema';
import { sendSlackDM } from './slack';

export interface ReminderResult {
  sent: number;
  notFound: number;
  results: Array<{ name: string; email: string; dmSent: boolean; pending: number }>;
}

export async function sendMonthlyReminders(
  month: string,
  nameFilter?: string,
): Promise<ReminderResult> {
  const [year, mon] = month.split('-');
  const monthLabel = new Date(Number(year), Number(mon) - 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');

  const monthStart = new Date(Number(year), Number(mon) - 1, 1);
  const monthEnd = new Date(Number(year), Number(mon), 1);

  // --- Pre-compute primary instructor per student ---
  // Primary = instructor who had the student the most times this month.
  // Tiebreak = instructor who has had the student the most times historically.
  // If a student has no attendance yet this month, fall back to all-time counts.

  const monthlyRows = await db
    .select({
      studentId: studentAttendance.studentId,
      instructorId: studentAttendance.instructorId,
      n: count(),
    })
    .from(studentAttendance)
    .where(and(gte(studentAttendance.attendedAt, monthStart), lt(studentAttendance.attendedAt, monthEnd)))
    .groupBy(studentAttendance.studentId, studentAttendance.instructorId);

  const allTimeRows = await db
    .select({
      studentId: studentAttendance.studentId,
      instructorId: studentAttendance.instructorId,
      n: count(),
    })
    .from(studentAttendance)
    .groupBy(studentAttendance.studentId, studentAttendance.instructorId);

  // studentId → Map<instructorId, count>
  const monthlyByStudent = new Map<number, Map<number, number>>();
  for (const r of monthlyRows) {
    if (!monthlyByStudent.has(r.studentId)) monthlyByStudent.set(r.studentId, new Map());
    monthlyByStudent.get(r.studentId)!.set(r.instructorId, Number(r.n));
  }

  const allTimeByStudent = new Map<number, Map<number, number>>();
  for (const r of allTimeRows) {
    if (!allTimeByStudent.has(r.studentId)) allTimeByStudent.set(r.studentId, new Map());
    allTimeByStudent.get(r.studentId)!.set(r.instructorId, Number(r.n));
  }

  // Returns the instructor ID that "owns" this student for the month.
  // Falls back to `defaultInstructorId` if no attendance data exists.
  function primaryInstructorFor(studentId: number, defaultInstructorId: number): number {
    const monthly = monthlyByStudent.get(studentId);
    const allTime = allTimeByStudent.get(studentId);
    const combined = allTime ?? monthly;
    if (!combined || combined.size === 0) return defaultInstructorId;

    let best = defaultInstructorId;
    let bestMonthly = -1;
    let bestAllTime = -1;

    for (const [instrId, allTimeCount] of combined) {
      const monthlyCount = monthly?.get(instrId) ?? 0;
      if (
        monthlyCount > bestMonthly ||
        (monthlyCount === bestMonthly && allTimeCount > bestAllTime)
      ) {
        best = instrId;
        bestMonthly = monthlyCount;
        bestAllTime = allTimeCount;
      }
    }

    return best;
  }

  // All sent reviews this month (any instructor) — used to avoid double-reminding
  // when one instructor already sent a review for a student who appears in two lists.
  const allSentThisMonth = await db
    .select({ studentId: monthlyReviews.studentId })
    .from(monthlyReviews)
    .where(and(eq(monthlyReviews.month, month), eq(monthlyReviews.status, 'sent')));
  const sentStudentIds = new Set(allSentThisMonth.map((r) => r.studentId));

  const allInstructors = await db
    .select({ id: instructors.id, name: users.name, email: users.email })
    .from(instructors)
    .innerJoin(users, eq(instructors.userId, users.id))
    .where(and(eq(instructors.isActive, true), notLike(users.email, '%example.com%')));

  const filter = nameFilter?.toLowerCase().trim();
  const targetInstructors = filter
    ? allInstructors.filter((i) => i.name.toLowerCase().includes(filter))
    : allInstructors;

  const results: ReminderResult['results'] = [];

  for (const instr of targetInstructors) {
    const assignedStudents = await db
      .select({ id: students.id, name: students.name })
      .from(instructorStudents)
      .innerJoin(students, eq(instructorStudents.studentId, students.id))
      .where(eq(instructorStudents.instructorId, instr.id))
      .orderBy(students.name);

    if (assignedStudents.length === 0) continue;

    // Filter to students where this instructor is the primary for the month,
    // and no review has been sent for them yet.
    const pending = assignedStudents.filter(
      (s) =>
        primaryInstructorFor(s.id, instr.id) === instr.id &&
        !sentStudentIds.has(s.id),
    );

    if (pending.length === 0) continue;

    const studentList = pending.map((s) => `• ${s.name}`).join('\n');

    const staticText = [
      `:wave: Hi ${instr.name}! This is a reminder from LEAGUE to complete your *${monthLabel}* progress reviews.`,
      '',
      `*Students still needing reviews (${pending.length}):*`,
      studentList,
      '',
      `Log in and complete them here: ${appUrl}/reviews?month=${month}`,
    ].join('\n');

    let text = staticText;

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const message = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
          system: `You write short, friendly Slack DMs for a coding education nonprofit called The LEAGUE of Amazing Programmers.
Tone: warm, encouraging, collegial — not corporate, not naggy.
Rules:
- Address the instructor by first name only
- Mention the month naturally in a sentence (don't just say "for April")
- List the students exactly as given, each on its own line with a bullet (•)
- End with the login link on its own line, no label needed
- Use Slack bold (*word*) sparingly — just for the student list header
- Total length: 5–8 lines, no more
- Do NOT add greetings like "Hey!" or sign-offs like "Thanks!" — get straight to it`,
          messages: [
            {
              role: 'user',
              content: `Write a Slack reminder to ${instr.name.split(' ')[0]} to send their ${monthLabel} progress reviews.
Pending students (${pending.length}):
${studentList}
Login link: ${appUrl}/reviews?month=${month}`,
            },
          ],
        });
        const generated = (message.content[0]?.type === 'text' ? message.content[0].text : '').trim();
        if (generated) text = generated;
      } catch { /* fall through to static text */ }
    }

    let dmSent = false;
    try {
      dmSent = await sendSlackDM(instr.email, text);
    } catch {
      dmSent = false;
    }

    results.push({ name: instr.name, email: instr.email, dmSent, pending: pending.length });
  }

  const sent = results.filter((r) => r.dmSent).length;
  const notFound = results.filter((r) => !r.dmSent).length;
  return { sent, notFound, results };
}
