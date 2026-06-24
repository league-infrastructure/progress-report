import { Router } from 'express';
import { eq, asc, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, instructors, adminSettings, pike13Tokens, pike13AdminToken, students, instructorStudents } from '../db/schema';
import type { SessionUser, QuizSessionUser } from '../types/session';
import { runSync } from '../services/pike13Sync';

export const authRouter = Router();

// DEV-ONLY login: seeds a test instructor + students and a staff quiz session so
// the quiz features can be exercised locally WITHOUT the Pike13 production OAuth
// round-trip. Never registered when NODE_ENV=production.
if (process.env.NODE_ENV !== 'production') {
  authRouter.post('/dev-login', async (req, res, next) => {
    try {
      const role: 'admin' | 'instructor' =
        (req.body?.role as string) === 'admin' ? 'admin' : 'instructor';
      const devEmail = 'dev-instructor@jointheleague.org';

      let userRow = (await db.select().from(users).where(eq(users.email, devEmail)))[0];
      if (!userRow) {
        userRow = (await db.insert(users).values({ email: devEmail, name: 'Dev Instructor' }).returning())[0];
      }

      let instructorRow = (await db.select().from(instructors).where(eq(instructors.userId, userRow.id)))[0];
      if (!instructorRow) {
        instructorRow = (await db.insert(instructors).values({ userId: userRow.id, isActive: true }).returning())[0];
      } else if (!instructorRow.isActive) {
        await db.update(instructors).set({ isActive: true }).where(eq(instructors.id, instructorRow.id));
      }

      const devStudents = [
        { name: 'Ada Lovelace', githubUsername: 'ada-lovelace', pike13SyncId: 'dev-student-ada' },
        { name: 'Alan Turing', githubUsername: 'alan-turing', pike13SyncId: 'dev-student-alan' },
      ];
      for (const s of devStudents) {
        let stu = (await db.select().from(students).where(eq(students.pike13SyncId, s.pike13SyncId)))[0];
        if (!stu) {
          stu = (await db.insert(students).values(s).returning())[0];
        }
        await db
          .insert(instructorStudents)
          .values({ instructorId: instructorRow.id, studentId: stu.id })
          .onConflictDoNothing();
      }

      const isAdmin = role === 'admin';
      const sessionUser: SessionUser = {
        id: userRow.id,
        name: isAdmin ? 'Dev Admin' : 'Dev Instructor',
        email: devEmail,
        isAdmin,
        isActiveInstructor: true,
        instructorId: instructorRow.id,
      };
      req.session.user = sessionUser;
      const quizUser: QuizSessionUser = { role, instructorId: instructorRow.id };
      req.session.quizUser = quizUser;

      res.json({ ok: true, role });
    } catch (err) {
      next(err);
    }
  });
}

function resolveAppUrl() {
  const appDomain = process.env.APP_DOMAIN?.trim();
  if (!appDomain) {
    throw new Error('APP_DOMAIN is required for auth redirects');
  }

  const isLocalhost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(appDomain);
  return `${isLocalhost ? 'http' : 'https'}://${appDomain}`;
}

// GET /api/auth/pike13 — redirect to Pike13 OAuth authorization
authRouter.get('/pike13', (_req, res) => {
  const clientId = process.env.PIKE13_CLIENT_ID;
  const callbackUrl = process.env.PIKE13_CALLBACK_URL;
  if (!clientId || !callbackUrl) {
    res.status(500).json({ error: 'Pike13 OAuth is not configured' });
    return;
  }
  const authUrl =
    `https://pike13.com/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&response_type=code`;
  res.redirect(authUrl);
});

