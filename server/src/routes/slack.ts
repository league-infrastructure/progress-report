import { Router } from 'express';
import express from 'express';
import { eq } from 'drizzle-orm';
import { verifySlackSignature } from '../middleware/verifySlack';
import { generateComplianceReport, generateStudentStatusReport } from '../services/slackReport';
import { sendMonthlyReminders } from '../services/slackReminder';
import { isSlackConfigured, sendSlackDM, lookupSlackUserByEmail, postSlackMessage, postSlackBlocks } from '../services/slack';
import { findReviewByStudentName, generateReviewDraft, sendReview, loadReviewForSend } from '../services/reviewGenerator';
import { handleBotMessage } from '../services/slackBot';
import { db } from '../db';
import { monthlyReviews, instructors, users } from '../db/schema';

export const slackRouter = Router();

interface SlackPayload {
  command: string;
  text: string;
  response_url: string;
  user_id: string;
  user_name: string;
}

function parseArgs(text: string): { month: string; nameFilter?: string } {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const monthIdx = parts.findIndex((p) => /^\d{4}-\d{2}$/.test(p));
  const month = monthIdx !== -1 ? parts[monthIdx] : new Date().toISOString().slice(0, 7);
  const nameParts = parts.filter((_, i) => i !== monthIdx);
  const nameFilter = nameParts.length > 0 ? nameParts.join(' ') : undefined;
  return { month, nameFilter };
}

async function replyAsync(url: string, text: string): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_type: 'ephemeral', text }),
  });
}

/** Look up the instructor record for a Slack user ID. */
async function findInstructorBySlackId(slackUserId: string): Promise<{ instructorId: number; email: string } | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${slackUserId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json() as { ok: boolean; user?: { profile?: { email?: string } } };
    if (!data.ok || !data.user?.profile?.email) return null;
    const email = data.user.profile.email.toLowerCase();
    const [row] = await db
      .select({ instructorId: instructors.id })
      .from(instructors)
      .innerJoin(users, eq(instructors.userId, users.id))
      .where(eq(users.email, email));
    return row ? { instructorId: row.instructorId, email } : null;
  } catch {
    return null;
  }
}

