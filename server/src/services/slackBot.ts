import Anthropic from '@anthropic-ai/sdk';
import { eq, and, count, notLike, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  instructors, users, instructorStudents, monthlyReviews,
  students, volunteerEventSchedule,
} from '../db/schema';
import { findReviewByStudentName, findReviewByGithubUsername, generateReviewDraft, loadReviewForSend } from './reviewGenerator';
import { sendPike13Note, buildPike13NoteText } from './pike13Notes';

interface BotContext {
  channelId: string;
  threadTs: string;
  appUrl: string;
  postFn: (channel: string, text: string, threadTs: string) => Promise<void>;
  postBlocksFn: (channel: string, blocks: unknown[], text: string, threadTs: string) => Promise<void>;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'check_reviews',
    description: 'Get progress review compliance for a month — who has sent reviews, who is still pending, summary counts. Use for questions about review status, compliance, who is done, who still needs to send.',
    input_schema: {
      type: 'object' as const,
      properties: {
        month: { type: 'string', description: 'YYYY-MM format. Omit to use current month.' },
        instructor_name: { type: 'string', description: 'Partial instructor name to narrow results.' },
      },
    },
  },
  {
    name: 'check_student',
    description: 'Look up a specific student\'s review status — their instructor, review state, and when it was sent. Use when asked about a specific student.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Student name (partial match OK).' },
        month: { type: 'string', description: 'YYYY-MM format. Omit for current month.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'check_schedule',
    description: 'Get the class schedule for a week — instructors, student counts, and TA/volunteer assignments. Use when asked about the schedule, TAs, class coverage, or who is teaching.',
    input_schema: {
      type: 'object' as const,
      properties: {
        week_of: { type: 'string', description: 'Any YYYY-MM-DD in the desired week. Omit for current week.' },
      },
    },
  },
  {
    name: 'check_instructor',
    description: 'Get a specific instructor\'s details — how many students they have, review completion rate. Use when asked about a specific instructor.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Instructor name (partial match OK).' },
        month: { type: 'string', description: 'YYYY-MM format. Omit for current month.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'generate_review',
    description: 'Generate a draft progress review for a student using their GitHub activity. Automatically uses the instructor\'s saved review template if one exists — no need to ask. Posts the draft in Slack with Send and Test buttons so the instructor can review and send it. Use when asked to generate, write, create, or draft a review for a student, or when asked to use a saved template to generate a review. Provide either student_name or github_username — github_username takes priority if both are given.',
    input_schema: {
      type: 'object' as const,
      properties: {
        student_name: { type: 'string', description: 'Student name (partial match OK). Use if the user refers to the student by name.' },
        github_username: { type: 'string', description: 'Student\'s GitHub username (exact match, with or without @). Use if the user provides a GitHub handle.' },
        month: { type: 'string', description: 'YYYY-MM format. Omit for current month.' },
      },
      required: [],
    },
  },
];

