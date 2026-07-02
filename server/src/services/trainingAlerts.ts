/**
 * Compute which staff trainings need attention: not met, or expiring within a
 * renewal window. Shared by the alerts endpoint and the notify-check.
 */
import { eq, asc } from 'drizzle-orm';
import { db } from '../db';
import { staffProfiles, trainingTypes, staffTrainings } from '../db/schema';

export const DEFAULT_RENEWAL_WINDOW_DAYS = 30;

export type AlertReason = 'not_met' | 'expiring' | 'expired';

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

/**
 * Returns alerts across all ACTIVE staff for all ACTIVE trainings. A staff/
 * training with no record yet is treated as not-met. Reasons:
 *   - not_met:   met === false (or no record)
 *   - expired:   met but expiresAt is in the past
 *   - expiring:  met but expiresAt within the renewal window
 */
export async function computeTrainingAlerts(now = new Date()): Promise<TrainingAlert[]> {
  const windowMs = renewalWindowDays() * 24 * 60 * 60 * 1000;
  const soon = new Date(now.getTime() + windowMs);

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
      a.reason === 'not_met' ? 'NOT MET' : a.reason === 'expired' ? 'EXPIRED' : 'EXPIRING SOON';
    return `- ${a.staffName} — ${a.trainingName}: ${label}${when}`;
  });
  return `${alerts.length} training item(s) need attention:\n${lines.join('\n')}`;
}
