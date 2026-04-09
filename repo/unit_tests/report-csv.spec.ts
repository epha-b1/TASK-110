/**
 * Unit tests for the reports CSV serializer.
 *
 * The reports controller writes CSV files via serializeReportRowsToCsv,
 * which is the same `objectsToCsv` pipeline used for the audit export.
 * These tests pin the safety properties at the report controller layer
 * specifically — if a future change replaces serializeReportRowsToCsv
 * with a hand-rolled `Object.values().join(',')` (the original bug),
 * these tests should fail.
 *
 * Edge cases covered: empty input, simple values, embedded quotes,
 * embedded commas, embedded newlines, leading formula triggers
 * (=, +, -, @, tab), missing columns, null values, numeric values.
 */

import { serializeReportRowsToCsv } from '../src/controllers/reports.controller';

describe('serializeReportRowsToCsv', () => {
  test('empty input → empty string', () => {
    expect(serializeReportRowsToCsv([])).toBe('');
  });

  test('happy path: scalar columns are quoted but inert', () => {
    const csv = serializeReportRowsToCsv([
      { period: '2025-06-01', occupied_rooms: 5, total_rooms: 10 },
      { period: '2025-06-02', occupied_rooms: 7, total_rooms: 10 },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"period","occupied_rooms","total_rooms"');
    expect(lines[1]).toBe('"2025-06-01","5","10"');
    expect(lines[2]).toBe('"2025-06-02","7","10"');
  });

  test('embedded comma is preserved within a single quoted field', () => {
    const csv = serializeReportRowsToCsv([{ name: 'Doe, John', n: 1 }]);
    expect(csv).toContain('"Doe, John"');
    // Field count is 2 (one comma is the separator, the other is inside the quotes)
    const lines = csv.split('\r\n');
    expect(lines[1].split(',').length).toBe(3); // "Doe, John" splits into 2 because of the literal comma
    // The single field "Doe, John" wraps the literal comma so we look for the delimiter pattern
    expect(lines[1]).toBe('"Doe, John","1"');
  });

  test('embedded newline does NOT terminate the row', () => {
    const csv = serializeReportRowsToCsv([{ note: 'line1\nline2', n: 1 }]);
    expect(csv).toContain('"line1\nline2"');
    // The output still has only ONE row body (header + 1 data row),
    // i.e. the row's own \n does not become a record separator.
    const recordSep = '\r\n';
    expect(csv.split(recordSep).length).toBe(2);
  });

  test('embedded double quote is doubled', () => {
    const csv = serializeReportRowsToCsv([{ note: 'say "hi"' }]);
    expect(csv).toContain('"say ""hi"""');
  });

  test('formula trigger = is neutralized', () => {
    const csv = serializeReportRowsToCsv([{ payload: '=SUM(A1:A9)' }]);
    expect(csv).toContain('"\'=SUM(A1:A9)"');
  });

  test('formula trigger + is neutralized', () => {
    const csv = serializeReportRowsToCsv([{ payload: '+1+1' }]);
    expect(csv).toContain('"\'+1+1"');
  });

  test('formula trigger - is neutralized', () => {
    const csv = serializeReportRowsToCsv([{ payload: '-2' }]);
    expect(csv).toContain('"\'-2"');
  });

  test('formula trigger @ is neutralized', () => {
    const csv = serializeReportRowsToCsv([{ payload: '@cmd' }]);
    expect(csv).toContain('"\'@cmd"');
  });

  test('leading tab is neutralized (DDE-style attack)', () => {
    const csv = serializeReportRowsToCsv([{ payload: '\t=1+1' }]);
    expect(csv).toContain('"\'\t=1+1"');
  });

  test('non-leading formula char is NOT neutralized', () => {
    const csv = serializeReportRowsToCsv([{ payload: 'a=b' }]);
    expect(csv).toContain('"a=b"');
    expect(csv).not.toContain('"\'a=b"');
  });

  test('null cells become empty quoted strings', () => {
    const csv = serializeReportRowsToCsv([{ a: 'x', b: null }]);
    expect(csv).toContain('"x",""');
  });

  test('column order is taken from the first row', () => {
    const csv = serializeReportRowsToCsv([{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6 }]);
    expect(csv.split('\r\n')[0]).toBe('"a","b","c"');
  });

  test('rows missing later columns produce empty cells, not crashes', () => {
    const csv = serializeReportRowsToCsv([{ a: 1, b: 2 }, { a: 3 } as any]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"a","b"');
    expect(lines[1]).toBe('"1","2"');
    expect(lines[2]).toBe('"3",""');
  });

  test('regression: dangerous string never appears unescaped anywhere in output', () => {
    const dangerous = '=cmd|"/c calc"!A1';
    const csv = serializeReportRowsToCsv([{ payload: dangerous }]);
    // Either the literal dangerous string is escaped (with leading ')
    // or doubled-quoted internally — but the raw string starting with =
    // must NOT appear in any cell.
    expect(csv).not.toMatch(/(^|,)"=cmd/);
    // The escaped form must appear.
    expect(csv).toContain('"\'=cmd');
  });
});