async function runTool(name: string, input: Record<string, string>, ctx: BotContext): Promise<string> {
  const month = input.month ?? new Date().toISOString().slice(0, 7);
  const [year, mon] = month.split('-');
  const monthLabel = new Date(Number(year), Number(mon) - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

  if (name === 'check_reviews') {
    const allInstructors = await db
      .select({ id: instructors.id, name: users.name })
      .from(instructors)
      .innerJoin(users, eq(instructors.userId, users.id))
      .where(and(eq(instructors.isActive, true), notLike(users.email, '%example.com%')));

    const filter = input.instructor_name?.toLowerCase();
    const targets = filter
      ? allInstructors.filter((i) => i.name.toLowerCase().includes(filter))
      : allInstructors;

    const reviewCounts = await db
      .select({ instructorId: monthlyReviews.instructorId, status: monthlyReviews.status, n: count() })
      .from(monthlyReviews)
      .where(eq(monthlyReviews.month, month))
      .groupBy(monthlyReviews.instructorId, monthlyReviews.status);

    const countMap = new Map<number, { sent: number; draft: number; pending: number }>();
    for (const r of reviewCounts) {
      if (!countMap.has(r.instructorId)) countMap.set(r.instructorId, { sent: 0, draft: 0, pending: 0 });
      countMap.get(r.instructorId)![r.status as 'sent' | 'draft' | 'pending'] = Number(r.n);
    }

    const stuCounts = await db
      .select({ instructorId: instructorStudents.instructorId, n: count() })
      .from(instructorStudents)
      .groupBy(instructorStudents.instructorId);
    const stuMap = new Map(stuCounts.map((r) => [r.instructorId, Number(r.n)]));

    const rows = targets
      .map((i) => ({ name: i.name, ...(countMap.get(i.id) ?? { sent: 0, draft: 0, pending: 0 }), total: stuMap.get(i.id) ?? 0 }))
      .filter((r) => r.total > 0);

    return JSON.stringify({
      month: monthLabel,
      summary: `${rows.filter((r) => r.sent >= r.total).length} of ${rows.length} instructors complete`,
      complete: rows.filter((r) => r.sent >= r.total).map((r) => `${r.name} (${r.sent}/${r.total})`),
      pending: rows.filter((r) => r.sent < r.total).map((r) =>
        `${r.name}: ${r.sent}/${r.total} sent${r.draft > 0 ? `, ${r.draft} draft` : ''}`),
    });
  }

  if (name === 'check_student') {
    const nameFilter = input.name.toLowerCase();
    const results = await db
      .select({
        studentName: students.name,
        instructorName: users.name,
        status: monthlyReviews.status,
        sentAt: monthlyReviews.sentAt,
      })
      .from(students)
      .leftJoin(instructorStudents, eq(instructorStudents.studentId, students.id))
      .leftJoin(instructors, eq(instructors.id, instructorStudents.instructorId))
      .leftJoin(users, eq(users.id, instructors.userId))
      .leftJoin(
        monthlyReviews,
        and(
          eq(monthlyReviews.studentId, students.id),
          eq(monthlyReviews.instructorId, instructors.id),
          eq(monthlyReviews.month, month),
        ),
      )
      .where(sql`lower(${students.name}) like ${'%' + nameFilter + '%'}`);

    if (results.length === 0) return JSON.stringify({ error: `No student found matching "${input.name}"` });

    return JSON.stringify(results.map((r) => ({
      student: r.studentName,
      instructor: r.instructorName ?? 'unassigned',
      reviewStatus: r.status ?? 'not created',
      sentAt: r.sentAt ? r.sentAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
      month: monthLabel,
    })));
  }

  if (name === 'check_schedule') {
    let weekStart: Date;
    if (input.week_of) {
      weekStart = new Date(input.week_of + 'T00:00:00.000Z');
    } else {
      weekStart = new Date();
      const dow = weekStart.getUTCDay();
      weekStart.setUTCDate(weekStart.getUTCDate() - dow);
      weekStart.setUTCHours(0, 0, 0, 0);
    }
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const events = await db
      .select()
      .from(volunteerEventSchedule)
      .where(and(gte(volunteerEventSchedule.startAt, weekStart), lt(volunteerEventSchedule.startAt, weekEnd)))
      .orderBy(volunteerEventSchedule.startAt);

    const formatted = events.map((e) => ({
      time: e.startAt.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
      }),
      instructors: e.instructors.map((i) => i.name),
      studentCount: e.instructors[0]?.studentCount ?? 0,
      volunteers: e.volunteers.map((v) => v.name),
      needsTA: e.instructors.some((i) => i.studentCount > 6) && e.volunteers.length === 0,
    }));

    return JSON.stringify({
      week: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        + ' – ' + new Date(weekEnd.getTime() - 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      totalClasses: formatted.length,
      needsTACount: formatted.filter((e) => e.needsTA).length,
      classes: formatted,
    });
  }

  if (name === 'check_instructor') {
    const nameFilter = input.name.toLowerCase();
    const allInstructors = await db
      .select({ id: instructors.id, name: users.name, email: users.email })
      .from(instructors)
      .innerJoin(users, eq(instructors.userId, users.id))
      .where(eq(instructors.isActive, true));

    const matches = allInstructors.filter((i) => i.name.toLowerCase().includes(nameFilter));
    if (matches.length === 0) return JSON.stringify({ error: `No instructor found matching "${input.name}"` });

    const results = [];
    for (const instr of matches.slice(0, 3)) {
      const stuCount = await db
        .select({ n: count() })
        .from(instructorStudents)
        .where(eq(instructorStudents.instructorId, instr.id));

      const reviews = await db
        .select({ status: monthlyReviews.status, n: count() })
        .from(monthlyReviews)
        .where(and(eq(monthlyReviews.instructorId, instr.id), eq(monthlyReviews.month, month)))
        .groupBy(monthlyReviews.status);

      const reviewMap = Object.fromEntries(reviews.map((r) => [r.status, Number(r.n)]));
      const total = Number(stuCount[0]?.n ?? 0);
      const sent = reviewMap.sent ?? 0;

      results.push({
        name: instr.name,
        students: total,
        reviewsSent: sent,
        reviewsDraft: reviewMap.draft ?? 0,
        reviewsPending: reviewMap.pending ?? 0,
        complete: total > 0 && sent >= total,
        month: monthLabel,
      });
    }

    return JSON.stringify(results.length === 1 ? results[0] : results);
  }

  if (name === 'generate_review') {
    if (!input.student_name && !input.github_username) {
      return JSON.stringify({ error: 'Please provide either a student name or a GitHub username.' });
    }
    const found = input.github_username
      ? await findReviewByGithubUsername(input.github_username, month)
      : await findReviewByStudentName(input.student_name, month);
    if ('error' in found) return JSON.stringify({ error: found.error });

    const { reviewId, studentName } = found;
    const [yr, mo] = month.split('-');
    const monthLabel = new Date(Number(yr), Number(mo) - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

    let draft: { body: string };
    try {
      draft = await generateReviewDraft(reviewId);
    } catch (err) {
      return JSON.stringify({ error: `Generation failed: ${(err as Error).message}` });
    }

    // Save draft to DB
    await db
      .update(monthlyReviews)
      .set({ body: draft.body, status: 'draft', updatedAt: new Date() })
      .where(eq(monthlyReviews.id, reviewId));

    // Truncate for Slack's 3000-char block limit
    const MAX = 2700;
    const preview = draft.body.length > MAX
      ? draft.body.slice(0, MAX) + `\n\n_(truncated — <${ctx.appUrl}/reviews/${reviewId}|view full draft>)_`
      : draft.body;

    const blocks = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:pencil: *Draft ready: ${studentName} — ${monthLabel}*\n\n${preview}` },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Send to Guardian' },
            style: 'primary',
            action_id: 'send_review',
            value: String(reviewId),
            confirm: {
              title: { type: 'plain_text', text: 'Send this review?' },
              text: { type: 'mrkdwn', text: `Send the progress report for *${studentName}* to their guardian?` },
              confirm: { type: 'plain_text', text: 'Send it' },
              deny: { type: 'plain_text', text: 'Cancel' },
            },
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Send Test Note' },
            action_id: 'test_review',
            value: String(reviewId),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Edit in App' },
            url: `${ctx.appUrl}/reviews/${reviewId}`,
          },
        ],
      },
    ];

    await ctx.postBlocksFn(ctx.channelId, blocks, `Draft ready for ${studentName}`, ctx.threadTs);
    return JSON.stringify({ ok: true, message: `Draft generated and posted for ${studentName} (${monthLabel}).` });
  }

  return JSON.stringify({ error: `Unknown tool: ${name}` });
}

const SYSTEM_PROMPT = `You are Progress Bot, a helpful assistant for The LEAGUE of Amazing Programmers — a coding education nonprofit. You help instructors and admins check on student progress reviews, volunteer schedules, and compliance.

Guidelines:
- Be friendly, concise, and direct
- Format for Slack: use *bold*, bullet points with •, and line breaks
- Never use markdown headers (#) or triple backticks
- Keep answers under ~250 words unless a full report is specifically requested
- If you don't have the info needed, say so and suggest what to ask instead
- When generating a review, always use generate_review — it automatically applies the instructor's saved template. If someone asks you to use their template, reassure them it will be used and call generate_review.
- Current month and date are provided in each request`;

export async function handleBotMessage(
  question: string,
  channelId: string,
  threadTs: string,
  postFn: (channel: string, text: string, threadTs: string) => Promise<void>,
  postBlocksFn: (channel: string, blocks: unknown[], text: string, threadTs: string) => Promise<void>,
): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    await postFn(channelId, ':x: ANTHROPIC_API_KEY is not configured.', threadTs);
    return;
  }

  const ctx: BotContext = {
    channelId,
    threadTs,
    appUrl: (process.env.APP_URL ?? 'https://progress.jtlapp.net').replace(/\/$/, ''),
    postFn,
    postBlocksFn,
  };

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const currentMonth = new Date().toISOString().slice(0, 7);
  const system = `${SYSTEM_PROMPT}\n\nToday: ${today} | Current month: ${currentMonth}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];

  let response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system,
    tools: TOOLS,
    messages,
  });

  while (response.stop_reason === 'tool_use') {
    const toolCalls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const call of toolCalls) {
      const result = await runTool(call.name, call.input as Record<string, string>, ctx).catch(
        (err) => JSON.stringify({ error: String(err) }),
      );
      results.push({ type: 'tool_result', tool_use_id: call.id, content: result });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: results });

    response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      tools: TOOLS,
      messages,
    });
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  await postFn(
    channelId,
    text || ":thinking_face: I wasn't sure how to answer that. Try asking about reviews, a specific student, or the schedule.",
    threadTs,
  );
}
