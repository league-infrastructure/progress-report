import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env from project root when running locally (not in Docker).
// In Docker, env vars are set by compose/entrypoint.
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import session from 'express-session';
import BetterSQLite3Store from 'better-sqlite3-session-store';
import { sqlite } from './db';
import { healthRouter } from './routes/health';
import { counterRouter } from './routes/counter';
import { authRouter } from './routes/auth';
import { instructorRouter } from './routes/instructor';
import { reviewsRouter } from './routes/reviews';
import { templatesRouter } from './routes/templates';
import { checkinsRouter } from './routes/checkins';
import { adminRouter } from './routes/admin';
import { volunteerHoursRouter } from './routes/volunteer-hours';
import { feedbackRouter } from './routes/feedback';
import { errorHandler } from './middleware/errorHandler';
import { startScheduler } from './services/scheduler';
import { slackRouter } from './routes/slack';
import { quizRouter } from './routes/quiz';
import { seedQuiz } from './db/seed-quiz';
import type { SessionUser } from './types/session';

// Test personas used by POST /api/auth/login in test mode
const TEST_USERS: Record<string, SessionUser> = {
  admin: { id: 0, name: 'Test Admin', email: 'admin@test.local', isAdmin: true, isActiveInstructor: false },
  instructor: { id: 1, name: 'Test Instructor', email: 'instructor@test.local', isAdmin: false, isActiveInstructor: true, instructorId: 1 },
  inactive: { id: 2, name: 'Inactive User', email: 'inactive@test.local', isAdmin: false, isActiveInstructor: false },
};

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

// Behind the Caddy reverse proxy in production, trust the proxy so secure
// cookies and req.protocol reflect the original HTTPS request.
if (isProduction) {
  app.set('trust proxy', 1);
}

// Restrict CORS to an explicit allowlist. The SPA is served same-origin in
// every environment (Vite proxies /api in dev; Express serves the built app in
// prod), so cross-origin access is opt-in via ALLOWED_ORIGINS only. With no
// allowlist configured, no cross-origin requests are permitted.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  }),
);

// Slack slash-command route must be mounted before express.json() so it can
// capture the raw body for signature verification (Slack signs the raw bytes).
app.use('/api', slackRouter);

app.use(express.json());
app.use(pinoHttp({ level: process.env.LOG_LEVEL || 'info' }));

// Session store: SQLiteStore for persistent sessions across server restarts.
// In test mode fall back to MemoryStore to avoid file-system side effects.
const SQLiteStore = BetterSQLite3Store(session);
const sessionStore =
  process.env.NODE_ENV !== 'test'
    ? new SQLiteStore({ client: sqlite })
    : undefined; // express-session defaults to MemoryStore

// Fail closed: never sign production sessions with the well-known dev fallback,
// which would let anyone forge session cookies.
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && isProduction) {
  throw new Error('SESSION_SECRET must be set in production');
}

app.use(
  session({
    store: sessionStore,
    secret: sessionSecret || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction, // HTTPS-only cookie in production (served via Caddy)
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }),
);

// Test-only login endpoint: accepts { role } and creates a session with a test persona.
// Only available in test mode (NODE_ENV=test) so it is never exposed in production.
if (process.env.NODE_ENV === 'test') {
  app.post('/api/auth/login', (req, res) => {
    const { role } = req.body as { role?: string };
    const user = role ? TEST_USERS[role] : undefined;
    if (!user) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
    req.session.user = user;
    res.json(user);
  });
}

app.use('/api', healthRouter);
app.use('/api', counterRouter);
app.use('/api/auth', authRouter);
// Mount quiz routes BEFORE the routers that apply router-level guards
// (checkinsRouter -> isActiveInstructor, adminRouter -> isAdmin). Those run for
// any /api/* request that passes through them, so mounting quiz later would
// 403 every non-admin quiz request before it reaches its own role guards.
app.use('/api/quiz', quizRouter);
app.use('/api', instructorRouter);
app.use('/api', reviewsRouter);
app.use('/api', templatesRouter);
app.use('/api', checkinsRouter);
app.use('/api', adminRouter);
app.use('/api', volunteerHoursRouter);
app.use('/api', feedbackRouter);

app.use(errorHandler);

// In production, serve the built React app from /app/public.
// All non-API routes fall through to index.html for SPA routing.
if (process.env.NODE_ENV === 'production') {
  const publicDir = path.resolve(__dirname, '../public');
  app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// Only start listening when run directly (not imported by tests)
if (require.main === module) {
  seedQuiz().catch((err: unknown) =>
    console.error('[startup] quiz seed failed:', err),
  );
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
  startScheduler();
}

export default app;
