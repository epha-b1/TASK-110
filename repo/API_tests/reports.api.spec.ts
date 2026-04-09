import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../src/app';
import { sequelize } from '../src/config/database';
import { StaffingRecord, EvaluationRecord, ImportBatch } from '../src/models/import.model';
import { describeDb } from './db-guard';

let adminToken: string;
let memberToken: string;
let managerToken: string;

// Seeded demo properties — keep in sync with seeders/002-demo-data.js
const PROPERTY_1_ID = '11111111-1111-1111-1111-111111111111';
const PROPERTY_2_ID = '22222222-2222-2222-2222-222222222222';

// Unique markers per test run so we can identify our seeded rows and not
// rely on accidental state from other tests.
const RUN_TAG = `iso-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EMP_PROP1 = `EMP_${RUN_TAG}_P1`;
const EMP_PROP2 = `EMP_${RUN_TAG}_P2`;

describeDb('Slice 8 — Reports API', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    adminToken = (await request(app).post('/auth/login').send({ username: 'admin', password: 'Admin1!pass' })).body.accessToken;
    memberToken = (await request(app).post('/auth/login').send({ username: 'member1', password: 'Member1!pass' })).body.accessToken;
    managerToken = (await request(app).post('/auth/login').send({ username: 'manager1', password: 'Manager1!pass' })).body.accessToken;

    // --- Isolation fixture ------------------------------------------------
    // Seed a staffing record per property and matching evaluation rows so
    // the manager-isolation tests below can make STRONG assertions about
    // what each role can and cannot see, rather than weak cardinality
    // comparisons. Each batch is tagged with RUN_TAG to keep tests
    // independent across runs.
    const batchId = uuidv4();
    await ImportBatch.create({
      id: batchId, user_id: 'isolation-fixture', batch_type: 'staffing',
      status: 'completed', trace_id: null, created_at: new Date(),
    });

    // Employee staffed on property 1 (manager's own property)
    await StaffingRecord.create({
      id: uuidv4(), batch_id: batchId,
      employee_id: EMP_PROP1, effective_date: '2025-06-01',
      position: 'Host', department: 'FO', property_id: PROPERTY_1_ID,
      signed_off_by: null, created_at: new Date(),
    });
    // Employee staffed on property 2 (other property)
    await StaffingRecord.create({
      id: uuidv4(), batch_id: batchId,
      employee_id: EMP_PROP2, effective_date: '2025-06-01',
      position: 'Host', department: 'FO', property_id: PROPERTY_2_ID,
      signed_off_by: null, created_at: new Date(),
    });

    // Evaluation for the property-1 employee — result 'PASS'
    await EvaluationRecord.create({
      id: uuidv4(), batch_id: batchId,
      employee_id: EMP_PROP1, effective_date: '2025-06-01',
      score: 90, result: `ISO_PASS_${RUN_TAG}`,
      rewards: null, penalties: null, signed_off_by: null, created_at: new Date(),
    });
    // Evaluation for the property-2 employee — DIFFERENT result so it's
    // detectable if the manager's query ever sees it.
    await EvaluationRecord.create({
      id: uuidv4(), batch_id: batchId,
      employee_id: EMP_PROP2, effective_date: '2025-06-01',
      score: 40, result: `ISO_FAIL_${RUN_TAG}`,
      rewards: null, penalties: null, signed_off_by: null, created_at: new Date(),
    });
  });
  afterAll(async () => { await sequelize.close(); });

  test('GET /reports/occupancy 200 as admin', async () => {
    const res = await request(app).get('/reports/occupancy?from=2025-01-01&to=2025-12-31').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  // ─── Validation middleware (audit fix) ─────────────────────────────
  test('GET /reports/occupancy 400 — missing from/to', async () => {
    const res = await request(app).get('/reports/occupancy').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('GET /reports/occupancy 400 — bad date format', async () => {
    const res = await request(app).get('/reports/occupancy?from=06/01/2026&to=06/30/2026').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('GET /reports/occupancy 400 — from > to', async () => {
    const res = await request(app).get('/reports/occupancy?from=2026-12-31&to=2026-01-01').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST /reports/export 400 — invalid reportType', async () => {
    const res = await request(app).post('/reports/export').set('Authorization', `Bearer ${adminToken}`)
      .send({ reportType: 'gop', from: '2026-01-01', to: '2026-01-31', format: 'csv' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('GET /reports/adr 200 as admin', async () => {
    const res = await request(app).get('/reports/adr?from=2025-01-01&to=2025-12-31').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('GET /reports/revpar 200 as admin', async () => {
    const res = await request(app).get('/reports/revpar?from=2025-01-01&to=2025-12-31').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('GET /reports/revenue-mix 200 as admin', async () => {
    const res = await request(app).get('/reports/revenue-mix?from=2025-01-01&to=2025-12-31').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('GET /reports/occupancy 200 as manager — scoped to property', async () => {
    const res = await request(app).get('/reports/occupancy?from=2025-01-01&to=2025-12-31').set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
  });

  test('GET /reports/occupancy 403 as member', async () => {
    const res = await request(app).get('/reports/occupancy?from=2025-01-01&to=2025-12-31').set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });

  test('POST /reports/export 200 — csv export', async () => {
    const res = await request(app).post('/reports/export').set('Authorization', `Bearer ${adminToken}`)
      .send({ reportType: 'occupancy', from: '2025-01-01', to: '2025-12-31', format: 'csv' });
    expect(res.status).toBe(200);
    expect(res.body.downloadUrl).toBeDefined();
  });

  test('POST /reports/export 403 — PII without permission', async () => {
    const res = await request(app).post('/reports/export').set('Authorization', `Bearer ${managerToken}`)
      .send({ reportType: 'occupancy', from: '2025-01-01', to: '2025-12-31', format: 'csv', includePii: true });
    expect(res.status).toBe(403);
  });

  test('POST /reports/export 200 — excel export', async () => {
    const res = await request(app).post('/reports/export').set('Authorization', `Bearer ${adminToken}`)
      .send({ reportType: 'occupancy', from: '2025-01-01', to: '2025-12-31', format: 'excel' });
    expect(res.status).toBe(200);
    expect(res.body.format).toBe('xlsx');
    expect(res.body.downloadUrl).toMatch(/\.xlsx$/);
  });

  test('SQL injection attempt on propertyId is safe', async () => {
    const res = await request(app).get("/reports/occupancy?from=2025-01-01&to=2025-12-31&propertyId=' OR 1=1 --")
      .set('Authorization', `Bearer ${adminToken}`);
    // Should not crash — returns 200 with empty results (no matching property)
    expect(res.status).toBe(200);
  });

  test('GET /exports/:filename 401 — unauthenticated export access blocked', async () => {
    const res = await request(app).get('/exports/some-file.csv');
    expect(res.status).toBe(401);
  });

  test('GET /reports/staffing 200', async () => {
    const res = await request(app).get('/reports/staffing').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.positionDistribution).toBeDefined();
  });

  test('GET /reports/evaluations 200', async () => {
    const res = await request(app).get('/reports/evaluations').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.resultsSummary).toBeDefined();
  });

  // --- Fix B: manager property isolation on staffing/evaluation ---
  test('GET /reports/staffing 200 as manager — auto-scoped to own property', async () => {
    const res = await request(app).get('/reports/staffing').set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
  });

  test('GET /reports/staffing 403 — manager accessing wrong property', async () => {
    const res = await request(app).get('/reports/staffing?propertyId=22222222-2222-2222-2222-222222222222')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(403);
  });

  test('GET /reports/evaluations 200 as manager — auto-scoped', async () => {
    const res = await request(app).get('/reports/evaluations').set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
  });

  test('GET /reports/evaluations 403 — manager accessing wrong property', async () => {
    // Manager is assigned to property 1 by the seeder; asking for
    // property 2 must be rejected at the controller scope check, not
    // silently broadened. This is the manager-isolation fix for the
    // evaluation report path flagged by the static audit.
    const res = await request(app)
      .get('/reports/evaluations?propertyId=22222222-2222-2222-2222-222222222222')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(403);
  });

  test('GET /reports/evaluations — manager sees own property bucket but NOT other property bucket', async () => {
    // The fixture seeded two distinct evaluation rows tagged with
    // RUN_TAG: ISO_PASS_<tag> on property 1, ISO_FAIL_<tag> on property 2.
    // A correctly scoped manager query MUST contain ISO_PASS and MUST
    // NOT contain ISO_FAIL. This is a strict assertion that would fail
    // if the property filter were silently dropped from evaluationReport.
    const managerRes = await request(app)
      .get('/reports/evaluations')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(managerRes.status).toBe(200);

    const buckets = (managerRes.body.resultsSummary || []) as Array<{ result: string }>;
    const labels = buckets.map((b) => b.result);

    expect(labels).toContain(`ISO_PASS_${RUN_TAG}`);
    expect(labels).not.toContain(`ISO_FAIL_${RUN_TAG}`);
  });

  test('GET /reports/evaluations — admin sees BOTH property buckets', async () => {
    // Admin has no scope, so both seeded rows must be visible. This is
    // the parity assertion that proves the manager test above is testing
    // a real scope difference, not a fixture defect.
    const adminRes = await request(app)
      .get('/reports/evaluations')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
    const buckets = (adminRes.body.resultsSummary || []) as Array<{ result: string }>;
    const labels = buckets.map((b) => b.result);
    expect(labels).toContain(`ISO_PASS_${RUN_TAG}`);
    expect(labels).toContain(`ISO_FAIL_${RUN_TAG}`);
  });

  test('GET /reports/evaluations?propertyId=<other> as admin — only that property visible', async () => {
    // Admin opting into a property scope should see ONLY that property's
    // evaluations. Property 2 has ISO_FAIL but not ISO_PASS.
    const res = await request(app)
      .get(`/reports/evaluations?propertyId=${PROPERTY_2_ID}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const labels = (res.body.resultsSummary || []).map((b: any) => b.result);
    expect(labels).toContain(`ISO_FAIL_${RUN_TAG}`);
    expect(labels).not.toContain(`ISO_PASS_${RUN_TAG}`);
  });

  // --- Fix A: export ownership enforcement ---
  test('GET /exports/:filename 404 — file not in export_records', async () => {
    const res = await request(app).get('/exports/nonexistent-file.csv').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('GET /exports/:filename 404 — internal temp file blocked', async () => {
    const res = await request(app).get('/exports/.import-fake-id.json').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  test('export download — owner can access own export', async () => {
    // Create an export first
    const exportRes = await request(app).post('/reports/export').set('Authorization', `Bearer ${adminToken}`)
      .send({ reportType: 'occupancy', from: '2025-01-01', to: '2025-12-31', format: 'csv' });
    expect(exportRes.status).toBe(200);
    const downloadUrl = exportRes.body.downloadUrl;

    // Owner (admin) can download
    const dlRes = await request(app).get(downloadUrl).set('Authorization', `Bearer ${adminToken}`);
    expect(dlRes.status).toBe(200);
  });

  test('export download — non-owner gets 403', async () => {
    // Create export as admin
    const exportRes = await request(app).post('/reports/export').set('Authorization', `Bearer ${adminToken}`)
      .send({ reportType: 'adr', from: '2025-01-01', to: '2025-12-31', format: 'csv' });
    const downloadUrl = exportRes.body.downloadUrl;

    // Manager (non-owner, non-admin) tries to download
    const dlRes = await request(app).get(downloadUrl).set('Authorization', `Bearer ${managerToken}`);
    expect(dlRes.status).toBe(403);
  });
});
