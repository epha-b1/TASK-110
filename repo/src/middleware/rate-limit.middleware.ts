import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest } from './auth.middleware';

/**
 * Rate limiting strategy
 * ----------------------
 *
 * Three distinct limiters cover the observed traffic patterns. Mounting
 * matters — if the limiter runs before auth middleware, req.user is
 * undefined and a per-user key cannot be produced. We therefore split the
 * concerns into separate middlewares so each runs in the right place:
 *
 *   generalLimiter   — broad IP-based safety net applied at app level before
 *                      any authentication happens. Functions as a DoS guard
 *                      and per-IP rate cap for anonymous traffic.
 *
 *   userLimiter      — per-user-id limiter mounted INSIDE each protected
 *                      router, AFTER authMiddleware has populated req.user.
 *                      This is the effective per-account quota that the
 *                      audit report called for.
 *
 *   authLimiter      — strict per-IP throttle for auth endpoints
 *                      (register/login) to slow down brute force. Applied
 *                      in auth.routes.ts directly.
 */

// Global IP-based safety net — runs before auth resolves. Kept lenient so
// it only catches runaway anonymous traffic; per-user granularity is
// provided separately by userLimiter below.
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_GENERAL_IP || '600', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  message: { statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
});

/**
 * Per-user rate-limit key generator. Exported so unit tests can pin the
 * exact bucketing semantics:
 *   - authenticated request → `user:<id>` bucket (the intended path)
 *   - missing/invalid req.user → `ip:<ip>` bucket (fallback for misuse)
 *   - missing IP → `ip:unknown` (defensive)
 *
 * The fallback behavior is preserved on purpose so the limiter never
 * silently disappears when the middleware is mounted out of order — it
 * degrades to per-IP, which is still a real bucket. Mounting order is
 * verified separately by the route smoke test.
 */
export function userLimiterKey(req: { ip?: string }): string {
  const authReq = req as AuthenticatedRequest;
  if (authReq.user?.id) return `user:${authReq.user.id}`;
  return `ip:${req.ip || 'unknown'}`;
}

// Per-authenticated-user limiter. Must be mounted AFTER authMiddleware so
// req.user is populated. If it is accidentally mounted before auth (and
// therefore has no user), it falls back to the IP key — but that is a
// configuration bug, not a silent feature.
export const userLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_USER || '200', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userLimiterKey,
  message: { statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests, please slow down' },
});

// Auth limiter: per-IP brute-force protection.
// Default 30/min; production: set RATE_LIMIT_AUTH=10 for stricter limit.
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AUTH || '30', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { statusCode: 429, code: 'RATE_LIMITED', message: 'Too many auth attempts, please try again later' },
});
