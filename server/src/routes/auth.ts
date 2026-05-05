import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users, instructors, adminSettings, pike13Tokens, pike13AdminToken } from '../db/schema';
import type { SessionUser } from '../types/session';
import { runSync } from '../services/pike13Sync';

export const authRouter = Router();

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
      const appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
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

    // Find or create an active instructor record — anyone who logs in via Pike13 is active
    let [instructorRow] = await db
      .select()
      .from(instructors)
      .where(eq(instructors.userId, userId));

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

    // Redirect to the appropriate frontend page
    const appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
    if (isAdmin) {
      res.redirect(`${appUrl}/admin`);
    } else {
      res.redirect(`${appUrl}/dashboard`);
    }
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
