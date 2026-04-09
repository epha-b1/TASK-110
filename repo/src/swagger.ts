const uuid = { type: 'string', format: 'uuid' };
const str = { type: 'string' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const date = { type: 'string', format: 'date' };
const datetime = { type: 'string', format: 'date-time' };
const obj = (props: Record<string, unknown>) => ({ type: 'object', properties: props });
const arr = (items: unknown) => ({ type: 'array', items });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const bearerAuth = { bearerAuth: [] };

function endpoint(method: string, tag: string, summary: string, opts: Record<string, unknown> = {}) {
  return { [method]: { tags: [tag], summary, security: [bearerAuth], ...opts } };
}

function pub(method: string, tag: string, summary: string, opts: Record<string, unknown> = {}) {
  return { [method]: { tags: [tag], summary, security: [], ...opts } };
}

function params(...list: { name: string; in_: string; schema: unknown; required?: boolean }[]) {
  return list.map(p => ({ name: p.name, in: p.in_, required: p.required !== false, schema: p.schema }));
}

const pathId = (name = 'id') => ({ name, in_: 'path', schema: uuid });
const qStr = (name: string, req = false) => ({ name, in_: 'query', schema: str, required: req });
const qDate = (name: string, req = false) => ({ name, in_: 'query', schema: date, required: req });
const qInt = (name: string) => ({ name, in_: 'query', schema: int, required: false });

const ok = (desc = 'OK') => ({ '200': { description: desc } });
const created = (desc = 'Created') => ({ '201': { description: desc } });
const noContent = { '204': { description: 'No content' } };
const r400 = { '400': { description: 'Validation error' } };
const r401 = { '401': { description: 'Unauthorized' } };
const r403 = { '403': { description: 'Forbidden' } };
const r404 = { '404': { description: 'Not found' } };
const r409 = { '409': { description: 'Conflict' } };

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Hospitality Operations Intelligence API',
    version: '1.0.0',
    description: 'Hospitality Operations Intelligence & Group Itinerary Platform. All endpoints require Bearer JWT unless marked public.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
  security: [bearerAuth],
  tags: [
    { name: 'Health' }, { name: 'Auth' }, { name: 'Accounts' }, { name: 'Users' },
    { name: 'Groups' }, { name: 'Itineraries' }, { name: 'Files' }, { name: 'Notifications' },
    { name: 'Reports' }, { name: 'Import' }, { name: 'Face' }, { name: 'Quality' }, { name: 'Audit' },
  ],
  paths: {
    // ── Health ──
    '/health': pub('get', 'Health', 'Health check', { responses: ok() }),

    // ── Auth ──
    '/auth/register': pub('post', 'Auth', 'Register new user', {
      requestBody: { required: true, content: { 'application/json': { schema: obj({ username: str, password: { ...str, minLength: 10 } }) } } },
      responses: { ...created(), ...r400, ...r409 },
    }),
    '/auth/login': pub('post', 'Auth', 'Login', {
      requestBody: { required: true, content: { 'application/json': { schema: obj({ username: str, password: str }) } } },
      responses: { ...ok(), ...r401, '423': { description: 'Account locked' } },
    }),
    '/auth/logout': endpoint('post', 'Auth', 'Logout', { responses: noContent }),
    '/auth/change-password': endpoint('patch', 'Auth', 'Change password', {
      requestBody: { required: true, content: { 'application/json': { schema: obj({ currentPassword: str, newPassword: str }) } } },
      responses: { ...ok(), ...r400, ...r401 },
    }),

    // ── Accounts ──
    '/accounts/me': {
      ...endpoint('get', 'Accounts', 'Get own profile', { responses: ok() }),
      ...endpoint('patch', 'Accounts', 'Update own profile', {
        requestBody: { content: { 'application/json': { schema: obj({ legalName: str, addressLine1: str, addressLine2: str, city: str, state: str, zip: str, taxInvoiceTitle: str, preferredCurrency: str }) } } },
        responses: ok(),
      }),
    },
    '/accounts/me/delete': endpoint('post', 'Accounts', 'Delete own account', {
      requestBody: { required: true, content: { 'application/json': { schema: obj({ password: str }) } } },
      responses: ok(),
    }),
    '/accounts/me/export': endpoint('post', 'Accounts', 'Export own data as ZIP', {
      responses: {
        '200': {
          description: 'Export ready',
          content: {
            'application/json': {
              schema: obj({
                downloadUrl: { type: 'string', example: '/exports/export-<userId>-<id>.zip' },
                expiresAt: { type: 'string', format: 'date-time', example: '2026-04-10T12:34:56.000Z' },
              }),
            },
          },
        },
        ...r401,
      },
    }),

    // ── Users (Admin) ──
    '/users': endpoint('get', 'Users', 'List all users (admin only)', {
      parameters: params(qInt('page'), qInt('limit')),
      responses: { ...ok(), ...r403 },
    }),
    '/users/{id}': {
      ...endpoint('get', 'Users', 'Get user by ID (admin only)', { parameters: params(pathId()), responses: { ...ok(), ...r404 } }),
      ...endpoint('patch', 'Users', 'Update user (admin only)', { parameters: params(pathId()), responses: { ...ok(), ...r404 } }),
      ...endpoint('delete', 'Users', 'Soft-delete user (admin only)', { parameters: params(pathId()), responses: { ...noContent, ...r404 } }),
    },

    // ── Groups ──
    '/groups': {
      ...endpoint('get', 'Groups', 'List own groups', { responses: ok() }),
      ...endpoint('post', 'Groups', 'Create group', {
        requestBody: { required: true, content: { 'application/json': { schema: obj({ name: str }) } } },
        responses: created(),
      }),
    },
    '/groups/join': endpoint('post', 'Groups', 'Join group by code', {
      requestBody: { required: true, content: { 'application/json': { schema: obj({ joinCode: str }) } } },
      responses: { ...ok(), ...r404, ...r409 },
    }),
    '/groups/{id}': {
      ...endpoint('get', 'Groups', 'Get group details', { parameters: params(pathId()), responses: { ...ok(), ...r403 } }),
      ...endpoint('patch', 'Groups', 'Update group (owner/admin)', { parameters: params(pathId()), responses: ok() }),
    },
    '/groups/{id}/members': endpoint('get', 'Groups', 'List members', { parameters: params(pathId()), responses: ok() }),
    '/groups/{id}/members/{userId}': endpoint('delete', 'Groups', 'Remove member (owner/admin)', {
      parameters: params(pathId(), pathId('userId')),
      responses: { ...noContent, ...r403 },
    }),
    '/groups/{id}/required-fields': {
      ...endpoint('get', 'Groups', 'List required field configs', { parameters: params(pathId()), responses: ok() }),
      ...endpoint('post', 'Groups', 'Add required field config (owner/admin)', {
        parameters: params(pathId()),
        requestBody: { required: true, content: { 'application/json': { schema: obj({ fieldName: str, fieldType: str, isRequired: bool }) } } },
        responses: created(),
      }),
    },
    '/groups/{id}/required-fields/{fieldId}': {
      ...endpoint('patch', 'Groups', 'Update required field config', { parameters: params(pathId(), pathId('fieldId')), responses: ok() }),
      ...endpoint('delete', 'Groups', 'Remove required field config', { parameters: params(pathId(), pathId('fieldId')), responses: noContent }),
    },
    '/groups/{id}/my-fields': {
      ...endpoint('get', 'Groups', 'Get own field values', { parameters: params(pathId()), responses: ok() }),
      ...endpoint('put', 'Groups', 'Submit own field values', { parameters: params(pathId()), responses: ok() }),
    },

    // ── Itineraries ──
    '/groups/{groupId}/itineraries': {
      ...endpoint('get', 'Itineraries', 'List itinerary items', { parameters: params(pathId('groupId')), responses: ok() }),
      ...endpoint('post', 'Itineraries', 'Create itinerary item', {
        parameters: params(pathId('groupId')),
        requestBody: { required: true, content: { 'application/json': { schema: obj({ title: str, meetupDate: str, meetupTime: str, meetupLocation: str, notes: str, idempotencyKey: str }) } } },
        responses: { ...created(), ...r400, ...r409 },
      }),
    },
    '/groups/{groupId}/itineraries/{itemId}': {
      ...endpoint('get', 'Itineraries', 'Get itinerary item', { parameters: params(pathId('groupId'), pathId('itemId')), responses: ok() }),
      ...endpoint('patch', 'Itineraries', 'Update itinerary item', { parameters: params(pathId('groupId'), pathId('itemId')), responses: ok() }),
      ...endpoint('delete', 'Itineraries', 'Delete itinerary item (owner/admin)', { parameters: params(pathId('groupId'), pathId('itemId')), responses: noContent }),
    },
    '/groups/{groupId}/itineraries/{itemId}/checkpoints': {
      ...endpoint('get', 'Itineraries', 'List checkpoints', { parameters: params(pathId('groupId'), pathId('itemId')), responses: ok() }),
      ...endpoint('post', 'Itineraries', 'Add checkpoint (max 30)', { parameters: params(pathId('groupId'), pathId('itemId')), responses: { ...created(), ...r400 } }),
    },
    '/groups/{groupId}/itineraries/{itemId}/checkpoints/{checkpointId}': {
      ...endpoint('patch', 'Itineraries', 'Update checkpoint', { parameters: params(pathId('groupId'), pathId('itemId'), pathId('checkpointId')), responses: ok() }),
      ...endpoint('delete', 'Itineraries', 'Delete checkpoint', { parameters: params(pathId('groupId'), pathId('itemId'), pathId('checkpointId')), responses: noContent }),
    },
    '/groups/{groupId}/itineraries/{itemId}/checkin': endpoint('post', 'Itineraries', 'Check in to meetup', {
      parameters: params(pathId('groupId'), pathId('itemId')),
      responses: { ...ok(), ...r400 },
    }),

    // ── Files ──
    '/groups/{groupId}/files': {
      ...endpoint('get', 'Files', 'List files (members only)', { parameters: params(pathId('groupId')), responses: ok() }),
      ...endpoint('post', 'Files', 'Upload file (max 10 MB)', {
        parameters: params(pathId('groupId')),
        requestBody: { required: true, content: { 'multipart/form-data': { schema: obj({ file: { type: 'string', format: 'binary' } }) } } },
        responses: { ...created(), ...r400 },
      }),
    },
    '/groups/{groupId}/files/{fileId}': {
      ...endpoint('get', 'Files', 'Download file (members only)', { parameters: params(pathId('groupId'), pathId('fileId')), responses: ok() }),
      ...endpoint('delete', 'Files', 'Delete file (owner/admin only)', { parameters: params(pathId('groupId'), pathId('fileId')), responses: { ...noContent, ...r403 } }),
    },

    // ── Notifications ──
    '/notifications': endpoint('get', 'Notifications', 'Query notifications by cursor', {
      parameters: params(qStr('groupId', true), qStr('after'), qInt('limit')),
      responses: ok(),
    }),
    '/notifications/{id}/read': endpoint('patch', 'Notifications', 'Mark notification as read', {
      parameters: params(pathId()),
      responses: ok(),
    }),

    // ── Reports ──
    '/reports/occupancy': endpoint('get', 'Reports', 'Occupancy rate report', {
      parameters: params(qStr('propertyId'), qDate('from', true), qDate('to', true), qStr('groupBy'), qStr('roomType')),
      responses: { ...ok(), ...r403 },
    }),
    '/reports/adr': endpoint('get', 'Reports', 'Average Daily Rate report', {
      parameters: params(qStr('propertyId'), qDate('from', true), qDate('to', true), qStr('groupBy')),
      responses: ok(),
    }),
    '/reports/revpar': endpoint('get', 'Reports', 'RevPAR report', {
      parameters: params(qStr('propertyId'), qDate('from', true), qDate('to', true), qStr('groupBy')),
      responses: ok(),
    }),
    '/reports/revenue-mix': endpoint('get', 'Reports', 'Revenue mix by channel/room type', {
      parameters: params(qStr('propertyId'), qDate('from', true), qDate('to', true), qStr('groupBy')),
      responses: ok(),
    }),
    '/reports/export': endpoint('post', 'Reports', 'Export report as CSV or Excel', {
      requestBody: { required: true, content: { 'application/json': { schema: obj({ reportType: str, from: date, to: date, format: str, groupBy: str, propertyId: str, roomType: str, includePii: bool }) } } },
      responses: { ...ok(), ...r403 },
    }),
    '/reports/staffing': endpoint('get', 'Reports', 'Staffing report', {
      parameters: params(qStr('propertyId'), qDate('from'), qDate('to')),
      responses: ok(),
    }),
    '/reports/evaluations': endpoint('get', 'Reports', 'Evaluation report', {
      parameters: params(qStr('propertyId'), qDate('from'), qDate('to')),
      responses: ok(),
    }),

    // ── Import ──
    '/import/templates/{datasetType}': endpoint('get', 'Import', 'Download Excel template (hotel_admin or manager)', {
      parameters: params({ name: 'datasetType', in_: 'path', schema: { type: 'string', enum: ['staffing', 'evaluation'] } }),
      responses: { ...ok(), ...r401, ...r403 },
    }),
    '/import/upload': endpoint('post', 'Import', 'Upload and validate Excel file', {
      requestBody: { required: true, content: { 'multipart/form-data': { schema: obj({ file: { type: 'string', format: 'binary' }, datasetType: str }) } } },
      responses: { ...ok(), ...r400 },
    }),
    '/import/{batchId}/commit': endpoint('post', 'Import', 'Commit validated import batch', {
      parameters: params(pathId('batchId')),
      responses: { ...ok(), ...r409 },
    }),
    '/import/{batchId}': endpoint('get', 'Import', 'Get import batch status', {
      parameters: params(pathId('batchId')),
      responses: { ...ok(), ...r404 },
    }),

    // ── Face Enrollment ──
    '/face/enroll/start': endpoint('post', 'Face', 'Start face enrollment session', { responses: created() }),
    '/face/enroll/{sessionId}/capture': endpoint('post', 'Face', 'Submit capture for one angle', {
      parameters: params(pathId('sessionId')),
      requestBody: { required: true, content: { 'multipart/form-data': { schema: obj({ angle: str, blinkTimingMs: int, motionScore: { type: 'number' }, textureScore: { type: 'number' }, image: { type: 'string', format: 'binary' } }) } } },
      responses: { ...ok(), ...r400 },
    }),
    '/face/enroll/{sessionId}/complete': endpoint('post', 'Face', 'Complete enrollment', {
      parameters: params(pathId('sessionId')),
      responses: { ...created(), ...r400 },
    }),
    '/face/enrollments': endpoint('get', 'Face', 'List own face enrollments', { responses: ok() }),
    '/face/enrollments/{id}': endpoint('patch', 'Face', 'Deactivate face enrollment', {
      parameters: params(pathId()),
      responses: ok(),
    }),

    // ── Quality ──
    '/quality/checks': {
      ...endpoint('get', 'Quality', 'List quality check configs (admin)', { responses: ok() }),
      ...endpoint('post', 'Quality', 'Create quality check config (admin)', {
        requestBody: { required: true, content: { 'application/json': { schema: obj({ entityType: str, checkType: str, config: { type: 'object' } }) } } },
        responses: created(),
      }),
    },
    '/quality/checks/{id}/run': endpoint('post', 'Quality', 'Run quality check on demand', {
      parameters: params(pathId()),
      responses: ok(),
    }),
    '/quality/results': endpoint('get', 'Quality', 'Get latest quality check results', { responses: ok() }),

    // ── Audit ──
    '/audit-logs': endpoint('get', 'Audit', 'Query audit log (admin only)', {
      parameters: params(qStr('actorId'), qStr('action'), qStr('resourceType'), qStr('from'), qStr('to'), qInt('page')),
      responses: { ...ok(), ...r403 },
    }),
    '/audit-logs/export': endpoint('get', 'Audit', 'Export audit log as CSV (admin only)', {
      parameters: params(qStr('from'), qStr('to')),
      responses: { ...ok(), ...r403 },
    }),
  },
};