/** Generate a draft and DM the result to the requesting instructor with a Send button. */
async function generateAndDM(
  studentName: string,
  month: string,
  slackUserId: string,
  responseUrl: string,
): Promise<void> {
  const appUrl = (process.env.APP_URL ?? 'https://progress.jtlapp.net').replace(/\/$/, '');

  const found = await findReviewByStudentName(studentName, month);
  if ('error' in found) {
    await replyAsync(responseUrl, `:x: ${found.error}`);
    return;
  }

  const { reviewId, studentName: exactName } = found;
  const [yr, mo] = month.split('-');
  const monthLabel = new Date(Date.UTC(parseInt(yr), parseInt(mo) - 1, 15)).toLocaleString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });

  let draft: { body: string };
  try {
    draft = await generateReviewDraft(reviewId);
  } catch (err) {
    await replyAsync(responseUrl, `:x: Generation failed: ${(err as Error).message}`);
    return;
  }

  // Save the draft to the review record
  await db
    .update(monthlyReviews)
    .set({ body: draft.body, status: 'draft', updatedAt: new Date() })
    .where(eq(monthlyReviews.id, reviewId));

  // Slack block text limit is 3000 chars — truncate with a note if needed
  const MAX = 2800;
  const preview = draft.body.length > MAX
    ? draft.body.slice(0, MAX) + `\n\n_(truncated — <${appUrl}/reviews/${reviewId}|view full draft in app>)_`
    : draft.body;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:pencil: *Draft ready: ${exactName} — ${monthLabel}*\n\n${preview}`,
      },
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
            text: { type: 'mrkdwn', text: `This will send the progress report for *${exactName}* to their guardian.` },
            confirm: { type: 'plain_text', text: 'Send it' },
            deny: { type: 'plain_text', text: 'Cancel' },
          },
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Edit in App' },
          url: `${appUrl}/reviews/${reviewId}`,
        },
      ],
    },
  ];

  // DM the instructor who ran the command
  const sent = await sendDMWithBlocks(slackUserId, blocks);
  if (!sent) {
    await replyAsync(responseUrl, `:white_check_mark: Draft generated for *${exactName}*! <${appUrl}/reviews/${reviewId}|View and send in the app>.`);
  } else {
    await replyAsync(responseUrl, `:white_check_mark: Draft ready — check your DMs to review and send.`);
  }
}

async function sendDMWithBlocks(slackUserId: string, blocks: unknown[]): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return false;
  try {
    const convRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: slackUserId }),
    });
    const convData = await convRes.json() as { ok: boolean; channel?: { id: string } };
    if (!convData.ok || !convData.channel?.id) return false;
    const msgRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: convData.channel.id, blocks, text: 'Draft review ready' }),
    });
    const msgData = await msgRes.json() as { ok: boolean };
    return msgData.ok;
  } catch {
    return false;
  }
}

const rawBodyMiddleware = [
  express.raw({ type: 'application/x-www-form-urlencoded' }),
  (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.rawBody = req.body as Buffer;
    const params = new URLSearchParams(req.body.toString());
    req.body = Object.fromEntries(params.entries());
    next();
  },
];

// POST /api/slack/command
slackRouter.post(
  '/slack/command',
  ...rawBodyMiddleware,
  verifySlackSignature,
  (req, res) => {
    const { command, text, response_url, user_id } = req.body as SlackPayload;

    if (!isSlackConfigured()) {
      res.json({ response_type: 'ephemeral', text: ':x: Slack integration is not configured on the server.' });
      return;
    }

    const { month, nameFilter } = parseArgs(text);

    switch (command) {
      case '/student-reports': {
        res.json({ response_type: 'ephemeral', text: ':hourglass: Generating report and posting to channel...' });
        generateComplianceReport(month, true)
          .then(({ text: report }) =>
            replyAsync(response_url, `:white_check_mark: Report posted to #${process.env.SLACK_REVIEWS_CHANNEL ?? 'channel'}.`)
          )
          .catch((err) => replyAsync(response_url, `:x: Failed: ${(err as Error).message}`));
        break;
      }

      case '/remind-instructor': {
        const target = nameFilter ? `instructors matching "${nameFilter}"` : 'all instructors';
        res.json({ response_type: 'ephemeral', text: `:hourglass: Sending reminders to ${target}...` });
        sendMonthlyReminders(month, nameFilter)
          .then(({ sent, notFound, results }) => {
            if (nameFilter && results.length === 0) {
              return replyAsync(response_url, `:grey_question: No instructors found matching "${nameFilter}".`);
            }
            return replyAsync(
              response_url,
              `:white_check_mark: Done — ${sent} DM(s) delivered, ${notFound} instructor(s) not found in Slack.`,
            );
          })
          .catch((err) => replyAsync(response_url, `:x: Failed: ${(err as Error).message}`));
        break;
      }

      case '/reports-status': {
        generateComplianceReport(month, false, nameFilter)
          .then(({ text: report }) => res.json({ response_type: 'ephemeral', text: report }))
          .catch((err) =>
            res.json({ response_type: 'ephemeral', text: `:x: Failed: ${(err as Error).message}` })
          );
        break;
      }

      case '/student-status': {
        if (!nameFilter) {
          res.json({
            response_type: 'ephemeral',
            text: ':x: Please provide a student name. Usage: `/student-status <name> [YYYY-MM]`',
          });
          return;
        }
        res.json({ response_type: 'ephemeral', text: ':hourglass: Looking up student reports…' });
        generateStudentStatusReport(month, nameFilter)
          .then(({ text: report }) => replyAsync(response_url, report))
          .catch((err) => replyAsync(response_url, `:x: Failed: ${(err as Error).message}`));
        break;
      }

      case '/send-report': {
        if (!nameFilter) {
          res.json({
            response_type: 'ephemeral',
            text: ':x: Please provide a student name. Usage: `/send-report <name> [YYYY-MM]`',
          });
          return;
        }
        res.json({ response_type: 'ephemeral', text: `:hourglass: Generating draft for *${nameFilter}* (${month})… check your DMs in ~30 seconds.` });
        generateAndDM(nameFilter, month, user_id, response_url)
          .catch((err) => replyAsync(response_url, `:x: ${(err as Error).message}`));
        break;
      }

      default:
        res.json({
          response_type: 'ephemeral',
          text: `:grey_question: Unknown command \`${command}\`. Available: \`/student-reports [YYYY-MM]\`, \`/remind-instructor [name] [YYYY-MM]\`, \`/reports-status [name] [YYYY-MM]\`, \`/student-status <name> [YYYY-MM]\`, \`/send-report <name> [YYYY-MM]\``,
        });
    }
  },
);

