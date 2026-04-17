import request from 'supertest';
import app from '../src/app';
import { sequelize } from '../src/config/database';
import { describeDb } from './db-guard';

let adminToken: string;
let memberToken: string;
let checkId: string;

describeDb('Slice 11 — Quality API', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    adminToken = (await request(app).post('/auth/login').send({ username: 'admin', password: 'Admin1!pass' })).body.accessToken;
    memberToken = (await request(app).post('/auth/login').send({ username: 'member1', password: 'Member1!pass' })).body.accessToken;
  });
  afterAll(async () => { await sequelize.close(); });

  test('POST /quality/checks 201 — create check config and echo contract fields', async () => {
    const res = await request(app).post('/quality/checks').set('Authorization', `Bearer ${adminToken}`)
      .send({ entityType: 'reservations', checkType: 'null_coverage', config: { threshold: 0.05 } });
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    // Contract: id is a UUID, and the config we sent round-trips back.
    expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(res.body.entity_type).toBe('reservations');
    expect(res.body.check_type).toBe('null_coverage');
    // config may be returned as string or object depending on dialect;
    // normalize before comparing the meaningful field.
    const cfg = typeof res.body.config === 'string' ? JSON.parse(res.body.config) : res.body.config;
    expect(cfg.threshold).toBe(0.05);
    checkId = res.body.id;
  });

  test('GET /quality/checks 200 — lists the created check and returns contract fields', async () => {
    const res = await request(app).get('/quality/checks').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    // Every row carries id/entity_type/check_type/config.
    for (const row of res.body as Array<Record<string, unknown>>) {
      expect(typeof row.id).toBe('string');
      expect(typeof row.entity_type).toBe('string');
      expect(typeof row.check_type).toBe('string');
      expect(row.config).toBeDefined();
    }
    // The check we just created must be findable by id.
    const found = (res.body as Array<{ id: string }>).find((c) => c.id === checkId);
    expect(found).toBeDefined();
  });

  test('POST /quality/checks/:id/run 200 — returns pass/fail + structured result', async () => {
    const res = await request(app).post(`/quality/checks/${checkId}/run`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.passed).toBe('boolean');
    expect(res.body.result).toBeDefined();
    expect(typeof res.body.result).toBe('object');
  });

  test('GET /quality/results 200 — latest results array with run metadata', async () => {
    const res = await request(app).get('/quality/results').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // After running the check above, at least one row must be in the
    // "run" state (run_at not null). The service returns rows from
    // the same `quality_checks` table with pass/result populated —
    // there's no separate results join table, so assertions target
    // those fields directly (see src/models/quality.model.ts).
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const foundRunRow = (res.body as Array<Record<string, unknown>>).find((r) => r.id === checkId);
    expect(foundRunRow).toBeDefined();
    expect(typeof foundRunRow!.passed).toBe('boolean');
    expect(foundRunRow!.run_at).not.toBeNull();
    expect(foundRunRow!.result).toBeDefined();
    // Every row in the result array is a run record (run_at non-null).
    for (const row of res.body as Array<Record<string, unknown>>) {
      expect(typeof row.id).toBe('string');
      expect(row.run_at).not.toBeNull();
      expect(typeof row.entity_type).toBe('string');
      expect(typeof row.check_type).toBe('string');
    }
  });

  test('POST /quality/checks 403 — member blocked (role gate)', async () => {
    const res = await request(app).post('/quality/checks').set('Authorization', `Bearer ${memberToken}`)
      .send({ entityType: 'users', checkType: 'null_coverage', config: {} });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  test('GET /quality/checks 401 — unauthenticated rejected', async () => {
    const res = await request(app).get('/quality/checks');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });
});
