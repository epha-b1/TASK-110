import request from 'supertest';
import app from '../src/app';
import { sequelize } from '../src/config/database';
import { describeDb } from './db-guard';

// These tests require a running MySQL database (run inside Docker)
const TEST_USER = { username: `testuser_${Date.now()}`, password: 'TestPass1!xx' };

let authToken: string;

describeDb('Slice 2 — Auth API', () => {
  beforeAll(async () => {
    // Wait for DB connection
    await sequelize.authenticate();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('POST /auth/register', () => {
    test('201 — creates user', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send(TEST_USER);
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.username).toBe(TEST_USER.username);
      expect(res.body.role).toBe('member');
    });

    test('409 — duplicate username', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send(TEST_USER);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
    });

    test('400 — password too short', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ username: 'shortpw', password: 'Ab1!' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    test('400 — password missing number', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ username: 'nonumber', password: 'Abcdefghij!' });
      expect(res.status).toBe(400);
    });

    test('400 — password missing symbol', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ username: 'nosymbol', password: 'Abcdefghij1' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/login', () => {
    test('200 — returns accessToken', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send(TEST_USER);
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.username).toBe(TEST_USER.username);
      authToken = res.body.accessToken;
    });

    test('401 — wrong password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username: TEST_USER.username, password: 'WrongPass1!xx' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    test('423 — after 5 failed attempts', async () => {
      const lockUser = {
        username: `locktest_${Date.now()}`,
        password: 'LockTest1!xx',
      };

      // Register
      await request(app).post('/auth/register').send(lockUser);

      // Fail 5 times
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/auth/login')
          .send({ username: lockUser.username, password: 'wrong' });
      }

      // 6th attempt should be locked
      const res = await request(app)
        .post('/auth/login')
        .send({ username: lockUser.username, password: lockUser.password });
      expect(res.status).toBe(423);
    }, 30000);
  });

  describe('GET /accounts/me', () => {
    test('200 — with valid Bearer token', async () => {
      const res = await request(app)
        .get('/accounts/me')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body.username).toBe(TEST_USER.username);
      expect(res.body.password_hash).toBeUndefined();
    });

    test('401 — no token', async () => {
      const res = await request(app).get('/accounts/me');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /accounts/me', () => {
    test('200 — updates legalName', async () => {
      const res = await request(app)
        .patch('/accounts/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ legalName: 'John Doe' });
      expect(res.status).toBe(200);
      expect(res.body.legal_name).toBe('John Doe');
    });

    test('200 — full US address payload', async () => {
      const res = await request(app)
        .patch('/accounts/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          addressLine1: '100 Main St',
          city: 'Aspen',
          state: 'CO',
          zip: '81611',
          preferredCurrency: 'USD',
        });
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('CO');
      expect(res.body.zip).toBe('81611');
    });

    test('400 — invalid US state code', async () => {
      const res = await request(app)
        .patch('/accounts/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ state: 'XX' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    test('400 — invalid ZIP format', async () => {
      const res = await request(app)
        .patch('/accounts/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ zip: '1234' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    test('400 — invalid ISO currency code', async () => {
      const res = await request(app)
        .patch('/accounts/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ preferredCurrency: 'dollars' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    test('400 — unknown field is rejected (strict)', async () => {
      const res = await request(app)
        .patch('/accounts/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ role: 'hotel_admin' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /accounts/me/export', () => {
    test('200 — returns downloadUrl AND expiresAt (spec contract)', async () => {
      const res = await request(app)
        .post('/accounts/me/export')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body.downloadUrl).toBeDefined();
      expect(res.body.downloadUrl).toMatch(/^\/exports\//);

      // Spec drift fix: response must include expiresAt as ISO 8601.
      expect(res.body.expiresAt).toBeDefined();
      expect(typeof res.body.expiresAt).toBe('string');
      const exp = new Date(res.body.expiresAt);
      expect(Number.isNaN(exp.getTime())).toBe(false);
      // Window is 24h ± a small slack
      const now = Date.now();
      expect(exp.getTime()).toBeGreaterThan(now + 23 * 60 * 60 * 1000);
      expect(exp.getTime()).toBeLessThanOrEqual(now + 25 * 60 * 60 * 1000);
    });
  });

  // ─── PATCH /auth/change-password ──────────────────────────────────
  //
  // The audit flagged this endpoint as previously uncovered. We add
  // deterministic tests here AND deliberately place them BEFORE the
  // logout block so the `authToken` variable is still valid. Each
  // sub-test uses a fresh locally-registered user so it does not
  // mutate the shared `TEST_USER` credentials in a way that breaks
  // later tests.
  describe('PATCH /auth/change-password', () => {
    // Register + login a fresh user, return their bearer token.
    async function freshUser(tag: string): Promise<{ username: string; pw: string; token: string }> {
      const username = `pw_${tag}_${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      const pw = 'OldPass1!abc';
      const reg = await request(app).post('/auth/register').send({ username, password: pw });
      expect(reg.status).toBe(201);
      const login = await request(app).post('/auth/login').send({ username, password: pw });
      expect(login.status).toBe(200);
      return { username, pw, token: login.body.accessToken };
    }

    // These tests chain 3-5 bcrypt operations (register hashes,
    // login verifies, change-password verifies + hashes, post-change
    // login verifies) so the default 5s jest timeout is tight on
    // slower CI. Bump each test's budget to 20s.
    const AUTH_BCRYPT_TIMEOUT_MS = 20_000;

    test('200 — rotates password; old password stops working; new works', async () => {
      const u = await freshUser('rotate');
      const newPw = 'NewPass1!xyz';

      const res = await request(app)
        .patch('/auth/change-password')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ currentPassword: u.pw, newPassword: newPw });
      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
      expect(typeof res.body.message).toBe('string');

      // Old password must be rejected
      const oldLogin = await request(app).post('/auth/login').send({ username: u.username, password: u.pw });
      expect(oldLogin.status).toBe(401);
      expect(oldLogin.body.code).toBe('UNAUTHORIZED');

      // New password succeeds
      const newLogin = await request(app).post('/auth/login').send({ username: u.username, password: newPw });
      expect(newLogin.status).toBe(200);
      expect(newLogin.body.accessToken).toBeDefined();
    }, AUTH_BCRYPT_TIMEOUT_MS);

    test('400 — rejects short new password (policy: min length)', async () => {
      const u = await freshUser('short');
      const res = await request(app)
        .patch('/auth/change-password')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ currentPassword: u.pw, newPassword: 'short' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }, AUTH_BCRYPT_TIMEOUT_MS);

    test('401 — wrong current password rejected', async () => {
      const u = await freshUser('wrongcur');
      const res = await request(app)
        .patch('/auth/change-password')
        .set('Authorization', `Bearer ${u.token}`)
        .send({ currentPassword: 'Wrong0!pass', newPassword: 'GoodPass1!xx' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    }, AUTH_BCRYPT_TIMEOUT_MS);

    test('401 — unauthenticated request rejected', async () => {
      const res = await request(app)
        .patch('/auth/change-password')
        .send({ currentPassword: 'Any1!pass', newPassword: 'Other1!pass' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    test('204 — with valid token', async () => {
      const res = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(204);
    });
  });
});

describe('Slice 1 — Health API (regression)', () => {
  test('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('X-Trace-Id header is present', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-trace-id']).toBeDefined();
  });
});
