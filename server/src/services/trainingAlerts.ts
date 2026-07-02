/**
 * Compute which staff trainings need attention: not met, or expiring within a
 * renewal window. Shared by the alerts endpoint and the notify-check.
 */
import { eq, asc } from 'drizzle-orm';
import sgMail from '@sendgrid/mail';
import { db } from '../db';
import { staffProfiles, trainingTypes, staffTrainings, adminNotifications, adminSettings } from '../db/schema';

export const DEFAULT_RENEWAL_WINDOW_DAYS = 30;
export const DEFAULT_STALE_MONTHS = 12;

export type AlertReason = 'not_met' | 'expiring' | 'expired' | 'stale';

export interface TrainingAlert {
  staffProfileId: number;
  staffName: string;
  staffKind: string;
  trainingTypeId: number;
  trainingName: string;
  met: boolean;
  expiresAt: Date | null;
  driveUrl: string | null;
  reason: AlertReason;
}

function renewalWindowDays(): number {
  const raw = Number(process.env.TRAINING_RENEWAL_WINDOW_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RENEWAL_WINDOW_DAYS;
}

// How many months after a training was last marked "met" (with NO expiry date
// set) before it should be flagged for review. Fallback so date-less trainings
// don't silently stay "current" forever.
function staleMonths(): number {
  const raw = Number(process.env.TRAINING_STALE_MONTHS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_MONTHS;
}

/**
 * Returns alerts across all ACTIVE staff for all ACTIVE trainings. A staff/
 * training with no record yet is treated as not-met. Reasons:
 *   - not_met:   met === false (or no record)
 *   - expired:   met but expiresAt is in the past
 *   - expiring:  met but expiresAt within the renewal window
 *   - stale:     met, NO expiry date set, and last updated > stale window ago
 *                (fallback so date-less trainings still get reviewed)
 */
export async function computeTrainingAlerts(now = new Date()): Promise<TrainingAlert[]> {
  const windowMs = renewalWindowDays() * 24 * 60 * 60 * 1000;
  const soon = new Date(now.getTime() + windowMs);
  const staleBefore = new Date(now);
  staleBefore.setMonth(staleBefore.getMonth() - staleMonths());

  const staff = await db.select().from(staffProfiles).where(eq(staffProfiles.active, true)).orderBy(asc(staffProfiles.name));
  const types = await db.select().from(trainingTypes).where(eq(trainingTypes.active, true)).orderBy(asc(trainingTypes.order));
  const records = await db.select().from(staffTrainings);
  const byKey = new Map(records.map((r) => [`${r.staffProfileId}:${r.trainingTypeId}`, r]));

  const alerts: TrainingAlert[] = [];
  for (const s of staff) {
    for (const t of types) {
      const rec = byKey.get(`${s.id}:${t.id}`);
      const met = rec?.met ?? false;
      const expiresAt = rec?.expiresAt ?? null;
      let reason: AlertReason | null = null;
      if (!met) {
        reason = 'not_met';
      } else if (expiresAt) {
        if (expiresAt < now) reason = 'expired';
        else if (expiresAt <= soon) reason = 'expiring';
      } else if (rec && rec.updatedAt < staleBefore) {
        // met, no expiry date, and it's been a long time since marked met.
        reason = 'stale';
      }
      if (reason) {
        alerts.push({
          staffProfileId: s.id,
          staffName: s.name,
          staffKind: s.kind,
          trainingTypeId: t.id,
          trainingName: t.name,
          met,
          expiresAt,
          driveUrl: rec?.driveUrl ?? null,
          reason,
        });
      }
    }
  }
  return alerts;
}

export function summarizeAlerts(alerts: TrainingAlert[]): string {
  if (alerts.length === 0) return 'All staff trainings are current.';
  const lines = alerts.map((a) => {
    const when = a.expiresAt ? ` (expires ${a.expiresAt.toISOString().slice(0, 10)})` : '';
    const label =
      a.reason === 'not_met' ? 'NOT MET'
      : a.reason === 'expired' ? 'EXPIRED'
      : a.reason === 'stale' ? 'REVIEW (no expiry set, overdue)'
      : 'EXPIRING SOON';
    return `- ${a.staffName} — ${a.trainingName}: ${label}${when}`;
  });
  return `${alerts.length} training item(s) need attention:\n${lines.join('\n')}`;
}

export interface TrainingCheckResult {
  alertCount: number;
  notified: boolean;
  emailed: boolean;
}

/**
 * Run the training compliance check: compute alerts and, if any, create an
 * admin notification + send a summary email to all admin_settings emails.
 * Shared by the on-demand admin route and the scheduled job.
 */
export async function runTrainingCheck(now = new Date()): Promise<TrainingCheckResult> {
  const alerts = await computeTrainingAlerts(now);
  if (alerts.length === 0) return { alertCount: 0, notified: false, emailed: false };

  const summary = summarizeAlerts(alerts);
  await db.insert(adminNotifications).values({ message: summary, isRead: false });

  let emailed = false;
  const from = process.env.SENDGRID_FROM_EMAIL;
  if (process.env.SENDGRID_API_KEY && from) {
    const adminEmails = (await db.select({ email: adminSettings.email }).from(adminSettings))
      .map((r) => r.email)
      .filter(Boolean);
    if (adminEmails.length > 0) {
      try {
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        await sgMail.send({
          to: adminEmails,
          from,
          subject: `[LEAGUE] Staff training compliance — ${alerts.length} item(s) need attention`,
          text: summary,
        });
        emailed = true;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[trainings-check] email failed:', e);
      }
    }
  }
  return { alertCount: alerts.length, notified: true, emailed };
}
