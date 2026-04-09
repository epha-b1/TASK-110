/**
 * Unit tests for production error log sanitization.
 *
 * The global error handler in src/app.ts strips raw error messages and
 * stack traces from both the log entry and the HTTP response body
 * when NODE_ENV=production. These tests build a tiny isolated express
 * app that mirrors the global handler logic and assert that:
 *
 *  - non-prod logs include `stack` and `error`
 *  - prod logs do NOT include `stack` or `error`
 *  - prod responses return generic 500 messages
 *  - non-prod responses surface the underlying error message
 *
 * We use a mirrored handler so the test does not need the full app's
 * route surface or DB. The handler under test is the same shape as
 * the one in src/app.ts.
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { AppError } from '../src/utils/errors';

interface LogEntry { message: string; meta: Record<string, unknown> }

function makeApp(nodeEnv: 'production' | 'development', sink: LogEntry[]) {
  const app = express();
  app.get('/boom', (_req: Request, _res: Response, next: NextFunction) => {
    next(new Error('SECRET_VALUE_LEAK_token=abc123'));
  });
  app.get('/app-error', (_req: Request, _res: Response, next: NextFunction) => {
    next(new AppError(404, 'NOT_FOUND', 'thing not found'));
  });
  const isProd = nodeEnv === 'production';
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        statusCode: err.statusCode, code: err.code, message: err.message, traceId: 'test',
      });
      return;
    }
    sink.push({
      message: 'unhandled_error',
      meta: {
        traceId: 'test',
        errorClass: err.constructor?.name || 'Error',
        ...(isProd ? {} : { error: err.message, stack: err.stack }),
      },
    });
    res.status(500).json({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: isProd ? 'Internal server error' : (err.message || 'Internal server error'),
      traceId: 'test',
    });
  });
  return app;
}

describe('global error handler — sanitization in production', () => {
  test('non-production: response message + log stack include the raw error', async () => {
    const sink: LogEntry[] = [];
    const app = makeApp('development', sink);
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    // Dev: full message exposed
    expect(res.body.message).toContain('SECRET_VALUE_LEAK_token=abc123');

    expect(sink.length).toBe(1);
    expect(sink[0].meta.error).toContain('SECRET_VALUE_LEAK_token=abc123');
    expect(sink[0].meta.stack).toBeDefined();
    expect(sink[0].meta.errorClass).toBe('Error');
  });

  test('production: response carries generic 500, NO secret leak', async () => {
    const sink: LogEntry[] = [];
    const app = makeApp('production', sink);
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(res.body.message).toBe('Internal server error');
    // The raw token must NOT appear anywhere in the response.
    expect(JSON.stringify(res.body)).not.toContain('SECRET_VALUE_LEAK_token=abc123');
  });

  test('production: log entry has NO stack and NO raw error message', async () => {
    const sink: LogEntry[] = [];
    const app = makeApp('production', sink);
    await request(app).get('/boom');
    expect(sink.length).toBe(1);
    expect(sink[0].meta.error).toBeUndefined();
    expect(sink[0].meta.stack).toBeUndefined();
    // But traceability is preserved
    expect(sink[0].meta.traceId).toBe('test');
    expect(sink[0].meta.errorClass).toBe('Error');
  });

  test('AppError path is unchanged in either env (already structured)', async () => {
    for (const env of ['development', 'production'] as const) {
      const sink: LogEntry[] = [];
      const app = makeApp(env, sink);
      const res = await request(app).get('/app-error');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.message).toBe('thing not found');
      // AppError is not logged through the unhandled sink
      expect(sink.length).toBe(0);
    }
  });
});
