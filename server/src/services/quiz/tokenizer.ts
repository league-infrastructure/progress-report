import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { quizAssignmentTokens } from '../../db/schema';

// Tokenized assignment links (Quiz-App/SPEC.md §4, §6.2).
// A link lets a student take one assigned quiz with no account; expires after
// DEFAULT_EXPIRY_DAYS and is single-use.

export const DEFAULT_EXPIRY_DAYS = 30;

export class TokenError extends Error {
  status: number;
  constructor(message: string, status = 410) {
    super(message);
    this.name = 'TokenError';
    this.status = status;
  }
}
export class TokenNotFoundError extends TokenError {
  constructor() {
    super('Assignment link not found', 404);
    this.name = 'TokenNotFoundError';
  }
}
export class TokenExpiredError extends TokenError {
  constructor() {
    super('Assignment link has expired', 410);
    this.name = 'TokenExpiredError';
  }
}
export class TokenConsumedError extends TokenError {
  constructor() {
    super('Assignment link has already been used', 410);
    this.name = 'TokenConsumedError';
  }
}

/** Create a unique, expiring link for a quiz. Returns the token string. */
export function mintToken(quizId: number, expiresInDays: number = DEFAULT_EXPIRY_DAYS): string {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  db.insert(quizAssignmentTokens).values({ quizId, token, expiresAt }).run();
  return token;
}

/** Resolve a token to its quiz id, throwing TokenError subclasses when invalid. */
export function resolveToken(token: string): { quizId: number } {
  const row = db
    .select()
    .from(quizAssignmentTokens)
    .where(eq(quizAssignmentTokens.token, token))
    .get();
  if (!row) throw new TokenNotFoundError();
  if (row.consumedAt) throw new TokenConsumedError();
  if (row.expiresAt.getTime() < Date.now()) throw new TokenExpiredError();
  return { quizId: row.quizId };
}

/** Mark a token used so the link can't be replayed. */
export function consumeToken(token: string): void {
  db.update(quizAssignmentTokens)
    .set({ consumedAt: new Date() })
    .where(eq(quizAssignmentTokens.token, token))
    .run();
}
