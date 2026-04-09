/**
 * /reports/export — roomType filter end-to-end.
 *
 * The original audit fix wired `roomType` into the GET KPI endpoints
 * (`/reports/{occupancy,adr,revpar}`) but NOT into the
 * `POST /reports/export` path. The export request schema didn't accept
 * it and the controller never forwarded it, so downloading a CSV /
 * Excel report was silently broader than the live dashboard that
 * produced it.
 *
 * These tests prove the fix by:
 *   - issuing POST /reports/export with and without `roomType`
 *   - fetching the generated CSV through the ownership-gated
 *     /exports/:filename download route
 *   - asserting the exported numbers EXACTLY match the expected
 *     per-room-type aggregates, and that filtered exports differ from
 *     the blended unfiltered baseline
 *   - validating the new schema constraint rejects empty/oversized
 *     roomType strings with 400 VALIDATION_ERROR
 *
 * Fixture (isolated property so totals are deterministic):
 *
 *   Property: "rt-export-test-<RUN_TAG>"
 *   Rooms:
 *     R_STD_1  standard  rate 10000  available
 *     R_STD_2  standard  rate 10000  available
 *     R_DLX_1  deluxe    rate 20000  available
 *   Range:    2026-08-01 .. 2026-08-02  (2 nights)
 *   Reservations (all confirmed):
 *     res_std  R_STD_1  08-01 → 08-03  rate 100  → 2 standard nights
 *     res_dlx  R_DLX_1  08-01 → 08-03  rate 400  → 2 deluxe   nights
 *
 * Expected aggregates:
 *
 *   ADR — occupied_room_nights and revenue_cents:
 *     no filter:        occupied=4  revenue=1000  adr_cents=250
 *     roomType=standard occupied=2  revenue=200   adr_cents=100
 *     roomType=deluxe   occupied=2  revenue=800   adr_cents=400
 *
 *   RevPAR — available_room_nights and revenue_cents:
 *     no filter:        available=6  revenue=1000  revpar_cents≈166.67
 *     roomType=standard available=4  revenue=200   revpar_cents=50
 *     roomType=deluxe   available=2  revenue=800   revpar_cents=400
 */

import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../src/app';
import { sequelize } from '../src/config/database';
import { Property, Room, Reservation } from '../src/models/property.model';
import { describeDb } from './db-guard';

