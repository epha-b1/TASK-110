/**
 * Unit tests for newly added zod schemas covering critical endpoints.
 *
 * These pin the schema contracts so any future drift between the
 * schema and the controller's expectations fails fast at unit-test time.
 */

import {
  createItinerarySchema,
  updateItinerarySchema,
  createCheckpointSchema,
  updateCheckpointSchema,
  reportQuerySchema,
  revenueMixQuerySchema,
  reportExportSchema,
} from '../src/utils/validation';

describe('createItinerarySchema', () => {
  const valid = {
    title: 'Morning Hike',
    meetupDate: '06/01/2026',
    meetupTime: '9:00 AM',
    meetupLocation: 'Lobby',
    idempotencyKey: 'k1',
  };

  test('accepts a minimal valid payload', () => {
    expect(() => createItinerarySchema.parse(valid)).not.toThrow();
  });

  test('rejects bad meetupDate (ISO format)', () => {
    expect(() => createItinerarySchema.parse({ ...valid, meetupDate: '2026-06-01' })).toThrow();
  });

  test('rejects bad meetupTime (24h)', () => {
    expect(() => createItinerarySchema.parse({ ...valid, meetupTime: '13:00' })).toThrow();
  });

  test('rejects empty title', () => {
    expect(() => createItinerarySchema.parse({ ...valid, title: '' })).toThrow();
  });

  test('rejects empty idempotencyKey', () => {
    expect(() => createItinerarySchema.parse({ ...valid, idempotencyKey: '' })).toThrow();
  });

  test('rejects notes > 2000 chars', () => {
    expect(() => createItinerarySchema.parse({ ...valid, notes: 'x'.repeat(2001) })).toThrow();
  });

  test('rejects unknown fields (strict)', () => {
    expect(() => createItinerarySchema.parse({ ...valid, role: 'admin' })).toThrow();
  });
});

describe('updateItinerarySchema', () => {
  test('requires idempotencyKey', () => {
    expect(() => updateItinerarySchema.parse({ title: 'X' })).toThrow();
  });

  test('accepts partial update', () => {
    expect(() => updateItinerarySchema.parse({ idempotencyKey: 'k1', title: 'New' })).not.toThrow();
  });

  test('validates date format if provided', () => {
    expect(() => updateItinerarySchema.parse({ idempotencyKey: 'k1', meetupDate: '2026-06-01' })).toThrow();
  });
});

describe('createCheckpointSchema', () => {
  test('accepts position 1..30', () => {
    expect(() => createCheckpointSchema.parse({ label: 'A', position: 1 })).not.toThrow();
    expect(() => createCheckpointSchema.parse({ label: 'A', position: 30 })).not.toThrow();
  });

  test('rejects position 0 and 31', () => {
    expect(() => createCheckpointSchema.parse({ label: 'A', position: 0 })).toThrow();
    expect(() => createCheckpointSchema.parse({ label: 'A', position: 31 })).toThrow();
  });

  test('rejects non-integer position', () => {
    expect(() => createCheckpointSchema.parse({ label: 'A', position: 1.5 })).toThrow();
  });

  test('requires label', () => {
    expect(() => createCheckpointSchema.parse({ position: 1 } as any)).toThrow();
  });

  test('rejects unknown fields', () => {
    expect(() => createCheckpointSchema.parse({ label: 'A', position: 1, hax: true } as any)).toThrow();
  });
});

describe('updateCheckpointSchema', () => {
  test('accepts a single field update', () => {
    expect(() => updateCheckpointSchema.parse({ label: 'New' })).not.toThrow();
    expect(() => updateCheckpointSchema.parse({ position: 5 })).not.toThrow();
  });

  test('rejects bad position', () => {
    expect(() => updateCheckpointSchema.parse({ position: 50 })).toThrow();
  });
});

describe('reportQuerySchema', () => {
  test('accepts a valid range', () => {
    expect(() => reportQuerySchema.parse({ from: '2026-06-01', to: '2026-06-30' })).not.toThrow();
  });

  test('accepts groupBy day/week/month', () => {
    expect(() => reportQuerySchema.parse({ from: '2026-06-01', to: '2026-06-30', groupBy: 'day' })).not.toThrow();
    expect(() => reportQuerySchema.parse({ from: '2026-06-01', to: '2026-06-30', groupBy: 'week' })).not.toThrow();
    expect(() => reportQuerySchema.parse({ from: '2026-06-01', to: '2026-06-30', groupBy: 'month' })).not.toThrow();
  });

  test('rejects invalid groupBy', () => {
    expect(() => reportQuerySchema.parse({ from: '2026-06-01', to: '2026-06-30', groupBy: 'year' })).toThrow();
  });

  test('rejects bad date format', () => {
    expect(() => reportQuerySchema.parse({ from: '06/01/2026', to: '2026-06-30' })).toThrow();
    expect(() => reportQuerySchema.parse({ from: '2026-06-01', to: 'tomorrow' })).toThrow();
  });

  test('rejects from > to (date order)', () => {
    expect(() => reportQuerySchema.parse({ from: '2026-12-31', to: '2026-01-01' })).toThrow();
  });

  test('accepts from === to', () => {
    expect(() => reportQuerySchema.parse({ from: '2026-06-01', to: '2026-06-01' })).not.toThrow();
  });
});

describe('revenueMixQuerySchema', () => {
  test('accepts groupBy channel and room_type', () => {
    expect(() => revenueMixQuerySchema.parse({ from: '2026-06-01', to: '2026-06-30', groupBy: 'channel' })).not.toThrow();
    expect(() => revenueMixQuerySchema.parse({ from: '2026-06-01', to: '2026-06-30', groupBy: 'room_type' })).not.toThrow();
  });

  test('rejects other groupBy values', () => {
    expect(() => revenueMixQuerySchema.parse({ from: '2026-06-01', to: '2026-06-30', groupBy: 'day' })).toThrow();
  });
});

describe('reportExportSchema', () => {
  const valid = {
    reportType: 'occupancy' as const,
    from: '2026-06-01',
    to: '2026-06-30',
    format: 'csv' as const,
  };

  test('accepts a minimal valid body', () => {
    expect(() => reportExportSchema.parse(valid)).not.toThrow();
  });

  test('rejects unknown reportType', () => {
    expect(() => reportExportSchema.parse({ ...valid, reportType: 'gop' })).toThrow();
  });

  test('rejects unknown format', () => {
    expect(() => reportExportSchema.parse({ ...valid, format: 'pdf' })).toThrow();
  });

  test('rejects from > to', () => {
    expect(() => reportExportSchema.parse({ ...valid, from: '2026-12-31', to: '2026-01-01' })).toThrow();
  });

  test('accepts includePii boolean', () => {
    expect(() => reportExportSchema.parse({ ...valid, includePii: true })).not.toThrow();
  });

  test('rejects non-boolean includePii', () => {
    expect(() => reportExportSchema.parse({ ...valid, includePii: 'yes' as any })).toThrow();
  });
});
