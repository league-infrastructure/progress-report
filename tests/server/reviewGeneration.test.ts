/**
 * Tests for POST /api/reviews/:id/generate-github-draft — Anthropic API integration
 *
 * Verifies:
 * - 500 with correct message when ANTHROPIC_API_KEY is absent
 * - 200 with {body, commitCount, repoCount} when Anthropic API returns text
 *
 * Uses jest.mock to stub both the database and the Anthropic SDK so the tests
 * run without a real database or live API calls.
 */

import request from 'supertest';
import express from 'express';
import session from 'express-session';
import type { SessionUser } from '../../server/src/types/session';

// ── Anthropic SDK mock ────────────────────────────────────────────────────────
const mockMessagesCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockMessagesCreate },
    })),
  };
});

// ── Database mock ─────────────────────────────────────────────────────────────
// The route calls db.select()...from(monthlyReviews)...innerJoin()... twice
// and db.select()...from(studentAttendance)... once.
// We return minimal data: a row with student+instructor info, and empty attendance.

const INSTRUCTOR_ID = 42;
const STUDENT_ID = 99;
const REVIEW_ID = 7;
const GITHUB_USERNAME = 'octocat';
const MONTH = new Date().toISOString().slice(0, 7);

const FAKE_ROW = {
  review: {
    id: REVIEW_ID,
    studentId: STUDENT_ID,
    instructorId: INSTRUCTOR_ID,
    month: MONTH,
    status: 'pending',
    subject: null,
    body: null,
    sentAt: null,
    feedbackToken: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  studentName: 'Test Student',
  githubUsername: GITHUB_USERNAME,
  guardianName: 'Test Guardian',
  instructorName: 'Test Instructor',
  instructorEmail: 'instr@test.local',
};

// Build a chainable mock query builder that eventually resolves to an array.
function makeQueryMock(resolveWith: unknown[]) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'then'];
  methods.forEach((m) => {
    chain[m] = jest.fn((...args: unknown[]) => {
      // 'then' is the Promise resolution point — call it with the result
      if (m === 'then') {
        const fn = args[0] as (v: unknown[]) => void;
        fn(resolveWith);
        return Promise.resolve(resolveWith);
      }
      return chain;
    });
  });
  return chain;
}

// We need the db mock to return different things on successive calls.
// Call 1 (review + student row): FAKE_ROW array
// Call 2 (attendance): empty array
let dbCallCount = 0;

jest.mock('../../server/src/db', () => {
  return {
    db: {
      select: jest.fn(() => {
        dbCallCount++;
        const resolveWith = dbCallCount === 1 ? [FAKE_ROW] : [];
        return makeQueryMock(resolveWith);
      }),
    },
  };
});

// ── GitHub fetch mock ─────────────────────────────────────────────────────────
// Provide minimal push event data so commit summary is non-empty.
const FAKE_PUSH_EVENT = {
  type: 'PushEvent',
  created_at: new Date().toISOString(),
  repo: { name: `${GITHUB_USERNAME}/my-course` },
  payload: {
    commits: [
      { sha: 'abc1234', message: 'Add loops/exercise solution' },
    ],
  },
};

const FAKE_COMMITS_LIST = [
  { sha: 'abc1234full', commit: { message: 'Add loops/exercise solution' } },
];

const FAKE_COMMIT_DETAIL = {
  stats: { additions: 8, deletions: 1 },
  files: [{ filename: 'lessons/03_loops/exercise.py' }],
};

global.fetch = jest.fn(async (url: string | URL | Request) => {
  const urlStr = String(url);
  if (urlStr.includes('/events')) {
    return new Response(JSON.stringify([FAKE_PUSH_EVENT]), { status: 200 });
  }
  if (urlStr.match(/\/commits\?/) || urlStr.match(/\/commits$/)) {
    return new Response(JSON.stringify(FAKE_COMMITS_LIST), { status: 200 });
  }
  if (urlStr.match(/\/commits\/[a-z0-9]+$/)) {
    return new Response(JSON.stringify(FAKE_COMMIT_DETAIL), { status: 200 });
  }
  return new Response('{}', { status: 404 });
}) as unknown as typeof fetch;

// ── Minimal Express app ───────────────────────────────────────────────────────
function buildTestApp() {
  // Fresh require so mocks are applied
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { reviewsRouter } = require('../../server/src/routes/reviews');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { errorHandler } = require('../../server/src/middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.post('/test/login', (req: express.Request, res: express.Response) => {
    req.session.user = req.body as SessionUser;
    res.json({ ok: true });
  });
  app.use('/api', reviewsRouter);
  app.use(errorHandler);
  return app;
}

function instrUser(id: number): SessionUser {
  return { id: 0, name: 'Test', email: 't@t', isAdmin: false, isActiveInstructor: true, instructorId: id };
}

const ORIGINAL_ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

afterAll(() => {
  process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_KEY;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/reviews/:id/generate-github-draft — Anthropic integration', () => {
  it('returns 500 with correct message when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    dbCallCount = 0;

    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(instrUser(INSTRUCTOR_ID));

    const res = await agent.post(`/api/reviews/${REVIEW_ID}/generate-github-draft`);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('ANTHROPIC_API_KEY is not configured on the server');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('returns 200 with body, commitCount, repoCount when Anthropic returns text', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-abc';
    dbCallCount = 0;
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Excellent progress on loops this month!' }],
    });

    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post('/test/login').send(instrUser(INSTRUCTOR_ID));

    const res = await agent.post(`/api/reviews/${REVIEW_ID}/generate-github-draft`);

    expect(res.status).toBe(200);
    expect(typeof res.body.body).toBe('string');
    expect(res.body.body).toContain('Excellent progress on loops this month!');
    expect(typeof res.body.commitCount).toBe('number');
    expect(typeof res.body.repoCount).toBe('number');
    expect(res.body.repoCount).toBeGreaterThan(0);

    // Verify Anthropic was called with claude-haiku model
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
    );
  });
});
