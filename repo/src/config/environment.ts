// dotenv is loaded conditionally for local dev; Docker uses env_file
try { require('dotenv').config(); } catch (_) { /* dotenv not required in production */ }

export interface EnvironmentConfig {
  port: number;
  nodeEnv: string;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
  };
  // Optional elevated credential for the audit-log archive job. When
  // strict DB role grants are enabled in production (REVOKE DELETE from
  // the app user), the archival job needs a credential that still has
  // DELETE privileges on audit_logs. If unset, the archival job falls
  // back to the main pool and relies on the trigger's 1-year window to
  // enforce retention.
  auditMaintainer: {
    user: string | null;
    password: string | null;
  };
  jwtSecret: string;
  encryptionKey: string;
  jwtTtl: number;
  face: {
    blinkMin: number;
    blinkMax: number;
    motionMin: number;
    textureMin: number;
  };
}

// ─── Production secret hardening ─────────────────────────────────────
//
// Anything in this list is considered an "obviously insecure default"
// and MUST NOT be the value of JWT_SECRET or ENCRYPTION_KEY in
// production. The validator below throws on startup if any of these
// strings (or empty/short values) are present when NODE_ENV=production.
//
// The point is to fail-fast at boot, before the API ever serves a
// single request, so that a misconfigured deployment cannot quietly
// run with throwaway credentials.
const KNOWN_WEAK_SECRETS = new Set([
  '',
  'change_me',
  'change_me_in_production',
  'change_me_32_chars_minimum_here_x',
  'changeme',
  'secret',
  'password',
  'default',
  'test',
  'development',
]);

const MIN_JWT_SECRET_LENGTH = 32;
const MIN_ENCRYPTION_KEY_LENGTH = 32;

/** Throws AggregatedConfigError listing every problem so the operator sees them all at once. */
export class ConfigValidationError extends Error {
  public readonly problems: string[];
  constructor(problems: string[]) {
    super(`Insecure production configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
    this.problems = problems;
  }
}

/**
 * Validate the loaded config for production deployment safety.
 *
 * Returns an array of human-readable problems. Empty array = OK. The
 * function is exported so unit tests can exercise it directly without
 * needing to set NODE_ENV.
 */
export function validateProductionConfig(cfg: EnvironmentConfig): string[] {
  const problems: string[] = [];

  if (KNOWN_WEAK_SECRETS.has(cfg.jwtSecret)) {
    problems.push('JWT_SECRET is set to a known insecure default. Generate a strong random value (>= 32 chars).');
  }
  if (cfg.jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long (current: ${cfg.jwtSecret.length}).`);
  }

  if (KNOWN_WEAK_SECRETS.has(cfg.encryptionKey)) {
    problems.push('ENCRYPTION_KEY is set to a known insecure default. Generate a strong random value (>= 32 chars).');
  }
  if (cfg.encryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
    problems.push(`ENCRYPTION_KEY must be at least ${MIN_ENCRYPTION_KEY_LENGTH} characters long (current: ${cfg.encryptionKey.length}).`);
  }

  if (cfg.db.password === '' || cfg.db.password === 'hospitality') {
    problems.push('DB_PASSWORD is empty or the bundled dev default. Set a strong DB password in production.');
  }

  return problems;
}

function loadConfig(): EnvironmentConfig {
  return {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    db: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: process.env.DB_USER || 'hospitality',
      password: process.env.DB_PASSWORD || 'hospitality',
      name: process.env.DB_NAME || 'hospitality',
    },
    auditMaintainer: {
      user: process.env.AUDIT_MAINTAINER_USER || null,
      password: process.env.AUDIT_MAINTAINER_PASSWORD || null,
    },
    jwtSecret: process.env.JWT_SECRET || 'change_me_in_production',
    encryptionKey: process.env.ENCRYPTION_KEY || 'change_me_32_chars_minimum_here_x',
    jwtTtl: parseInt(process.env.JWT_TTL || '28800', 10),
    face: {
      blinkMin: parseInt(process.env.FACE_BLINK_MIN || '100', 10),
      blinkMax: parseInt(process.env.FACE_BLINK_MAX || '500', 10),
      motionMin: parseFloat(process.env.FACE_MOTION_MIN || '0.6'),
      textureMin: parseFloat(process.env.FACE_TEXTURE_MIN || '0.5'),
    },
  };
}

export const config = loadConfig();

// Fail-fast in production. The check is intentionally synchronous and
// at module load time so it cannot be silently bypassed by lazy
// initialization. Tests that import this module under NODE_ENV=test
// or NODE_ENV=development are unaffected.
if (config.nodeEnv === 'production') {
  const problems = validateProductionConfig(config);
  if (problems.length > 0) {
    // Print BEFORE throwing so the operator sees the actionable list
    // even if the process supervisor swallows the exception trace.
    /* eslint-disable no-console */
    console.error('============================================================');
    console.error('FATAL: Insecure production configuration detected.');
    for (const p of problems) console.error('  -', p);
    console.error('============================================================');
    /* eslint-enable no-console */
    throw new ConfigValidationError(problems);
  }
}
