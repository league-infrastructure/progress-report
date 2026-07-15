import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error & { status?: number; expose?: boolean },
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error(err);

  // Errors carrying an explicit `status` are deliberate, user-actionable
  // errors (e.g. "GitHub user not found", "No push activity this month").
  // Their message is safe to show and — crucially — tells the instructor what
  // to fix, so honor it even in production. Everything else is treated as an
  // unexpected fault: generic message in production to avoid leaking internals
  // (SQL text, file paths); the full error is still logged server-side above.
  const status = typeof err.status === 'number' ? err.status : 500;
  const isProduction = process.env.NODE_ENV === 'production';
  const exposeMessage = status < 500 || !isProduction;
  res.status(status).json({
    error: exposeMessage ? err.message || 'Internal server error' : 'Internal server error',
  });
}
