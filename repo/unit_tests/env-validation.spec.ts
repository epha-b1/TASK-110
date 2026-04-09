/**
 * Unit tests for production environment validation.
 *
 * The fail-fast validator in src/config/environment.ts is the only
 * thing standing between a misconfigured production deployment and
 * an audit-grade compromise. These tests pin its behavior:
 *
 *  - default JWT_SECRET / ENCRYPTION_KEY → reject
 *  - any value in the KNOWN_WEAK_SECRETS set → reject
 *  - too-short value → reject
 *  - default DB_PASSWORD → reject
 *  - strong values → accept
 */

import { validateProductionConfig, ConfigValidationError } from '../src/config/environment';

function strong(len = 64): string {
  // 'a' x 64 — meets the length floor without being a known weak value
  return 'a'.repeat(len);
}

function baseCfg(over: Partial<any> = {}): any {
  return {
    port: 3000,
    nodeEnv: 'production',
    db: { host: 'db', port: 3306, user: 'app', password: 'StrongDbPassword!', name: 'hospitality' },
    auditMaintainer: { user: null, password: null },
    jwtSecret: strong(),
    encryptionKey: strong(),
    jwtTtl: 28800,
    face: { blinkMin: 100, blinkMax: 500, motionMin: 0.6, textureMin: 0.5 },
    ...over,
  };
}

describe('validateProductionConfig', () => {
  test('passes with strong values', () => {
    expect(validateProductionConfig(baseCfg())).toEqual([]);
  });

  test('rejects default JWT_SECRET', () => {
    const problems = validateProductionConfig(baseCfg({ jwtSecret: 'change_me_in_production' }));
    expect(problems.some((p) => p.includes('JWT_SECRET') && p.includes('insecure default'))).toBe(true);
  });

  test('rejects default ENCRYPTION_KEY', () => {
    const problems = validateProductionConfig(baseCfg({ encryptionKey: 'change_me_32_chars_minimum_here_x' }));
    expect(problems.some((p) => p.includes('ENCRYPTION_KEY') && p.includes('insecure default'))).toBe(true);
  });

  test('rejects empty JWT_SECRET', () => {
    expect(validateProductionConfig(baseCfg({ jwtSecret: '' })).length).toBeGreaterThan(0);
  });

  test('rejects empty ENCRYPTION_KEY', () => {
    expect(validateProductionConfig(baseCfg({ encryptionKey: '' })).length).toBeGreaterThan(0);
  });

  test('rejects short JWT_SECRET (length < 32)', () => {
    const problems = validateProductionConfig(baseCfg({ jwtSecret: 'short-but-not-default-1' }));
    expect(problems.some((p) => p.includes('JWT_SECRET') && p.includes('at least 32'))).toBe(true);
  });

  test('rejects short ENCRYPTION_KEY', () => {
    const problems = validateProductionConfig(baseCfg({ encryptionKey: 'still-too-short-1' }));
    expect(problems.some((p) => p.includes('ENCRYPTION_KEY') && p.includes('at least 32'))).toBe(true);
  });

  test('rejects default DB_PASSWORD', () => {
    const problems = validateProductionConfig(baseCfg({ db: { ...baseCfg().db, password: 'hospitality' } }));
    expect(problems.some((p) => p.includes('DB_PASSWORD'))).toBe(true);
  });

  test('rejects empty DB_PASSWORD', () => {
    const problems = validateProductionConfig(baseCfg({ db: { ...baseCfg().db, password: '' } }));
    expect(problems.some((p) => p.includes('DB_PASSWORD'))).toBe(true);
  });

  test('common weak words are blocked', () => {
    for (const weak of ['secret', 'password', 'changeme', 'test', 'default']) {
      const problems = validateProductionConfig(baseCfg({ jwtSecret: weak }));
      expect(problems.length).toBeGreaterThan(0);
    }
  });

  test('aggregates multiple problems into a single error message', () => {
    const problems = validateProductionConfig(baseCfg({
      jwtSecret: 'change_me_in_production',
      encryptionKey: 'change_me_32_chars_minimum_here_x',
      db: { host: 'db', port: 3306, user: 'app', password: 'hospitality', name: 'h' },
    }));
    expect(problems.length).toBeGreaterThanOrEqual(3);
    const err = new ConfigValidationError(problems);
    expect(err.problems).toEqual(problems);
    expect(err.message).toContain('Insecure production configuration');
    for (const p of problems) expect(err.message).toContain(p);
  });
});

// ─── Module-load fail-fast (production gate) ────────────────────────
describe('environment.ts module load — production fail-fast', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => { jest.resetModules(); });
  afterEach(() => { process.env = { ...savedEnv }; });

  test('throws ConfigValidationError when NODE_ENV=production with default secrets', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'change_me_in_production';
    process.env.ENCRYPTION_KEY = 'change_me_32_chars_minimum_here_x';
    process.env.DB_PASSWORD = 'hospitality';

    // Silence the console.error noise from the fatal banner
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => require('../src/config/environment')).toThrow(/Insecure production configuration/);
    errSpy.mockRestore();
  });

  test('does NOT throw when NODE_ENV=production with strong secrets', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a'.repeat(64);
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    process.env.DB_PASSWORD = 'StrongDbPassword!';
    expect(() => require('../src/config/environment')).not.toThrow();
  });

  test('does NOT throw in development even with default secrets', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'change_me_in_production';
    process.env.ENCRYPTION_KEY = 'change_me_32_chars_minimum_here_x';
    expect(() => require('../src/config/environment')).not.toThrow();
  });
});
