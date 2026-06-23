import { Request, Response, NextFunction } from 'express';

export function isAuthenticated(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }
  next();
}

export function isAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }
  if (!req.session.user.isAdmin) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

export function isActiveInstructor(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }
  if (!req.session.user.isActiveInstructor) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}
