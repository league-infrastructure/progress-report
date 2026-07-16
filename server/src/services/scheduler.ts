import cron from 'node-cron';
import { isSlackConfigured } from './slack';
import { sendMonthlyReminders } from './slackReminder';
import { runTrainingCheck } from './trainingAlerts';
import { runQuizCompletionCheck } from './quizAlerts';
import { runCommitCheck } from './commitAlerts';
import { syncWithStoredToken } from './pike13Sync';
import { db } from '../db';

export function startScheduler(): void {
  // Day of month to send reminders (default: 25th). Set SLACK_REMIND_DAY to override.
  const day = process.env.SLACK_REMIND_DAY ?? '1';

  // Runs at 9:00 AM UTC on the configured day of every month.
  cron.schedule(`0 9 ${day} * *`, async () => {
    if (!isSlackConfigured()) return;

    const month = new Date().toISOString().slice(0, 7);
    console.log(`[scheduler] Running monthly Slack reminders for ${month}`);

    try {
      const { sent, notFound } = await sendMonthlyReminders(month);
      console.log(`[scheduler] Reminders sent: ${sent}, not found in Slack: ${notFound}`);
    } catch (err) {
      console.error('[scheduler] Monthly Slack reminder failed:', err);
    }
  });

  console.log(`[scheduler] Monthly Slack reminders scheduled for the 1st of each month at 09:00 UTC (day override: SLACK_REMIND_DAY=${day})`);

  // Biweekly staff training compliance check — 1st and 15th at 09:00 UTC.
  // Notifies the admin (in-app + email) of any unmet / expiring / expired /
  // stale trainings.
  cron.schedule('0 9 1,15 * *', async () => {
    console.log('[scheduler] Running biweekly staff training compliance check');
    try {
      const result = await runTrainingCheck();
      console.log(`[scheduler] Training check: ${result.alertCount} alert(s), notified=${result.notified}, emailed=${result.emailed}`);
    } catch (err) {
      console.error('[scheduler] Training compliance check failed:', err);
    }
  });

  console.log('[scheduler] Biweekly training compliance check scheduled for the 1st & 15th at 09:00 UTC');

  // Pike13 sync — Mondays at 08:30 UTC, 30 minutes before the quiz-completion
  // sweep, so this week's schedule (who is scheduled with which student) is
  // fresh when the sweep reads it.
  cron.schedule('30 8 * * 1', async () => {
    console.log('[scheduler] Running pre-sweep Pike13 sync');
    try {
      const sync = await syncWithStoredToken(db);
      if (sync.ok) {
        console.log(`[scheduler] Pike13 sync: students=${sync.result.studentsUpserted}, assignments=${sync.result.assignmentsCreated}`);
      } else {
        console.warn(`[scheduler] Pike13 sync skipped: ${sync.reason}`);
      }
    } catch (err) {
      console.error('[scheduler] Pre-sweep Pike13 sync failed:', err);
    }
  });

  console.log('[scheduler] Pre-sweep Pike13 sync scheduled for Mondays at 08:30 UTC');

  // Weekly quiz-completion sweep — Mondays at 09:00 UTC. DMs each instructor
  // scheduled with a student THIS WEEK if that student has quizzes that are
  // still incomplete, so the quiz is finished before the work is signed off.
  cron.schedule('0 9 * * 1', async () => {
    if (!isSlackConfigured()) return;
    console.log('[scheduler] Running weekly quiz-completion check');
    try {
      const result = await runQuizCompletionCheck();
      console.log(`[scheduler] Quiz check: DMs sent=${result.sent}, not found in Slack=${result.notFound}`);
    } catch (err) {
      console.error('[scheduler] Quiz-completion check failed:', err);
    }
  });

  console.log('[scheduler] Weekly quiz-completion check scheduled for Mondays at 09:00 UTC');

  // Weekly commit check — Mondays at 09:15 UTC (after the sync). DMs each
  // instructor the students they're scheduled with this week who pushed no code
  // last week. New students (<=2 recorded classes) are exempt.
  cron.schedule('15 9 * * 1', async () => {
    if (!isSlackConfigured()) return;
    console.log('[scheduler] Running weekly commit check');
    try {
      const result = await runCommitCheck();
      console.log(`[scheduler] Commit check: DMs sent=${result.sent}, not found in Slack=${result.notFound}`);
    } catch (err) {
      console.error('[scheduler] Commit check failed:', err);
    }
  });

  console.log('[scheduler] Weekly commit check scheduled for Mondays at 09:15 UTC');
}
