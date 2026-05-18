import { db } from '../db';
import { adminSettings } from '../db/schema';

export async function bootstrapAdminIfConfigured(email: string): Promise<boolean> {
  const raw = process.env.ADMIN_EMAILS ?? '';
  const adminEmails = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!adminEmails.includes(email.toLowerCase())) return false;
  await db.insert(adminSettings).values({ email }).onConflictDoNothing();
  return true;
}
