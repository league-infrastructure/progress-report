/**
 * Pike13 schema constraint tests.
 *
 * Uses an in-memory SQLite database (better-sqlite3) — no external
 * database or DATABASE_URL environment variable required.
 */
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../server/src/db/schema';

let sqlite: InstanceType<typeof Database>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(() => {
  sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: path.resolve(__dirname, '../../server/drizzle'),
  });
});

afterAll(() => {
  sqlite.close();
});

describe('students pike13SyncId unique constraint', () => {
  it('rejects two students with the same non-null pike13SyncId', async () => {
    await db.insert(schema.students).values({ name: 'Student A', pike13SyncId: 'p13-001' });
    await expect(
      db.insert(schema.students).values({ name: 'Student B', pike13SyncId: 'p13-001' }),
    ).rejects.toThrow();
  });

  it('allows two students both with pike13SyncId = null', async () => {
    await expect(
      Promise.all([
        db.insert(schema.students).values({ name: 'Student C', pike13SyncId: null }),
        db.insert(schema.students).values({ name: 'Student D', pike13SyncId: null }),
      ]),
    ).resolves.toBeDefined();
  });
});

describe('volunteer_hours (source, externalId) unique constraint', () => {
  it('rejects two rows with the same non-null (source, externalId)', async () => {
    await db.insert(schema.volunteerHours).values({
      volunteerName: 'Jane',
      category: 'Teaching',
      hours: 1,
      source: 'pike13',
      externalId: 'ext-001',
    });
    await expect(
      db.insert(schema.volunteerHours).values({
        volunteerName: 'John',
        category: 'Teaching',
        hours: 2,
        source: 'pike13',
        externalId: 'ext-001',
      }),
    ).rejects.toThrow();
  });

  it('allows two rows both with externalId = null', async () => {
    await expect(
      Promise.all([
        db.insert(schema.volunteerHours).values({
          volunteerName: 'Alice',
          category: 'Events',
          hours: 1,
          source: 'manual',
          externalId: null,
        }),
        db.insert(schema.volunteerHours).values({
          volunteerName: 'Bob',
          category: 'Events',
          hours: 1,
          source: 'manual',
          externalId: null,
        }),
      ]),
    ).resolves.toBeDefined();
  });
});

describe('pike13_admin_token table', () => {
  it('inserts and retrieves a token row', async () => {
    const [token] = await db
      .insert(schema.pike13AdminToken)
      .values({ accessToken: 'admin-token-abc' })
      .returning();
    expect(token.id).toBeDefined();
    expect(token.accessToken).toBe('admin-token-abc');
    expect(token.refreshToken).toBeNull();
    expect(token.expiresAt).toBeNull();
    expect(token.updatedAt).toBeInstanceOf(Date);
  });

  it('stores refreshToken and expiresAt when provided', async () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    const [token] = await db
      .insert(schema.pike13AdminToken)
      .values({ accessToken: 'tok-xyz', refreshToken: 'ref-xyz', expiresAt })
      .returning();
    expect(token.refreshToken).toBe('ref-xyz');
    expect(token.expiresAt).toBeInstanceOf(Date);
  });
});