const RUN_TAG = `rte-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PROP_ID = uuidv4();
const FROM = '2026-08-01';
const TO   = '2026-08-02';

let adminToken: string;

/**
 * Minimal CSV parser good enough for the shape we produce in
 * `reports.controller.serializeReportRowsToCsv`: header row + numeric
 * body rows, every cell is always wrapped in double quotes, no
 * embedded commas or newlines in cell values.
 *
 * We deliberately avoid adding a CSV parsing dep just for these tests.
 */
function parseExportCsv(body: string): Array<Record<string, string>> {
  const lines = body.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const parseRow = (line: string): string[] => {
    // Every cell is `"..."` and separated by `","` except at the very
    // start/end. Drop the leading and trailing quote, then split on
    // `","`. This is safe because our cells never contain that
    // delimiter sequence (only numeric or date values).
    const inner = line.replace(/^"/, '').replace(/"$/, '');
    return inner.split('","');
  };

  const headers = parseRow(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

async function exportAndDownload(body: Record<string, unknown>): Promise<{
  status: number;
  downloadUrl: string;
  csv: string;
  rows: Array<Record<string, string>>;
}> {
  const exportRes = await request(app)
    .post('/reports/export')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
  if (exportRes.status !== 200) {
    return { status: exportRes.status, downloadUrl: '', csv: '', rows: [] };
  }
  const downloadUrl = exportRes.body.downloadUrl as string;
  const dlRes = await request(app)
    .get(downloadUrl)
    .set('Authorization', `Bearer ${adminToken}`)
    .buffer(true)
    .parse((res, callback) => {
      // supertest defaults to JSON/text parsing for unknown types;
      // force a raw buffer parse so we can read the exact CSV bytes
      // regardless of the response content-type.
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  expect(dlRes.status).toBe(200);
  const csv: string = Buffer.isBuffer(dlRes.body)
    ? dlRes.body.toString('utf8')
    : (typeof dlRes.text === 'string' ? dlRes.text : '');
  return { status: 200, downloadUrl, csv, rows: parseExportCsv(csv) };
}

describeDb('Reports export roomType filter — POST /reports/export', () => {
  beforeAll(async () => {
    await sequelize.authenticate();
    adminToken = (await request(app).post('/auth/login').send({
      username: 'admin', password: 'Admin1!pass',
    })).body.accessToken;

    const now = new Date();
    await Property.create({
      id: PROP_ID, name: `rt-export-test-${RUN_TAG}`, address: 'rt-export test',
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
        channel: 'direct', check_in_date: '2026-08-01', check_out_date: '2026-08-03',
        rate_cents: 100, status: 'confirmed', created_at: now, updated_at: now } as any,
      { id: uuidv4(), property_id: PROP_ID, room_id: rDlx1, guest_name: 'DLX',
        channel: 'direct', check_in_date: '2026-08-01', check_out_date: '2026-08-03',
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

  // ─── ADR export ──────────────────────────────────────────────────

  test('POST /reports/export adr — no roomType: blended CSV', async () => {
    const { csv, rows } = await exportAndDownload({
      reportType: 'adr', from: FROM, to: TO,
      format: 'csv', propertyId: PROP_ID, groupBy: 'month',
    });
    expect(csv.length).toBeGreaterThan(0);
    expect(rows.length).toBe(1);
    // (100*2 + 400*2) / (2+2) = 250
    expect(Number(rows[0].adr_cents)).toBe(250);
    expect(Number(rows[0].occupied_room_nights)).toBe(4);
    expect(Number(rows[0].revenue_cents)).toBe(1000);
  });

  test('POST /reports/export adr — roomType=standard: filtered CSV', async () => {
    const { csv, rows } = await exportAndDownload({
      reportType: 'adr', from: FROM, to: TO,
      format: 'csv', propertyId: PROP_ID, groupBy: 'month', roomType: 'standard',
    });
    expect(csv.length).toBeGreaterThan(0);
    expect(rows.length).toBe(1);
    expect(Number(rows[0].adr_cents)).toBe(100);
    expect(Number(rows[0].occupied_room_nights)).toBe(2);
    expect(Number(rows[0].revenue_cents)).toBe(200);
  });

  test('POST /reports/export adr — roomType=deluxe: filtered CSV', async () => {
    const { rows } = await exportAndDownload({
      reportType: 'adr', from: FROM, to: TO,
      format: 'csv', propertyId: PROP_ID, groupBy: 'month', roomType: 'deluxe',
    });
    expect(rows.length).toBe(1);
    expect(Number(rows[0].adr_cents)).toBe(400);
    expect(Number(rows[0].occupied_room_nights)).toBe(2);
    expect(Number(rows[0].revenue_cents)).toBe(800);
  });

  test('ADR export: filtered CSV differs from unfiltered baseline', async () => {
    const unfiltered = await exportAndDownload({
      reportType: 'adr', from: FROM, to: TO,
      format: 'csv', propertyId: PROP_ID, groupBy: 'month',
    });
    const filtered = await exportAndDownload({
      reportType: 'adr', from: FROM, to: TO,
      format: 'csv', propertyId: PROP_ID, groupBy: 'month', roomType: 'standard',
    });

    // Different aggregate values
    expect(Number(unfiltered.rows[0].adr_cents)).not.toBe(Number(filtered.rows[0].adr_cents));
    expect(Number(unfiltered.rows[0].occupied_room_nights))
      .not.toBe(Number(filtered.rows[0].occupied_room_nights));

    // And the raw CSV bodies themselves differ — this is the byte-level
    // guarantee that if the controller ever stops forwarding roomType,
    // this test fails loudly because the filtered body would equal the
    // unfiltered one.
    expect(filtered.csv).not.toBe(unfiltered.csv);
  });

  // ─── RevPAR export ───────────────────────────────────────────────

  test('POST /reports/export revpar — no roomType: blended CSV', async () => {
    const { rows } = await exportAndDownload({
      reportType: 'revpar', from: FROM, to: TO,
      format: 'csv', propertyId: PROP_ID, groupBy: 'month',
    });
    expect(rows.length).toBe(1);
    expect(Number(rows[0].available_room_nights)).toBe(6); // 3 rooms × 2 nights
    expect(Number(rows[0].revenue_cents)).toBe(1000);
    // 1000 / 6 ≈ 166.67 — SQL ROUND(.., 2)
    expect(Number(rows[0].revpar_cents)).toBeCloseTo(166.67, 2);
  });

  test('POST /reports/export revpar — roomType=standard: filtered CSV', async () => {
    const { rows } = await exportAndDownload({
      reportType: 'revpar', from: FROM, to: TO,
      format: 'csv', propertyId: PROP_ID, groupBy: 'month', roomType: 'standard',
    });
    expect(rows.length).toBe(1);
    // Available: 2 standard rooms × 2 nights = 4
    // Revenue: 100 × 2 = 200
    // RevPAR: 200 / 4 = 50
    expect(Number(rows[0].available_room_nights)).toBe(4);
    expect(Number(rows[0].revenue_cents)).toBe(200);
    expect(Number(rows[0].revpar_cents)).toBe(50);
  });

  test('POST /reports/export revpar — roomType=deluxe: filtered CSV', async () => {
    const { rows } = await exportAndDownload({
      reportType: 'revpar', from: FROM, to: TO,
      format: 'csv', propertyId: PROP_ID, groupBy: 'month', roomType: 'deluxe',
    });
    expect(rows.length).toBe(1);
    // Available: 1 deluxe × 2 nights = 2
    // Revenue: 400 × 2 = 800
    // RevPAR: 800 / 2 = 400
    expect(Number(rows[0].available_room_nights)).toBe(2);
    expect(Number(rows[0].revenue_cents)).toBe(800);
    expect(Number(rows[0].revpar_cents)).toBe(400);
  });

  test('RevPAR export: filtered CSV differs from unfiltered baseline', async () => {
    const unfiltered = await exportAndDownload({
      reportType: 'revpar', from: FROM, to: TO,
      format: 'csv', propertyId: PROP_ID, groupBy: 'month',
    });
    const filtered = await exportAndDownload({
      reportType: 'revpar', from: FROM, to: TO,
      format: 'csv', propertyId: PROP_ID, groupBy: 'month', roomType: 'deluxe',
    });
    expect(Number(unfiltered.rows[0].revpar_cents))
      .not.toBe(Number(filtered.rows[0].revpar_cents));
    expect(filtered.csv).not.toBe(unfiltered.csv);
  });

  // ─── Empty result handling ───────────────────────────────────────

  test('POST /reports/export adr — roomType=nonexistent: empty CSV body', async () => {
    const { rows } = await exportAndDownload({
      reportType: 'adr', from: FROM, to: TO,
      format: 'csv', propertyId: PROP_ID, groupBy: 'month', roomType: 'penthouse',
    });
    // No rows → serializer writes an empty file, parseExportCsv returns
    // no entries. The download succeeds (ownership gate passed).
    expect(rows.length).toBe(0);
  });

  // ─── Negative validation ─────────────────────────────────────────

  test('POST /reports/export 400 — empty roomType rejected', async () => {
    const res = await request(app)
      .post('/reports/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reportType: 'adr', from: FROM, to: TO,
        format: 'csv', propertyId: PROP_ID, roomType: '',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST /reports/export 400 — roomType longer than 100 chars rejected', async () => {
    const res = await request(app)
      .post('/reports/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reportType: 'adr', from: FROM, to: TO,
        format: 'csv', propertyId: PROP_ID,
        roomType: 'x'.repeat(101),
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('POST /reports/export 200 — roomType exactly at the 100-char boundary accepted', async () => {
    const res = await request(app)
      .post('/reports/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        reportType: 'adr', from: FROM, to: TO,
        format: 'csv', propertyId: PROP_ID,
        roomType: 'x'.repeat(100),
      });
    expect(res.status).toBe(200);
    expect(res.body.downloadUrl).toBeDefined();
  });
});