// POST /api/slack/interactive
// Handles Block Kit button clicks (e.g. "Send to Guardian" from /send-report DMs).
slackRouter.post(
  '/slack/interactive',
  ...rawBodyMiddleware,
  verifySlackSignature,
  async (req, res) => {
    let payload: {
      type: string;
      response_url?: string;
      actions?: Array<{ action_id: string; value: string }>;
      user?: { id: string };
    };

    try {
      payload = JSON.parse(req.body.payload as string);
    } catch {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }

    const action = payload.actions?.[0];
    if (!action) { res.json({}); return; }

    if (action.action_id === 'test_review') {
      const reviewId = parseInt(action.value, 10);
      res.json({ text: ':hourglass: Sending test note…' });

      try {
        const row = await loadReviewForSend(reviewId);
        const testPersonId = process.env.PIKE13_TEST_PERSON_ID;

        if (!row.pike13AccessToken) {
          if (payload.response_url) {
            await fetch(payload.response_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: ':x: No Pike13 token found for this review\'s instructor.', replace_original: false }),
            });
          }
          return;
        }

        if (!testPersonId) {
          if (payload.response_url) {
            await fetch(payload.response_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: ':x: PIKE13_TEST_PERSON_ID is not configured.', replace_original: false }),
            });
          }
          return;
        }

        const { sendPike13Note, buildPike13NoteText } = await import('../services/pike13Notes');
        await sendPike13Note({
          accessToken: row.pike13AccessToken,
          studentPike13Id: testPersonId,
          noteText: buildPike13NoteText({
            reviewBody: row.body ?? '',
            studentName: row.studentName,
            month: row.month,
            feedbackToken: row.feedbackToken,
          }),
        });

        if (payload.response_url) {
          await fetch(payload.response_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `:white_check_mark: Test note sent for *${row.studentName}* to the test profile in Pike13.`, replace_original: false }),
          });
        }
      } catch (err) {
        if (payload.response_url) {
          await fetch(payload.response_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `:x: Test failed: ${(err as Error).message}`, replace_original: false }),
          });
        }
      }
      return;
    }

    if (action.action_id === 'send_review') {
      const reviewId = parseInt(action.value, 10);
      res.json({ text: ':hourglass: Sending review to guardian…' });

      try {
        const row = await loadReviewForSend(reviewId);
        if (row.status === 'sent') {
          if (payload.response_url) {
            await fetch(payload.response_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: ':information_source: This review was already sent.', replace_original: true }),
            });
          }
          return;
        }

        await sendReview(reviewId);

        if (payload.response_url) {
          await fetch(payload.response_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: `:white_check_mark: Review for *${row.studentName}* sent to guardian!`,
              replace_original: true,
            }),
          });
        }
      } catch (err) {
        if (payload.response_url) {
          await fetch(payload.response_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `:x: Failed to send: ${(err as Error).message}`, replace_original: false }),
          });
        }
      }
      return;
    }

    res.json({});
  },
);

const jsonRawBodyMiddleware = [
  express.raw({ type: 'application/json' }),
  (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.rawBody = req.body as Buffer;
    try { req.body = JSON.parse(req.body.toString()); } catch { req.body = {}; }
    next();
  },
];

// POST /api/slack/events
// Handles Slack Events API — app_mention triggers the Progress Bot.
slackRouter.post(
  '/slack/events',
  ...jsonRawBodyMiddleware,
  verifySlackSignature,
  (req, res) => {
    const body = req.body as {
      type: string;
      challenge?: string;
      event?: {
        type: string;
        text?: string;
        channel: string;
        ts: string;
        thread_ts?: string;
        bot_id?: string;
      };
    };

    // Slack sends this once to verify the endpoint URL
    if (body.type === 'url_verification') {
      res.json({ challenge: body.challenge });
      return;
    }

    const event = body.event;

    // Ignore messages from bots (including ourselves) to prevent loops
    if (!event || event.bot_id) {
      res.sendStatus(200);
      return;
    }

    if (event.type === 'app_mention') {
      res.sendStatus(200); // Must ack within 3s; process async

      if (!isSlackConfigured()) return;

      // Strip the @mention tag from the message text
      const question = (event.text ?? '').replace(/<@[A-Z0-9]+>/g, '').trim();
      if (!question) return;

      const threadTs = event.thread_ts ?? event.ts;

      handleBotMessage(
        question,
        event.channel,
        threadTs,
        (channel, text, ts) => postSlackMessage(channel, text, ts),
        (channel, blocks, text, ts) => postSlackBlocks(channel, blocks, text, ts),
      ).catch((err) => {
        console.error('[slackBot] error:', err);
        postSlackMessage(event.channel, ':x: Something went wrong. Please try again.', threadTs).catch(() => {});
      });

      return;
    }

    res.sendStatus(200);
  },
);
