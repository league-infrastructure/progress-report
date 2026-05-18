/**
 * Unit tests for bootstrapAdminIfConfigured.
 *
 * Uses an in-memory SQLite database (via createTestDb) for full isolation.
 * The module-level `db` in adminBootstrap.ts is replaced with the test db
 * via jest.mock so no real database file is required.
 */
import * as schema from '../../server/src/db/schema';
import { createTestDb } from './helpers/db';

// Set up in-memory db before any module under test is imported
const { sqlite, db } = createTestDb();

// Replace the server db module with our in-memory instance
jest.mock('../../server/src/db', () => ({ db }));

// Import after mock is registered
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { bootstrapAdminIfConfigured } = require('../../server/src/utils/adminBootstrap');

afterAll(() => {
  sqlite.close();
});

beforeEach(async () => {
  await db.delete(schema.adminSettings);
  delete process.env.ADMIN_EMAILS;
});

afterEach(async () => {
  await db.delete(schema.adminSettings);
  delete process.env.ADMIN_EMAILS;
});

describe('bootstrapAdminIfConfigured', () => {
  it('inserts a row and returns true when email is in ADMIN_EMAILS', async () => {
    process.env.ADMIN_EMAILS = 'user@example.com';
    const result = await bootstrapAdminIfConfigured('user@example.com');
    expect(result).toBe(true);
    const rows = await db.select().from(schema.adminSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('user@example.com');
  });

  it('is idempotent — second call with same email does not throw and returns true', async () => {
    process.env.ADMIN_EMAILS = 'user@example.com';
    await bootstrapAdminIfConfigured('user@example.com');
    const result = await bootstrapAdminIfConfigured('user@example.com');
    expect(result).toBe(true);
    const rows = await db.select().from(schema.adminSettings);
    expect(rows).toHaveLength(1);
  });

  it('returns false and inserts nothing when email is not in ADMIN_EMAILS', async () => {
    process.env.ADMIN_EMAILS = 'other@example.com';
    const result = await bootstrapAdminIfConfigured('user@example.com');
    expect(result).toBe(false);
    const rows = await db.select().from(schema.adminSettings);
    expect(rows).toHaveLength(0);
  });

  it('returns false when ADMIN_EMAILS is not set', async () => {
    const result = await bootstrapAdminIfConfigured('user@example.com');
    expect(result).toBe(false);
    const rows = await db.select().from(schema.adminSettings);
    expect(rows).toHaveLength(0);
  });

  it('is case-insensitive: ADMIN_EMAILS=User@Example.com matches user@example.com', async () => {
    process.env.ADMIN_EMAILS = 'User@Example.com';
    const result = await bootstrapAdminIfConfigured('user@example.com');
    expect(result).toBe(true);
    const rows = await db.select().from(schema.adminSettings);
    expect(rows).toHaveLength(1);
  });

  it('supports multiple emails: both match, unknown does not', async () => {
    process.env.ADMIN_EMAILS = 'a@x.com, b@x.com';

    const resultA = await bootstrapAdminIfConfigured('a@x.com');
    expect(resultA).toBe(true);

    const resultB = await bootstrapAdminIfConfigured('b@x.com');
    expect(resultB).toBe(true);

    const resultC = await bootstrapAdminIfConfigured('c@x.com');
    expect(resultC).toBe(false);

    const rows = await db.select().from(schema.adminSettings);
    expect(rows).toHaveLength(2);
    const emails = rows.map((r: schema.AdminSetting) => r.email).sort();
    expect(emails).toEqual(['a@x.com', 'b@x.com']);
  });
});