// GET /api/auth/pike13/callback — exchange code, resolve identity, create session
authRouter.get('/pike13/callback', async (req, res, next) => {
  try {
    const code = req.query.code as string | undefined;
    if (!code) {
      res.status(400).json({ error: 'Missing code parameter' });
      return;
    }

    // Exchange authorization code for access token
    const tokenRes = await fetch('https://pike13.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.PIKE13_CLIENT_ID,
        client_secret: process.env.PIKE13_CLIENT_SECRET,
        redirect_uri: process.env.PIKE13_CALLBACK_URL,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      res.status(502).json({ error: 'Failed to exchange code with Pike13' });
      return;
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const accessToken = tokenData.access_token;

    // Fetch the authenticated user's profile from Pike13.
    // PIKE13_API_BASE is the tenant API root (e.g. https://jtl.pike13.com/api/v2/desk);
    // we want just the origin so we can hit /api/v2/front/people/me and /api/v2/me.
    const apiBase = process.env.PIKE13_API_BASE ?? 'https://pike13.com';
    const base = new URL(apiBase).origin;

    // Try /api/v2/front/people/me first, fall back to /api/v2/me
    let profileRes = await fetch(`${base}/api/v2/front/people/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      profileRes = await fetch(`${base}/api/v2/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }

    if (!profileRes.ok) {
      const body = await profileRes.text();
      console.error(`[auth] Pike13 profile fetch failed: ${profileRes.status} ${body}`);
      res.status(502).json({ error: 'Failed to fetch Pike13 profile', detail: `${profileRes.status}: ${body}` });
      return;
    }

    const profileData = (await profileRes.json()) as {
      person?: { id: number; name: string; email?: string };
      people?: Array<{ id: number; name: string; email?: string }>;
    };
    const person = profileData.person ?? profileData.people?.[0];
    if (!person) {
      res.status(502).json({ error: 'Unexpected Pike13 profile response shape' });
      return;
    }
    const { name, email } = person;

    if (!email) {
      res.status(403).json({ error: 'Pike13 account has no email address' });
      return;
    }

    const normalizedEmail = email.toLowerCase();

    if (!normalizedEmail.endsWith('@jointheleague.org')) {
      const appUrl = resolveAppUrl();
      res.redirect(`${appUrl}/login?error=denied`);
      return;
    }

    // Find or create a local user record matched by email
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail));

    let userId: number;
    if (existingUser) {
      userId = existingUser.id;
      if (existingUser.name !== name) {
        await db.update(users).set({ name }).where(eq(users.id, userId));
      }
    } else {
      const [newUser] = await db
        .insert(users)
        .values({ email: normalizedEmail, name })
        .returning({ id: users.id });
      userId = newUser.id;
    }

    // Determine roles
    const [adminRow] = await db
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.email, normalizedEmail));
    const isAdmin = !!adminRow;

    // Find or create an active instructor record — anyone who logs in via Pike13 is active.
    // Order by id ASC so we always pick the lowest-ID (first-created) record, which matches
    // what the sync uses when building its emailToInstructorId map.
    let [instructorRow] = await db
      .select()
      .from(instructors)
      .where(eq(instructors.userId, userId))
      .orderBy(asc(instructors.id));

    if (!instructorRow) {
      const [newInstructor] = await db
        .insert(instructors)
        .values({ userId, isActive: true })
        .returning();
      instructorRow = newInstructor;
    } else if (!instructorRow.isActive) {
      await db
        .update(instructors)
        .set({ isActive: true })
        .where(eq(instructors.id, instructorRow.id));
      instructorRow = { ...instructorRow, isActive: true };
    }

    // Save the instructor's Pike13 token (upsert by instructorId)
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;
    await db
      .insert(pike13Tokens)
      .values({
        instructorId: instructorRow.id,
        accessToken,
        refreshToken: tokenData.refresh_token ?? null,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: pike13Tokens.instructorId,
        set: {
          accessToken,
          refreshToken: tokenData.refresh_token ?? null,
          expiresAt,
          updatedAt: new Date(),
        },
      });

    // If admin, automatically store token as the global admin sync token
    if (isAdmin) {
      await db.delete(pike13AdminToken);
      await db.insert(pike13AdminToken).values({
        accessToken,
        refreshToken: tokenData.refresh_token ?? null,
        expiresAt,
      });
    }

    // Trigger a Pike13 data sync in the background using this user's token
    runSync(db, accessToken).catch((err: unknown) =>
      console.error('[auth] pike13 auto-sync failed:', err),
    );

    const sessionUser: SessionUser = {
      id: userId,
      name,
      email: normalizedEmail,
      isAdmin,
      isActiveInstructor: true,
      instructorId: instructorRow.id,
    };
    req.session.user = sessionUser;

    // Also set a quizUser session for staff (instructor or admin).
    // Optionally honour comma-separated email allowlists in env vars.
    const adminAllowlist = (process.env.ADMIN_ALLOWLIST ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const instructorAllowlist = (process.env.INSTRUCTOR_ALLOWLIST ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const isAllowlistAdmin =
      adminAllowlist.length > 0 && adminAllowlist.includes(normalizedEmail);
    const isAllowlistInstructor =
      instructorAllowlist.length > 0 && instructorAllowlist.includes(normalizedEmail);

    const effectiveAdmin = isAdmin || isAllowlistAdmin;
    const effectiveInstructor = instructorRow.isActive || isAllowlistInstructor;

    let quizRole: 'admin' | 'instructor' | undefined;
    if (effectiveAdmin) {
      quizRole = 'admin';
    } else if (effectiveInstructor) {
      quizRole = 'instructor';
    }

    if (quizRole) {
      const quizUser: QuizSessionUser = {
        role: quizRole,
        instructorId: instructorRow.id,
      };
      req.session.quizUser = quizUser;
    }

    // Redirect to the appropriate frontend page
    const appUrl = resolveAppUrl();
    if (isAdmin) {
      res.redirect(`${appUrl}/admin`);
    } else {
      res.redirect(`${appUrl}/dashboard`);
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/github — redirect to GitHub OAuth authorization
authRouter.get('/github', (_req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const appDomain = process.env.APP_DOMAIN?.trim();
  if (!clientId || !appDomain) {
    res.status(503).json({ error: 'GitHub OAuth is not configured (missing GITHUB_CLIENT_ID or APP_DOMAIN)' });
    return;
  }
  const isLocalhost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(appDomain);
  const baseUrl = `${isLocalhost ? 'http' : 'https'}://${appDomain}`;
  const callbackUrl = `${baseUrl}/api/auth/github/callback`;
  const authUrl =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&scope=read:user`;
  res.redirect(authUrl);
});

// GET /api/auth/github/callback — exchange code, resolve student identity, create quiz session
authRouter.get('/github/callback', async (req, res, next) => {
  try {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      res.status(503).json({ error: 'GitHub OAuth is not configured (missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET)' });
      return;
    }

    const code = req.query.code as string | undefined;
    if (!code) {
      res.status(400).json({ error: 'Missing code parameter' });
      return;
    }

    const appDomain = process.env.APP_DOMAIN?.trim();
    if (!appDomain) {
      res.status(503).json({ error: 'APP_DOMAIN is required for auth redirects' });
      return;
    }
    const isLocalhost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(appDomain);
    const baseUrl = `${isLocalhost ? 'http' : 'https'}://${appDomain}`;
    const callbackUrl = `${baseUrl}/api/auth/github/callback`;

    // Exchange authorization code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: callbackUrl,
      }),
    });

    if (!tokenRes.ok) {
      res.status(502).json({ error: 'Failed to exchange code with GitHub' });
      return;
    }

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenData.access_token) {
      console.error('[auth] GitHub token exchange error:', tokenData);
      res.status(502).json({ error: 'GitHub OAuth token exchange failed', detail: tokenData.error_description ?? tokenData.error });
      return;
    }

    // Fetch the authenticated user's GitHub profile
    const profileRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!profileRes.ok) {
      res.status(502).json({ error: 'Failed to fetch GitHub user profile' });
      return;
    }

    const profile = (await profileRes.json()) as {
      login: string;
      name?: string | null;
      id: number;
    };

    const githubLogin = profile.login;
    const displayName = profile.name ?? githubLogin;

    // Find a students row where githubUsername matches (case-insensitive)
    const allMatches = await db
      .select()
      .from(students)
      .where(sql`lower(${students.githubUsername}) = lower(${githubLogin})`);

    let studentId: number;

    if (allMatches.length > 0) {
      studentId = allMatches[0].id;
    } else {
      // Create a minimal student record
      const [newStudent] = await db
        .insert(students)
        .values({ name: displayName, githubUsername: githubLogin })
        .returning({ id: students.id });
      studentId = newStudent.id;
    }

    // Set quiz session — do NOT touch req.session.user
    const quizUser: QuizSessionUser = {
      role: 'student',
      studentId,
      githubLogin,
    };
    req.session.quizUser = quizUser;

    res.redirect(`${baseUrl}/quiz/dashboard`);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
authRouter.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.json({ ok: true });
  });
});

// GET /api/auth/me
authRouter.get('/me', (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }
  res.json(req.session.user);
});
