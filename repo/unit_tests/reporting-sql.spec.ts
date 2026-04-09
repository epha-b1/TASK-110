/**
 * Unit tests for the room-night reporting SQL builder.
 *
 * These tests spy on `sequelize.query` and assert structural properties
 * of the generated SQL — they would fail loudly if the room-night
 * fix were ever silently reverted.
 */

import { sequelize } from '../src/config/database';
import { occupancy, adr, revpar } from '../src/services/reporting.service';

describe('reporting service — SQL fragment shape', () => {
  beforeEach(() => {
    (sequelize.query as jest.Mock).mockReset().mockResolvedValue([]);
  });

  function lastSql(): string {
    return (sequelize.query as jest.Mock).mock.calls[0][0] as string;
  }

  function lastReplacements(): unknown[] {
    return ((sequelize.query as jest.Mock).mock.calls[0][1] as { replacements: unknown[] }).replacements;
  }

  describe('occupancy', () => {
    test('contains recursive calendar CTE', async () => {
      await occupancy({ from: '2026-06-01', to: '2026-06-03' });
      expect(lastSql()).toMatch(/WITH RECURSIVE calendar/);
    });

    test('uses check-in inclusive, check-out exclusive', async () => {
      await occupancy({ from: '2026-06-01', to: '2026-06-03' });
      const sql = lastSql();
      expect(sql).toMatch(/cal\.night >= res\.check_in_date/);
      expect(sql).toMatch(/cal\.night <\s+res\.check_out_date/);
    });

    test('excludes maintenance rooms from available count', async () => {
      await occupancy({ from: '2026-06-01', to: '2026-06-03' });
      expect(lastSql()).toMatch(/rm\.status <> 'maintenance'/);
    });

    test('includes occupancy_rate column in output', async () => {
      await occupancy({ from: '2026-06-01', to: '2026-06-03' });
      expect(lastSql()).toMatch(/occupancy_rate/);
    });

    test('NULLIF guards against zero available rooms', async () => {
      await occupancy({ from: '2026-06-01', to: '2026-06-03' });
      expect(lastSql()).toMatch(/NULLIF\(SUM\(available_rooms\), 0\)/);
    });

    test('excludes cancelled reservations', async () => {
      await occupancy({ from: '2026-06-01', to: '2026-06-03' });
      const sql = lastSql();
      expect(sql).toMatch(/res\.status IN \('confirmed','checked_in','checked_out'\)/);
      expect(sql).not.toMatch(/'cancelled'/);
    });

    test('manager scope override takes precedence over caller propertyId', async () => {
      await occupancy({ from: '2026-06-01', to: '2026-06-03', propertyId: 'caller-prop' }, 'manager-prop');
      const reps = lastReplacements();
      expect(reps).toContain('manager-prop');
      expect(reps).not.toContain('caller-prop');
    });

    test('room type filter is positional and replicated for both subqueries', async () => {
      await occupancy({ from: '2026-06-01', to: '2026-06-03', roomType: 'suite' });
      const reps = lastReplacements();
      // 'suite' should appear in both available and occupied filters
      const occ = reps.filter(r => r === 'suite').length;
      expect(occ).toBe(2);
    });

    test('day grouping uses YYYY-MM-DD format', async () => {
      await occupancy({ from: '2026-06-01', to: '2026-06-03', groupBy: 'day' });
      expect(lastSql()).toMatch(/DATE_FORMAT\(night, '%Y-%m-%d'\)/);
    });

    test('week grouping uses ISO week format', async () => {
      await occupancy({ from: '2026-06-01', to: '2026-06-03', groupBy: 'week' });
      expect(lastSql()).toMatch(/DATE_FORMAT\(night, '%x-W%v'\)/);
    });

    test('month grouping uses YYYY-MM format', async () => {
      await occupancy({ from: '2026-06-01', to: '2026-06-03', groupBy: 'month' });
      expect(lastSql()).toMatch(/DATE_FORMAT\(night, '%Y-%m'\)/);
    });
  });

  describe('adr', () => {
    test('formula is revenue / occupied (room-nights)', async () => {
      await adr({ from: '2026-06-01', to: '2026-06-03' });
      expect(lastSql()).toMatch(/SUM\(revenue_cents\)\s*\/\s*NULLIF\(SUM\(occupied_rooms\), 0\)/);
    });
  });

  describe('revpar', () => {
    test('formula is revenue / available (room-nights)', async () => {
      await revpar({ from: '2026-06-01', to: '2026-06-03' });
      expect(lastSql()).toMatch(/SUM\(revenue_cents\)\s*\/\s*NULLIF\(SUM\(available_rooms\), 0\)/);
    });
  });
});
