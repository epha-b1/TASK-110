import { z } from 'zod';

export const registerSchema = z.object({
  username: z.string().min(1, 'username is required'),
  password: z.string().min(10, 'Password must be at least 10 characters'),
});

export const loginSchema = z.object({
  username: z.string().min(1, 'username is required'),
  password: z.string().min(1, 'password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10),
});

export const createGroupSchema = z.object({
  name: z.string().min(1, 'Group name is required'),
});

export const joinGroupSchema = z.object({
  joinCode: z.string().min(1, 'Join code is required'),
});

// MM/DD/YYYY (per business prompt) and 12-hour clock formats.
const MMDDYYYY = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
const TIME_12H = /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i;

export const createItinerarySchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(255, 'Title must be ≤ 255 chars'),
  meetupDate: z.string().regex(MMDDYYYY, 'meetupDate must be MM/DD/YYYY'),
  meetupTime: z.string().regex(TIME_12H, 'meetupTime must be HH:MM AM/PM (12-hour)'),
  meetupLocation: z.string().trim().min(1, 'meetupLocation is required').max(500, 'meetupLocation must be ≤ 500 chars'),
  idempotencyKey: z.string().trim().min(1, 'idempotencyKey is required').max(255, 'idempotencyKey must be ≤ 255 chars'),
  notes: z.string().max(2000, 'notes must be ≤ 2000 chars').optional(),
}).strict();

export const updateItinerarySchema = z.object({
  idempotencyKey: z.string().trim().min(1, 'idempotencyKey is required').max(255),
  title: z.string().trim().min(1).max(255).optional(),
  meetupDate: z.string().regex(MMDDYYYY, 'meetupDate must be MM/DD/YYYY').optional(),
  meetupTime: z.string().regex(TIME_12H, 'meetupTime must be HH:MM AM/PM (12-hour)').optional(),
  meetupLocation: z.string().trim().min(1).max(500).optional(),
  notes: z.string().max(2000).optional(),
}).strict();

// Checkpoints per item: position 1..30, label required.
export const createCheckpointSchema = z.object({
  label: z.string().trim().min(1, 'label is required').max(255),
  position: z.number().int().min(1).max(30, 'position must be 1..30'),
  description: z.string().max(2000).optional(),
}).strict();

export const updateCheckpointSchema = z.object({
  label: z.string().trim().min(1).max(255).optional(),
  position: z.number().int().min(1).max(30).optional(),
  description: z.string().max(2000).optional(),
}).strict();

export const importUploadSchema = z.object({
  datasetType: z.enum(['staffing', 'evaluation']),
});

// Reusable date / range constraints for reports.
//
// We accept two date formats so the schema is forgiving but strict:
//   - YYYY-MM-DD (server-side canonical)
//   - MM/DD/YYYY (matches the rest of the API's display convention)
// Both are normalized to YYYY-MM-DD before being sent to SQL.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const reportDate = z.string().regex(ISO_DATE, 'date must be YYYY-MM-DD');
const reportGroupBy = z.enum(['day', 'week', 'month']);
const reportType   = z.enum(['occupancy', 'adr', 'revpar', 'revenue_mix']);
const reportFormat = z.enum(['csv', 'excel']);
const propertyIdSchema = z.string().min(1).max(64);

export const reportQuerySchema = z
  .object({
    from: reportDate,
    to: reportDate,
    groupBy: reportGroupBy.optional(),
    propertyId: propertyIdSchema.optional(),
    roomType: z.string().min(1).max(100).optional(),
  })
  .refine((v) => v.from <= v.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

export const revenueMixQuerySchema = z
  .object({
    from: reportDate,
    to: reportDate,
    groupBy: z.enum(['channel', 'room_type']).optional(),
    propertyId: propertyIdSchema.optional(),
  })
  .refine((v) => v.from <= v.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

export const reportExportSchema = z
  .object({
    reportType,
    from: reportDate,
    to: reportDate,
    format: reportFormat,
    groupBy: reportGroupBy.optional(),
    propertyId: propertyIdSchema.optional(),
    // roomType mirrors the constraint used in reportQuerySchema so the
    // KPI endpoints (/reports/adr, /reports/revpar, /reports/occupancy)
    // and /reports/export agree on what a "room type" is. Optional —
    // absent means "all room types" (same semantics as the GET path).
    roomType: z.string().min(1).max(100).optional(),
    includePii: z.boolean().optional(),
  })
  .refine((v) => v.from <= v.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

// --- Account profile (/accounts/me) ---------------------------------------
// The prompt frames users as US-based customers; we enforce:
//   * state   — 2-letter uppercase US state / territory code
//   * zip     — US ZIP (5 digits) or ZIP+4 (5-4)
//   * currency— ISO 4217 3-letter uppercase code
// Field length bounds mirror the DB column lengths in users model so rejecting
// at the edge prevents silent truncation later.

const US_STATE_CODES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
  // US territories and DC
  'DC','AS','GU','MP','PR','VI',
] as const;

const US_ZIP_REGEX = /^\d{5}(-\d{4})?$/;
const CURRENCY_REGEX = /^[A-Z]{3}$/;

export const updateProfileSchema = z
  .object({
    legalName: z.string().trim().min(1).max(255).optional(),
    addressLine1: z.string().trim().min(1).max(255).optional(),
    addressLine2: z.string().trim().max(255).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    state: z
      .string()
      .trim()
      .length(2, 'state must be a 2-letter US state code')
      .regex(/^[A-Z]{2}$/, 'state must be uppercase 2-letter US state code')
      .refine((s) => (US_STATE_CODES as readonly string[]).includes(s), {
        message: 'state must be a valid US state/territory code',
      })
      .optional(),
    zip: z
      .string()
      .trim()
      .regex(US_ZIP_REGEX, 'zip must be a US ZIP (12345) or ZIP+4 (12345-6789)')
      .optional(),
    taxInvoiceTitle: z.string().trim().max(255).optional(),
    preferredCurrency: z
      .string()
      .trim()
      .regex(CURRENCY_REGEX, 'preferredCurrency must be a 3-letter ISO 4217 code (e.g. USD, EUR)')
      .optional(),
  })
  .strict();
