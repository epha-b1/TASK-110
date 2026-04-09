/**
 * Deterministic KPI numeric tests for /reports/{occupancy,adr,revpar}.
 *
 * Seeds an isolated property with a known set of rooms and reservations
 * so the room-night arithmetic is exactly predictable, then asserts the
 * exact numeric output of each KPI endpoint. Any future change that
 * breaks the room-night formulas (e.g. counting reservations instead of
 * nights, or off-by-one on check-out exclusivity) will fail these tests
 * loudly.
 *
 * Fixture (all dates in 2026 to keep them clear of demo data):
 *
 *   Property:    "kpi-test-<RUN_TAG>"  (5 rooms, all standard)
 *   Rooms:       R1..R4 = available, R5 = maintenance (excluded)
 *   Date range:  from 2026-06-01 to 2026-06-03 inclusive (3 nights)
 *   Reservations:
 *     - res1: room R1, check_in 06-01, check_out 06-04, rate 100,
 *             status checked_in   → covers nights 06-01, 06-02, 06-03
 *     - res2: room R2, check_in 06-02, check_out 06-04, rate 200,
 *             status confirmed    → covers nights 06-02, 06-03
 *     - res3: room R3, check_in 06-01, check_out 06-02, rate 150,
 *             status cancelled    → IGNORED (cancelled)
 *
 * Available room nights = 4 rooms × 3 nights = 12
 * Occupied room nights  = 3 (res1) + 2 (res2) = 5
 * Revenue (cents)       = 3*100 + 2*200       = 700
 *
 * Expected daily totals:
 *   2026-06-01: 4 avail / 1 occ / 100 rev
 *   2026-06-02: 4 avail / 2 occ / 300 rev
 *   2026-06-03: 4 avail / 2 occ / 300 rev
 *
 * Expected aggregates over the whole range:
 *   Occupancy = 5 / 12         ≈ 0.4167
 *   ADR       = 700 / 5        = 140  (cents)
 *   RevPAR    = 700 / 12       ≈ 58.33 (cents)
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../src/app';
import { sequelize } from '../src/config/database';
import { Property, Room, Reservation } from '../src/models/property.model';
import { describeDb } from './db-guard';

const RUN_TAG = `kpi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PROP_ID = uuidv4();
const FROM = '2026-06-01';
const TO   = '2026-06-03';

let adminToken: string;

describeDb('Reports KPI room-night formulas — deterministic numerics', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    adminToken = (await request(app).post('/auth/login').send({ username: 'admin', password: 'Admin1!pass' })).body.accessToken;

    // Create the isolated test property
    const now = new Date();
    await Property.create({
      id: PROP_ID, name: `kpi-test-${RUN_TAG}`, address: 'KPI Test', created_at: now, updated_at: now,
    });

    // 4 available rooms + 1 maintenance room
    const r1 = uuidv4(); const r2 = uuidv4(); const r3 = uuidv4(); const r4 = uuidv4(); const rM = uuidv4();
    await Room.bulkCreate([
      { id: r1, property_id: PROP_ID, room_number: '101', room_type: 'standard', rate_cents: 10000, status: 'available', created_at: now, updated_at: now } as any,
      { id: r2, property_id: PROP_ID, room_number: '102', room_type: 'standard', rate_cents: 10000, status: 'available', created_at: now, updated_at: now } as any,
      { id: r3, property_id: PROP_ID, room_number: '103', room_type: 'standard', rate_cents: 10000, status: 'available', created_at: now, updated_at: now } as any,
      { id: r4, property_id: PROP_ID, room_number: '104', room_type: 'standard', rate_cents: 10000, status: 'available', created_at: now, updated_at: now } as any,
      { id: rM, property_id: PROP_ID, room_number: '199', room_type: 'standard', rate_cents: 10000, status: 'maintenance', created_at: now, updated_at: now } as any,
    ]);

    // res1: R1, 06-01 → 06-04 checked_in @ 100
    // res2: R2, 06-02 → 06-04 confirmed  @ 200
    // res3: R3, 06-01 → 06-02 cancelled  @ 150 (must be ignored)
    await Reservation.bulkCreate([
      { id: uuidv4(), property_id: PROP_ID, room_id: r1, guest_name: 'A',
        channel: 'direct', check_in_date: '2026-06-01', check_out_date: '2026-06-04',
        rate_cents: 100, status: 'checked_in', created_at: now, updated_at: now } as any,
      { id: uuidv4(), property_id: PROP_ID, room_id: r2, guest_name: 'B',
        channel: 'direct', check_in_date: '2026-06-02', check_out_date: '2026-06-04',
        rate_cents: 200, status: 'confirmed', created_at: now, updated_at: now } as any,
      { id: uuidv4(), property_id: PROP_ID, room_id: r3, guest_name: 'C',
        channel: 'direct', check_in_date: '2026-06-01', check_out_date: '2026-06-02',
        rate_cents: 150, status: 'cancelled', created_at: now, updated_at: now } as any,
    ]);
  });

  afterAll(async () => {
    // Clean up the isolated fixture so re-runs are deterministic
    try {
      await Reservation.destroy({ where: { property_id: PROP_ID } });
      await Room.destroy({ where: { property_id: PROP_ID } });
      await Property.destroy({ where: { id: PROP_ID } });
    } catch { /* best-effort cleanup */ }
    await sequelize.close();
  });

  // ─── Daily granularity ─────────────────────────────────────────────
  test('GET /reports/occupancy daily — exact per-night totals', async () => {
    const res = await request(app)
      .get(`/reports/occupancy?from=${FROM}&to=${TO}&propertyId=${PROP_ID}&groupBy=day`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const rows: Array<{ period: string; available_room_nights: number; occupied_room_nights: number; occupancy_rate: number }>
      = res.body;
    expect(rows.length).toBe(3);

    const byPeriod = Object.fromEntries(rows.map(r => [r.period, r]));
    expect(Number(byPeriod['2026-06-01'].available_room_nights)).toBe(4);
    expect(Number(byPeriod['2026-06-01'].occupied_room_nights)).toBe(1);
    expect(Number(byPeriod['2026-06-02'].available_room_nights)).toBe(4);
    expect(Number(byPeriod['2026-06-02'].occupied_room_nights)).toBe(2);
    expect(Number(byPeriod['2026-06-03'].available_room_nights)).toBe(4);
    expect(Number(byPeriod['2026-06-03'].occupied_room_nights)).toBe(2);

    // Daily rates
    expect(Number(byPeriod['2026-06-01'].occupancy_rate)).toBeCloseTo(0.25, 4);
    expect(Number(byPeriod['2026-06-02'].occupancy_rate)).toBeCloseTo(0.5, 4);
    expect(Number(byPeriod['2026-06-03'].occupancy_rate)).toBeCloseTo(0.5, 4);
  });

  test('GET /reports/adr daily — exact ADR per night', async () => {
    const res = await request(app)
      .get(`/reports/adr?from=${FROM}&to=${TO}&propertyId=${PROP_ID}&groupBy=day`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const byPeriod: Record<string, any> = Object.fromEntries(
      (res.body as any[]).map(r => [r.period, r])
    );

    // 06-01: revenue = 100, occupied = 1 → ADR 100
    expect(Number(byPeriod['2026-06-01'].adr_cents)).toBe(100);
    // 06-02: revenue = 100 + 200 = 300, occupied = 2 → ADR 150
    expect(Number(byPeriod['2026-06-02'].adr_cents)).toBe(150);
    // 06-03: same as 06-02 → ADR 150
    expect(Number(byPeriod['2026-06-03'].adr_cents)).toBe(150);
  });

  test('GET /reports/revpar daily — exact RevPAR per night', async () => {
    const res = await request(app)
      .get(`/reports/revpar?from=${FROM}&to=${TO}&propertyId=${PROP_ID}&groupBy=day`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const byPeriod: Record<string, any> = Object.fromEntries(
      (res.body as any[]).map(r => [r.period, r])
    );

    // 06-01: revenue 100, available 4 → 25
    expect(Number(byPeriod['2026-06-01'].revpar_cents)).toBe(25);
    // 06-02: revenue 300, available 4 → 75
    expect(Number(byPeriod['2026-06-02'].revpar_cents)).toBe(75);
    // 06-03: revenue 300, available 4 → 75
    expect(Number(byPeriod['2026-06-03'].revpar_cents)).toBe(75);
  });

  // ─── Edge cases ────────────────────────────────────────────────────
  test('zero available nights — empty range outside seeded dates', async () => {
    // 2026-12-01 .. 2026-12-01: still 4 available (rooms exist) but 0 occupied
    const res = await request(app)
      .get(`/reports/occupancy?from=2026-12-01&to=2026-12-01&propertyId=${PROP_ID}&groupBy=day`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = (res.body as any[])[0];
    expect(Number(row.available_room_nights)).toBe(4);
    expect(Number(row.occupied_room_nights)).toBe(0);
    // 0/4 = 0
    expect(Number(row.occupancy_rate)).toBe(0);
  });

  test('cancelled reservation never appears in occupied/revenue', async () => {
    // res3 (cancelled) covers 2026-06-01 R3. Occupied for that night
    // is exactly 1 (res1). If cancelled were counted it would be 2.
    const res = await request(app)
      .get(`/reports/occupancy?from=2026-06-01&to=2026-06-01&propertyId=${PROP_ID}&groupBy=day`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Number((res.body as any[])[0].occupied_room_nights)).toBe(1);
  });

  test('check-out is exclusive — last night of res1 is 06-03, NOT 06-04', async () => {
    // res1 has check_out 06-04. 06-04 should NOT be counted as occupied.
    const res = await request(app)
      .get(`/reports/occupancy?from=2026-06-04&to=2026-06-04&propertyId=${PROP_ID}&groupBy=day`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = (res.body as any[])[0];
    expect(Number(row.occupied_room_nights)).toBe(0);
  });

  test('maintenance room is excluded from available', async () => {
    // We seeded 5 rooms total but only 4 available. Available_room_nights
    // for one night must be 4, NOT 5.
    const res = await request(app)
      .get(`/reports/occupancy?from=2026-06-01&to=2026-06-01&propertyId=${PROP_ID}&groupBy=day`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Number((res.body as any[])[0].available_room_nights)).toBe(4);
  });

  test('weekly rollup folds 3 daily rows into one period', async () => {
    const res = await request(app)
      .get(`/reports/occupancy?from=${FROM}&to=${TO}&propertyId=${PROP_ID}&groupBy=week`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    expect(rows.length).toBe(1);
    expect(Number(rows[0].available_room_nights)).toBe(12); // 4 × 3
    expect(Number(rows[0].occupied_room_nights)).toBe(5);   // 1+2+2
    expect(Number(rows[0].occupancy_rate)).toBeCloseTo(5 / 12, 4);
  });
});
