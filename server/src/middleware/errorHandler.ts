import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error(err);
  // Avoid leaking internal error details (SQL text, file paths) to clients in
  // production; the full error is still logged server-side above.
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: isProduction ? 'Internal server error' : err.message || 'Internal server error',
  });
}
