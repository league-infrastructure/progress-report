import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as schema from './schema';

const dbUrl = process.env.DATABASE_URL ?? 'file:./data/dev.db';
const dbPath = dbUrl.replace(/^file:/, '');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const sqlite: DatabaseType = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });
