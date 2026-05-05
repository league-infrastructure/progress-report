/**
 * Shared in-memory SQLite fixture for server-layer tests.
 *
 * Creates an isolated better-sqlite3 in-memory database, applies all
 * Drizzle migrations, and returns the Drizzle client together with the
 * raw SQLite handle so tests can close the connection in afterAll.
 *
 * Usage:
 *   const { sqlite, db } = createTestDb();
 *   afterAll(() => sqlite.close());
 */
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../../server/src/db/schema';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: path.resolve(__dirname, '../../../server/drizzle'),
  });
  return { sqlite, db };
}
