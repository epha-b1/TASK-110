import request from 'supertest';
import app from '../src/app';
import { sequelize } from '../src/config/database';
import { describeDb } from './db-guard';

let memberToken: string;
let sessionId: string;

describeDb('Slice 10 — Face Enrollment API', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    memberToken = (await request(app).post('/auth/login').send({ username: 'member1', password: 'Member1!pass' })).body.accessToken;
  });
  afterAll(async () => { await sequelize.close(); });

  test('POST /face/enroll/start 201 — creates session', async () => {
    const res = await request(app).post('/face/enroll/start').set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.requiredAngles).toEqual(['left', 'front', 'right']);
    sessionId = res.body.sessionId;
  });

  test('POST /face/enroll/:sessionId/capture 200 — left angle', async () => {
    const res = await request(app).post(`/face/enroll/${sessionId}/capture`).set('Authorization', `Bearer ${memberToken}`)
      .field('angle', 'left').field('blinkTimingMs', '200').field('motionScore', '0.8').field('textureScore', '0.7');
    expect(res.status).toBe(200);
    expect(res.body.livenessResult.passed).toBe(true);
  });

  test('POST capture — front angle', async () => {
    const res = await request(app).post(`/face/enroll/${sessionId}/capture`).set('Authorization', `Bearer ${memberToken}`)
      .field('angle', 'front').field('blinkTimingMs', '250').field('motionScore', '0.9').field('textureScore', '0.8');
    expect(res.status).toBe(200);
    expect(res.body.livenessResult.passed).toBe(true);
  });

  test('POST capture — right angle', async () => {
    const res = await request(app).post(`/face/enroll/${sessionId}/capture`).set('Authorization', `Bearer ${memberToken}`)
      .field('angle', 'right').field('blinkTimingMs', '300').field('motionScore', '0.7').field('textureScore', '0.6');
    expect(res.status).toBe(200);
    expect(res.body.livenessResult.passed).toBe(true);
  });

  test('POST /face/enroll/:sessionId/complete 201 — completes enrollment', async () => {
    const res = await request(app).post(`/face/enroll/${sessionId}/complete`).set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(201);
    expect(res.body.enrollmentId).toBeDefined();
    expect(res.body.version).toBe(1);
  });

  test('POST complete 400 — incomplete angles', async () => {
    const start = await request(app).post('/face/enroll/start').set('Authorization', `Bearer ${memberToken}`);
    await request(app).post(`/face/enroll/${start.body.sessionId}/capture`).set('Authorization', `Bearer ${memberToken}`)
      .field('angle', 'left').field('blinkTimingMs', '200').field('motionScore', '0.8').field('textureScore', '0.7');
    const res = await request(app).post(`/face/enroll/${start.body.sessionId}/complete`).set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(400);
  });

  test('POST capture 400 — liveness fails (blink too fast)', async () => {
    const start = await request(app).post('/face/enroll/start').set('Authorization', `Bearer ${memberToken}`);
    const res = await request(app).post(`/face/enroll/${start.body.sessionId}/capture`).set('Authorization', `Bearer ${memberToken}`)
      .field('angle', 'left').field('blinkTimingMs', '50').field('motionScore', '0.8').field('textureScore', '0.7');
    expect(res.status).toBe(200);
    expect(res.body.livenessResult.passed).toBe(false);
  });

  test('GET /face/enrollments 200 — lists enrollments', async () => {
    const res = await request(app).get('/face/enrollments').set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  test('PATCH /face/enrollments/:id — deactivate (deterministic: completes a fresh enrollment first)', async () => {
    // The previous version of this test only ran the PATCH when an
    // active enrollment happened to exist in the DB, which was
    // non-deterministic across test runs (a prior run could have
    // deactivated the only active row). Build a guaranteed-active
    // enrollment here so the PATCH is always exercised.
    const start = await request(app)
      .post('/face/enroll/start')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(start.status).toBe(201);
    const freshSession = start.body.sessionId as string;

    for (const [angle, blink] of [['left', '210'], ['front', '230'], ['right', '250']] as const) {
      const cap = await request(app)
        .post(`/face/enroll/${freshSession}/capture`)
        .set('Authorization', `Bearer ${memberToken}`)
        .field('angle', angle).field('blinkTimingMs', blink).field('motionScore', '0.85').field('textureScore', '0.75');
      expect(cap.status).toBe(200);
      expect(cap.body.livenessResult.passed).toBe(true);
    }

    const complete = await request(app)
      .post(`/face/enroll/${freshSession}/complete`)
      .set('Authorization', `Bearer ${memberToken}`);
    expect(complete.status).toBe(201);
    const freshEnrollmentId = complete.body.enrollmentId as string;

    // At this point the DB holds an active enrollment with the id we
    // just captured. The PATCH must succeed and flip status to
    // deactivated — no `if (active)` branching, always runs.
    const res = await request(app)
      .patch(`/face/enrollments/${freshEnrollmentId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ status: 'deactivated' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(freshEnrollmentId);
    expect(res.body.status).toBe('deactivated');

    // Cross-check: the listing now reports the record as deactivated.
    const list = await request(app)
      .get('/face/enrollments')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(list.status).toBe(200);
    const row = (list.body as Array<{ id: string; status: string }>).find((e) => e.id === freshEnrollmentId);
    expect(row).toBeDefined();
    expect(row!.status).toBe('deactivated');
  });
});
