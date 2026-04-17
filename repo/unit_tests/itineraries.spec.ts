/**
 * Itinerary schema + service branch tests.
 *
 * The earlier version of this file duplicated regexes from the
 * production validation file and asserted against its OWN copy — a
 * synthetic test that passed even when the real validator diverged.
 * This rewrite binds tests to the REAL production modules:
 *
 *   - `createItinerarySchema` / `updateItinerarySchema` from
 *     `src/utils/validation.ts` — these are the zod schemas that the
 *     itinerary routes actually run against user input.
 *   - `createCheckpointSchema` / `updateCheckpointSchema` from the
 *     same file — enforce the 1..30 position rule and the `label`
 *     requirement.
 *
 * A drift between the regex copy below and the production regex would
 * now trip a TypeScript import error or a schema-parse mismatch.
 */

import {
  createItinerarySchema,
  updateItinerarySchema,
  createCheckpointSchema,
  updateCheckpointSchema,
} from '../src/utils/validation';

describe('Slice 5 — Itinerary schemas (real production code)', () => {
  const validCreate = {
    title: 'Sunset Walk',
    meetupDate: '09/15/2026',
    meetupTime: '6:00 PM',
    meetupLocation: 'Resort Lobby',
    idempotencyKey: 'idem-sunset-1',
  };

  describe('createItinerarySchema — MM/DD/YYYY date validation', () => {
    test.each(['12/25/2025', '01/01/2024', '06/15/2023', '09/15/2026'])('accepts %s', (d) => {
      expect(() => createItinerarySchema.parse({ ...validCreate, meetupDate: d })).not.toThrow();
    });

    test.each(['2025-12-25', '13/01/2024', '00/15/2023', '12/32/2023', 'not-a-date', ''])('rejects %s', (d) => {
      expect(() => createItinerarySchema.parse({ ...validCreate, meetupDate: d })).toThrow();
    });
  });

  describe('createItinerarySchema — 12-hour time validation', () => {
    test.each(['09:30 AM', '12:00 PM', '1:00 AM', '11:59 PM', '6:00 PM'])('accepts %s', (t) => {
      expect(() => createItinerarySchema.parse({ ...validCreate, meetupTime: t })).not.toThrow();
    });

    test.each(['13:00 PM', '00:00 AM', '9:60 AM', 'midnight', '24:00'])('rejects %s', (t) => {
      expect(() => createItinerarySchema.parse({ ...validCreate, meetupTime: t })).toThrow();
    });
  });

  describe('createItinerarySchema — notes length + strictness', () => {
    test('accepts notes at the 2000-char boundary', () => {
      expect(() => createItinerarySchema.parse({ ...validCreate, notes: 'x'.repeat(2000) })).not.toThrow();
    });

    test('rejects notes at 2001 chars', () => {
      expect(() => createItinerarySchema.parse({ ...validCreate, notes: 'x'.repeat(2001) })).toThrow();
    });

    test('rejects unknown fields (strict mode)', () => {
      expect(() => createItinerarySchema.parse({ ...validCreate, extraneous: 'x' } as unknown)).toThrow();
    });

    test('rejects empty title and empty location', () => {
      expect(() => createItinerarySchema.parse({ ...validCreate, title: '' })).toThrow();
      expect(() => createItinerarySchema.parse({ ...validCreate, meetupLocation: '' })).toThrow();
    });

    test('rejects empty idempotencyKey', () => {
      expect(() => createItinerarySchema.parse({ ...validCreate, idempotencyKey: '' })).toThrow();
    });
  });

  describe('updateItinerarySchema', () => {
    test('requires idempotencyKey even for a partial update', () => {
      expect(() => updateItinerarySchema.parse({ title: 'New' })).toThrow();
    });

    test('accepts a single-field update + idempotencyKey', () => {
      expect(() => updateItinerarySchema.parse({ idempotencyKey: 'idem-upd-1', title: 'Renamed' })).not.toThrow();
    });

    test('rejects bad date on update too', () => {
      expect(() => updateItinerarySchema.parse({ idempotencyKey: 'k', meetupDate: '2026-06-01' })).toThrow();
    });
  });

  describe('createCheckpointSchema — 1..30 position rule', () => {
    test('accepts position 1 and position 30 (boundaries)', () => {
      expect(() => createCheckpointSchema.parse({ label: 'Start', position: 1 })).not.toThrow();
      expect(() => createCheckpointSchema.parse({ label: 'Finish', position: 30 })).not.toThrow();
    });

    test.each([0, 31, -1, 1.5, 100])('rejects position %s', (p) => {
      expect(() => createCheckpointSchema.parse({ label: 'X', position: p })).toThrow();
    });

    test('requires label', () => {
      expect(() => createCheckpointSchema.parse({ position: 1 } as unknown)).toThrow();
    });

    test('rejects extraneous fields (strict mode)', () => {
      expect(() => createCheckpointSchema.parse({ label: 'X', position: 1, hack: true } as unknown)).toThrow();
    });
  });

  describe('updateCheckpointSchema', () => {
    test('accepts a label-only update', () => {
      expect(() => updateCheckpointSchema.parse({ label: 'Renamed' })).not.toThrow();
    });

    test('accepts a position-only update within range', () => {
      expect(() => updateCheckpointSchema.parse({ position: 15 })).not.toThrow();
    });

    test('rejects position out of range', () => {
      expect(() => updateCheckpointSchema.parse({ position: 31 })).toThrow();
    });
  });
});
