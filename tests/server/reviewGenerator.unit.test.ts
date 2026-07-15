import express, { Request, Response } from 'express';
import request from 'supertest';
import { sanitizeGithubUsername, ReviewInputError } from '../../server/src/services/reviewGenerator';
import { errorHandler } from '../../server/src/middleware/errorHandler';

describe('sanitizeGithubUsername', () => {
  it('returns a clean username unchanged', () => {
    expect(sanitizeGithubUsername('jayden0511')).toBe('jayden0511');
  });

  it('strips a trailing human annotation (the Jayden case)', () => {
    // Real prod value that produced "GitHub user \"jayden0511 (PW\" not found"
    expect(sanitizeGithubUsername('jayden0511 (PW: hunter2)')).toBe('jayden0511');
  });

  it('drops a leading @ and trailing note', () => {
    expect(sanitizeGithubUsername('@octocat — main account')).toBe('octocat');
  });

  it('keeps the part before a colon (existing token convention)', () => {
    expect(sanitizeGithubUsername('octocat:ghp_secrettoken')).toBe('octocat');
  });

  it('preserves internal hyphens but not a trailing one', () => {
    expect(sanitizeGithubUsername('some-user-')).toBe('some-user');
  });

  it('returns empty string when nothing valid can be recovered', () => {
    expect(sanitizeGithubUsername('(no github)')).toBe('');
    expect(sanitizeGithubUsername('   ')).toBe('');
  });
});

describe('errorHandler with ReviewInputError', () => {
  const build = () => {
    const app = express();
    app.get('/boom', (_req: Request, _res: Response) => {
      throw new ReviewInputError('GitHub user "jayden0511" not found');
    });
    app.get('/crash', (_req: Request, _res: Response) => {
      throw new Error('secret sql text');
    });
    app.use(errorHandler);
    return app;
  };

  it('exposes actionable 400 message even in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(build()).get('/boom');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('GitHub user "jayden0511" not found');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('hides unexpected 500 details in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(build()).get('/crash');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
