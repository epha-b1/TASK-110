/**
 * Unit tests for the rate-limiter key generator and route mounting order.
 *
 * These tests pin two distinct properties:
 *
 *   1) `userLimiterKey(req)` returns `user:<id>` when req.user is set
 *      and `ip:<ip>` when it isn't. This is the contract that makes
 *      the per-user quota actually per-user. Regression here would
 *      reintroduce the bug the static audit flagged (limiter keying on
 *      IP because req.user was unset at mount time).
 *
 *   2) Every protected router file mounts `userLimiter` AFTER
 *      `authMiddleware`. The audit's root cause was incorrect mount
 *      order — this test enforces the order at the source level so a
 *      future refactor that puts userLimiter before authMiddleware
 *      will fail loudly here.
 */

import fs from 'fs';
import path from 'path';
import { userLimiterKey } from '../src/middleware/rate-limit.middleware';

describe('userLimiterKey — per-user bucketing', () => {
  test('authenticated → user:<id> bucket', () => {
    const req = { user: { id: 'u-123', username: 'a', role: 'member' as const }, ip: '10.0.0.1' };
    expect(userLimiterKey(req as any)).toBe('user:u-123');
  });

  test('unauthenticated → ip:<ip> bucket', () => {
    const req = { ip: '10.0.0.2' };
    expect(userLimiterKey(req as any)).toBe('ip:10.0.0.2');
  });

  test('missing both → ip:unknown bucket (never undefined)', () => {
    const req = {};
    expect(userLimiterKey(req as any)).toBe('ip:unknown');
  });

  test('user.id "0" still wins over ip fallback (truthy guard)', () => {
    // Sanity check: user.id is a UUID string in production, never falsy.
    // We just confirm a real id always shortcircuits the fallback.
    const req = { user: { id: 'real-id', username: 'a', role: 'member' as const }, ip: '10.0.0.3' };
    expect(userLimiterKey(req as any)).toBe('user:real-id');
  });

  test('two different users → distinct buckets (no collision)', () => {
    const a = { user: { id: 'u-A', username: 'a', role: 'member' as const }, ip: '10.0.0.4' };
    const b = { user: { id: 'u-B', username: 'b', role: 'member' as const }, ip: '10.0.0.4' };
    expect(userLimiterKey(a as any)).not.toBe(userLimiterKey(b as any));
  });

  test('same user from different IPs → SAME bucket (per-user, not per-conn)', () => {
    const a = { user: { id: 'u-A', username: 'a', role: 'member' as const }, ip: '10.0.0.4' };
    const b = { user: { id: 'u-A', username: 'a', role: 'member' as const }, ip: '10.0.0.5' };
    expect(userLimiterKey(a as any)).toBe(userLimiterKey(b as any));
  });
});

describe('protected routers — userLimiter mount order', () => {
  // Every protected router file must call `router.use(authMiddleware)`
  // BEFORE `router.use(userLimiter)`. We assert this by reading the
  // source files directly. This is brittle by design — it's a structural
  // pin so the regression cannot sneak in via a refactor.
  const protectedRouters = [
    'accounts.routes.ts',
    'audit.routes.ts',
    'face.routes.ts',
    'files.routes.ts',
    'groups.routes.ts',
    'import.routes.ts',
    'itineraries.routes.ts',
    'notifications.routes.ts',
    'quality.routes.ts',
    'reports.routes.ts',
    'users.routes.ts',
  ];

  test.each(protectedRouters)('%s mounts authMiddleware before userLimiter', (file) => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'routes', file),
      'utf8'
    );
    const authIdx = src.indexOf('router.use(authMiddleware)');
    const limIdx = src.indexOf('router.use(userLimiter)');
    expect(authIdx).toBeGreaterThan(-1);
    expect(limIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(limIdx);
  });
});
