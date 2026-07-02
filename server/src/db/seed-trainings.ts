/**
 * Seed the default catalog of required staff trainings. Idempotent — safe to
 * run on every boot. New trainings can be added here or via the admin API.
 */
import { db } from './index';
import { trainingTypes } from './schema';

const DEFAULT_TRAININGS: Array<{ name: string; description: string; order: number }> = [
  {
    name: 'AB 506 Mandated Reporter',
    description: 'California AB 506 mandated-reporter training for youth-serving organizations.',
    order: 1,
  },
  {
    name: 'Background Check / LiveScan',
    description: 'Completed background check / DOJ LiveScan fingerprinting.',
    order: 2,
  },
  {
    name: 'Child Abuse Prevention',
    description: 'Child abuse prevention and safety training.',
    order: 3,
  },
];

export async function seedTrainings(): Promise<void> {
  for (const t of DEFAULT_TRAININGS) {
    await db
      .insert(trainingTypes)
      .values({ name: t.name, description: t.description, order: t.order, active: true })
      .onConflictDoNothing({ target: trainingTypes.name });
  }
}
