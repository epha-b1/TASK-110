/**
 * roomType filter — proves `roomType` query parameter is actually applied
 * end-to-end to /reports/adr and /reports/revpar.
 *
 * The audit flagged that the reporting service's SQL builder accepts
 * `roomType` but the controller was not forwarding it from the query
 * string to the service layer. Without these tests the bug was invisible
 * at the API level because an unfiltered request returns "more" data
 * rather than a hard error.
 *
 * Fixture (isolated property so totals are deterministic):
 *
 *   Property:     "rt-test-<RUN_TAG>"
 *   Rooms:
 *     R_STD_1    standard   rate 10000  status available
 *     R_STD_2    standard   rate 10000  status available
 *     R_DLX_1    deluxe     rate 20000  status available
 *   Date range:   2026-07-01 .. 2026-07-02 inclusive (2 nights)
 *   Reservations (all confirmed so they count towards occupied/revenue):
 *     res_std  room R_STD_1  07-01 → 07-03  rate 100  → 2 std nights
 *     res_dlx  room R_DLX_1  07-01 → 07-03  rate 400  → 2 dlx nights
 *
 * Expectations:
 *   No roomType filter:
 *     ADR    = (100*2 + 400*2) / (2+2) = 1000/4 = 250
 *     RevPAR = (100*2 + 400*2) / (3 rooms * 2 nights) = 1000/6 ≈ 166.67
 *
 *   roomType=standard:
 *     ADR    = (100*2)/2 = 100
 *     RevPAR = (100*2)/(2 rooms * 2 nights) = 200/4 = 50
 *
 *   roomType=deluxe:
 *     ADR    = (400*2)/2 = 400
 *     RevPAR = (400*2)/(1 room * 2 nights) = 800/2 = 400
 *
 *   roomType=nonexistent: empty result set (no matching rooms → no
 *   per-night rows at all).
 *
 * If the controller drops `roomType` on the way to the service, the
 * ADR/RevPAR numbers under the filtered requests will match the
 * unfiltered ones and these assertions will fail — which is exactly
 * the regression we want to catch.
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../src/app';
import { sequelize } from '../src/config/database';
import { Property, Room, Reservation } from '../src/models/property.model';
import { describeDb } from './db-guard';

const RUN_TAG = `rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PROP_ID = uuidv4();
const FROM = '2026-07-01';
const TO   = '2026-07-02';

let adminToken: string;

describeDb('Reports roomType filter — ADR/RevPAR', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    adminToken = (await request(app).post('/auth/login').send({
      username: 'admin', password: 'Admin1!pass',
    })).body.accessToken;

    const now = new Date();
    await Property.create({
      id: PROP_ID, name: `rt-test-${RUN_TAG}`, address: 'roomType test',
      created_at: now, updated_at: now,
    });

    const rStd1 = uuidv4();
    const rStd2 = uuidv4();
    const rDlx1 = uuidv4();
    await Room.bulkCreate([
      { id: rStd1, property_id: PROP_ID, room_number: '101', room_type: 'standard',
        rate_cents: 10000, status: 'available', created_at: now, updated_at: now } as any,
      { id: rStd2, property_id: PROP_ID, room_number: '102', room_type: 'standard',
        rate_cents: 10000, status: 'available', created_at: now, updated_at: now } as any,
      { id: rDlx1, property_id: PROP_ID, room_number: '201', room_type: 'deluxe',
        rate_cents: 20000, status: 'available', created_at: now, updated_at: now } as any,
    ]);

    await Reservation.bulkCreate([
      { id: uuidv4(), property_id: PROP_ID, room_id: rStd1, guest_name: 'STD',
        channel: 'direct', check_in_date: '2026-07-01', check_out_date: '2026-07-03',
        rate_cents: 100, status: 'confirmed', created_at: now, updated_at: now } as any,
      { id: uuidv4(), property_id: PROP_ID, room_id: rDlx1, guest_name: 'DLX',
        channel: 'direct', check_in_date: '2026-07-01', check_out_date: '2026-07-03',
        rate_cents: 400, status: 'confirmed', created_at: now, updated_at: now } as any,
    ]);
  });

  afterAll(async () => {
    try {
      await Reservation.destroy({ where: { property_id: PROP_ID } });
      await Room.destroy({ where: { property_id: PROP_ID } });
      await Property.destroy({ where: { id: PROP_ID } });
    } catch { /* best-effort cleanup */ }
    await sequelize.close();
  });

  // ─── ADR ──────────────────────────────────────────────────────────

  test('GET /reports/adr — no roomType: blended ADR across room types', async () => {
    const res = await request(app)
      .get(`/reports/adr?from=${FROM}&to=${TO}&groupBy=month&propertyId=${PROP_ID}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = (res.body as any[])[0];
    // Blended: (100*2 + 400*2) / (2+2) = 1000/4 = 250
    expect(Number(row.adr_cents)).toBe(250);
    expect(Number(row.occupied_room_nights)).toBe(4);
  });

  test('GET /reports/adr?roomType=standard — only standard revenue/nights', async () => {
    const res = await request(app)
      .get(`/reports/adr?from=${FROM}&to=${TO}&groupBy=month&propertyId=${PROP_ID}&roomType=standard`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = (res.body as any[])[0];
    // Only R_STD_1 reservation contributes: (100*2)/2 = 100
    expect(Number(row.adr_cents)).toBe(100);
    expect(Number(row.occupied_room_nights)).toBe(2);
    expect(Number(row.revenue_cents)).toBe(200);
  });

  test('GET /reports/adr?roomType=deluxe — only deluxe revenue/nights', async () => {
    const res = await request(app)
      .get(`/reports/adr?from=${FROM}&to=${TO}&groupBy=month&propertyId=${PROP_ID}&roomType=deluxe`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = (res.body as any[])[0];
    // Only R_DLX_1 reservation contributes: (400*2)/2 = 400
    expect(Number(row.adr_cents)).toBe(400);
    expect(Number(row.occupied_room_nights)).toBe(2);
    expect(Number(row.revenue_cents)).toBe(800);
  });

  test('GET /reports/adr?roomType=nonexistent — empty result set', async () => {
    const res = await request(app)
      .get(`/reports/adr?from=${FROM}&to=${TO}&groupBy=month&propertyId=${PROP_ID}&roomType=penthouse`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as any[]).length).toBe(0);
  });

  // ─── RevPAR ───────────────────────────────────────────────────────

  test('GET /reports/revpar — no roomType: blended RevPAR across room types', async () => {
    const res = await request(app)
      .get(`/reports/revpar?from=${FROM}&to=${TO}&groupBy=month&propertyId=${PROP_ID}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = (res.body as any[])[0];
    // Blended: 1000 / (3 rooms * 2 nights) = 1000/6 ≈ 166.67
    expect(Number(row.available_room_nights)).toBe(6);
    expect(Number(row.revenue_cents)).toBe(1000);
    expect(Number(row.revpar_cents)).toBeCloseTo(166.67, 2);
  });

  test('GET /reports/revpar?roomType=standard — only standard availability/revenue', async () => {
    const res = await request(app)
      .get(`/reports/revpar?from=${FROM}&to=${TO}&groupBy=month&propertyId=${PROP_ID}&roomType=standard`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = (res.body as any[])[0];
    // Available: 2 standard rooms × 2 nights = 4
    // Revenue:   100 × 2 = 200
    // RevPAR:    200 / 4 = 50
    expect(Number(row.available_room_nights)).toBe(4);
    expect(Number(row.revenue_cents)).toBe(200);
    expect(Number(row.revpar_cents)).toBe(50);
  });

  test('GET /reports/revpar?roomType=deluxe — only deluxe availability/revenue', async () => {
    const res = await request(app)
      .get(`/reports/revpar?from=${FROM}&to=${TO}&groupBy=month&propertyId=${PROP_ID}&roomType=deluxe`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = (res.body as any[])[0];
    // Available: 1 deluxe room × 2 nights = 2
    // Revenue:   400 × 2 = 800
    // RevPAR:    800 / 2 = 400
    expect(Number(row.available_room_nights)).toBe(2);
    expect(Number(row.revenue_cents)).toBe(800);
    expect(Number(row.revpar_cents)).toBe(400);
  });

  test('GET /reports/revpar?roomType=nonexistent — empty result set', async () => {
    const res = await request(app)
      .get(`/reports/revpar?from=${FROM}&to=${TO}&groupBy=month&propertyId=${PROP_ID}&roomType=penthouse`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as any[]).length).toBe(0);
  });
});
