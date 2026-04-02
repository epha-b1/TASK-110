# Hospitality Operations Intelligence — Design Document

## 1. Overview

Hospitality Operations Intelligence is an offline-first backend API platform for hotel groups and property management teams. It handles guest itinerary coordination, operational reporting, staffing data imports, and face enrollment. No UI. Pure REST API built with Express (TypeScript) + Sequelize + MySQL. Runs on a single Docker host with no external connectivity.

---

## 2. Architecture

```
HTTP Client (Postman / frontend)
  │
  ▼
Express HTTP Server (port 3000)
  ├── Global Error Handler          → structured JSON errors
  ├── Trace ID Middleware           → X-Trace-Id on every request
  ├── JWT Auth Middleware           → validates Bearer token
  ├── RBAC Middleware               → role + property-scope enforcement
  ├── Audit Middleware              → append-only audit trail
  ├── Rate Limit Middleware         → per-IP and per-user limits
  └── Domain Controllers/Services
        │
        ▼
   Sequelize ORM layer
        │
        ▼
   MySQL 8 (port 3306)
        │
   Local filesystem (uploads, exports, face-templates)
```

---

## 3. Technology Stack

| Layer | Choice |
|---|---|
| HTTP framework | Express (TypeScript) |
| ORM | Sequelize |
| Database | MySQL 8 |
| Auth | JWT (local, no external IdP) |
| Password hashing | bcrypt (rounds=12) |
| Field encryption | AES-256-GCM |
| Validation | zod |
| Scheduling | node-cron |
| API docs | Swagger UI (swagger-ui-express) |
| Logging | Winston with structured JSON |
| Excel/CSV | exceljs + csv-parse |
| File upload | multer |
| Container | Docker + docker-compose |

---

## 4. Module Responsibilities

| Module | Responsibility |
|---|---|
| `auth` | Login, JWT, password policy, account lockout |
| `accounts` | Profile management, self-service deletion, data export |
| `groups` | Itinerary groups, join codes, member management |
| `itineraries` | Itinerary items, checkpoints, required fields, check-in |
| `files` | Upload, MIME validation, SHA-256 dedup, access control |
| `notifications` | In-system event records, cursor-based query, idempotency |
| `reports` | Occupancy, ADR, RevPAR, revenue mix, rollups, CSV/Excel export |
| `import` | Excel staffing/evaluation import, column validation, error receipts |
| `face` | Guided capture metadata, liveness checks, encrypted template storage |
| `quality` | Integrity checks, null coverage, duplication ratios, outlier detection |
| `audit` | Append-only audit log, 1-year immutability, sensitive field masking |
| `common` | Middleware, encryption, error handling, trace IDs |

---

## 5. Data Model

### Auth and Accounts

```
users
  id              varchar(36) PK
  username        varchar(255) UNIQUE NOT NULL
  password_hash   varchar(255) NOT NULL          -- bcrypt rounds=12
  role            enum NOT NULL                  -- hotel_admin | manager | analyst | member
  property_id     varchar(36) FK properties (nullable) -- for manager scope
  legal_name      varchar(255)
  address_line1   varchar(255)
  address_line2   varchar(255)
  city            varchar(100)
  state           varchar(2)                     -- US state code
  zip             varchar(10)
  tax_invoice_title varchar(255)
  preferred_currency varchar(3)                  -- ISO 4217
  status          enum DEFAULT active            -- active | suspended | deleted
  failed_attempts int DEFAULT 0
  locked_until    datetime
  created_at      datetime
  updated_at      datetime
  deleted_at      datetime                       -- soft delete

activity_logs
  id              varchar(36) PK
  user_id         varchar(36) FK users
  action          varchar(255) NOT NULL
  detail          json
  trace_id        varchar(36)
  created_at      datetime NOT NULL
```

### Properties

```
properties
  id              varchar(36) PK
  name            varchar(255) NOT NULL
  address         text
  created_at      datetime
```

### Itinerary Groups

```
groups
  id              varchar(36) PK
  name            varchar(255) NOT NULL
  owner_id        varchar(36) FK users
  join_code       varchar(20) UNIQUE NOT NULL    -- pre-shared join code
  status          enum DEFAULT active            -- active | archived
  created_at      datetime
  updated_at      datetime

group_members
  id              varchar(36) PK
  group_id        varchar(36) FK groups
  user_id         varchar(36) FK users
  role            enum DEFAULT member            -- owner | admin | member
  joined_at       datetime
  UNIQUE (group_id, user_id)

group_required_fields
  id              varchar(36) PK
  group_id        varchar(36) FK groups
  field_name      varchar(100) NOT NULL          -- e.g. vehicle_make, emergency_contact_name
  field_type      varchar(50) NOT NULL           -- text | phone | select
  is_required     boolean DEFAULT true
  created_at      datetime

member_field_values
  id              varchar(36) PK
  group_id        varchar(36) FK groups
  user_id         varchar(36) FK users
  field_name      varchar(100) NOT NULL
  value           text NOT NULL
  created_at      datetime
  updated_at      datetime
  UNIQUE (group_id, user_id, field_name)
```

### Itinerary Items

```
itinerary_items
  id              varchar(36) PK
  group_id        varchar(36) FK groups
  title           varchar(255) NOT NULL
  meetup_date     varchar(10) NOT NULL           -- MM/DD/YYYY
  meetup_time     varchar(8) NOT NULL            -- HH:MM AM/PM (12-hour)
  meetup_location text NOT NULL
  notes           text                           -- max 2,000 chars
  created_by      varchar(36) FK users
  idempotency_key varchar(255) UNIQUE NOT NULL
  created_at      datetime
  updated_at      datetime

itinerary_checkpoints
  id              varchar(36) PK
  item_id         varchar(36) FK itinerary_items
  position        int NOT NULL                   -- 1-30, ordered
  label           varchar(255) NOT NULL
  description     text
  created_at      datetime

member_checkins
  id              varchar(36) PK
  item_id         varchar(36) FK itinerary_items
  user_id         varchar(36) FK users
  checked_in_at   datetime NOT NULL
  UNIQUE (item_id, user_id)
```

### Files

```
files
  id              varchar(36) PK
  group_id        varchar(36) FK groups (nullable)
  uploaded_by     varchar(36) FK users
  original_name   varchar(255) NOT NULL
  mime_type       varchar(100) NOT NULL
  size_bytes      int NOT NULL
  sha256          varchar(64) NOT NULL           -- for deduplication
  storage_path    varchar(500) NOT NULL
  created_at      datetime

file_access_log
  id              varchar(36) PK
  file_id         varchar(36) FK files
  user_id         varchar(36) FK users
  action          varchar(50) NOT NULL           -- read | delete
  created_at      datetime
```

### Notifications

```
notifications
  id              varchar(36) PK
  group_id        varchar(36) FK groups
  actor_id        varchar(36) FK users
  event_type      varchar(100) NOT NULL          -- item_created | item_updated | member_joined | etc.
  resource_type   varchar(100)
  resource_id     varchar(36)
  detail          json                           -- what changed
  idempotency_key varchar(255) UNIQUE NOT NULL
  created_at      datetime NOT NULL

notification_reads
  notification_id varchar(36) FK notifications
  user_id         varchar(36) FK users
  read_at         datetime
  PRIMARY KEY (notification_id, user_id)
```

### Hospitality / Reporting

```
properties
  (see above)

rooms
  id              varchar(36) PK
  property_id     varchar(36) FK properties
  room_number     varchar(20) NOT NULL
  room_type       varchar(100) NOT NULL
  rate_cents      int NOT NULL
  status          enum DEFAULT available         -- available | occupied | maintenance
  created_at      datetime

reservations
  id              varchar(36) PK
  property_id     varchar(36) FK properties
  room_id         varchar(36) FK rooms
  guest_name      varchar(255) NOT NULL
  channel         varchar(100) NOT NULL          -- direct | ota | corporate | group
  check_in_date   date NOT NULL
  check_out_date  date NOT NULL
  rate_cents      int NOT NULL
  status          enum DEFAULT confirmed         -- confirmed | checked_in | checked_out | cancelled
  created_at      datetime
  updated_at      datetime
```

### Staffing Import

```
import_batches
  id              varchar(36) PK
  user_id         varchar(36) FK users
  batch_type      varchar(50) NOT NULL           -- staffing | evaluation
  status          enum DEFAULT pending           -- pending | processing | completed | failed
  total_rows      int DEFAULT 0
  success_rows    int DEFAULT 0
  error_rows      int DEFAULT 0
  trace_id        varchar(36)
  created_at      datetime
  completed_at    datetime

import_errors
  id              varchar(36) PK
  batch_id        varchar(36) FK import_batches
  row_number      int NOT NULL
  field           varchar(255)
  reason          text NOT NULL
  raw_data        json

staffing_records
  id              varchar(36) PK
  batch_id        varchar(36) FK import_batches
  employee_id     varchar(100) NOT NULL
  effective_date  date NOT NULL
  position        varchar(255) NOT NULL
  department      varchar(255)
  property_id     varchar(36) FK properties
  signed_off_by   varchar(255)
  created_at      datetime
  UNIQUE (employee_id, effective_date)           -- dedup merge key

evaluation_records
  id              varchar(36) PK
  batch_id        varchar(36) FK import_batches
  employee_id     varchar(100) NOT NULL
  effective_date  date NOT NULL
  score           decimal(5,2)
  result          varchar(100)
  rewards         text
  penalties       text
  signed_off_by   varchar(255)
  created_at      datetime
  UNIQUE (employee_id, effective_date)
```

### Face Enrollment

```
face_enrollments
  id              varchar(36) PK
  user_id         varchar(36) FK users
  version         int NOT NULL DEFAULT 1
  status          enum DEFAULT active            -- active | deactivated
  template_path   varchar(500) NOT NULL          -- path to AES-256 encrypted template
  angles_captured json NOT NULL                  -- {left: bool, front: bool, right: bool}
  liveness_passed boolean NOT NULL
  liveness_meta   json                           -- blink timing, motion, texture scores
  raw_image_path  varchar(500)                   -- nullable, deleted after 24h
  raw_image_expires_at datetime
  created_at      datetime
  updated_at      datetime
```

### Data Quality

```
quality_checks
  id              varchar(36) PK
  entity_type     varchar(100) NOT NULL
  check_type      varchar(100) NOT NULL          -- null_coverage | duplication_ratio | outlier
  config          json NOT NULL                  -- thresholds, z-score bounds
  result          json                           -- last run result
  passed          boolean
  run_at          datetime
  trace_id        varchar(36)
```

### Audit

```
audit_logs
  id              varchar(36) PK
  actor_id        varchar(36) FK users
  action          varchar(255) NOT NULL
  resource_type   varchar(100)
  resource_id     varchar(36)
  detail          json                           -- sensitive fields masked
  trace_id        varchar(36)
  ip_address      varchar(45)
  created_at      datetime NOT NULL
  -- INSERT only, no UPDATE/DELETE for app DB role
  -- retained for 1 year minimum
```

---

## 6. Key Flows

### Group Join via Code

```
1. POST /groups/join {joinCode}
2. Look up group by join_code
3. Check group.status = active
4. Check user not already a member
5. INSERT group_members (role=member)
6. Emit notification event: member_joined
7. Return 200 + group details
```

### Itinerary Check-in

```
1. POST /itineraries/:itemId/checkin
2. Load group required fields for item's group
3. Load member_field_values for current user
4. Check all is_required fields have values → else 400 with missing fields list
5. INSERT member_checkins
6. Return 200
```

### Reporting — RevPAR Calculation

```
RevPAR = Total Room Revenue / Total Available Room Nights

1. GET /reports/revpar?propertyId=&from=&to=&groupBy=day|week|month
2. Filter reservations by property + date range + status=checked_out|checked_in
3. Sum rate_cents per period
4. Count available room nights per period (rooms × days)
5. Compute RevPAR per period
6. Return time-series array with rollup
```

### Face Enrollment Flow

```
1. POST /face/enroll/start — create enrollment session
2. POST /face/enroll/:sessionId/capture {angle: left|front|right, metadata: {...}}
   - Validate liveness: blink timing, motion consistency, texture/reflection heuristics
   - Store capture metadata
3. POST /face/enroll/:sessionId/complete
   - Verify all 3 angles captured
   - Verify liveness passed for all angles
   - Generate encrypted face template (AES-256)
   - Store template, schedule raw image deletion (24h)
   - INSERT face_enrollments
4. Return enrollment ID
```

### Notification Cursor Query

```
1. GET /notifications?groupId=&after=<cursor>&limit=50
2. cursor = last notification ID seen by client
3. SELECT * FROM notifications WHERE group_id=? AND id > cursor ORDER BY created_at ASC LIMIT 50
4. Return notifications + next cursor
5. Idempotency: duplicate event with same idempotency_key is silently ignored
```

### Data Export (Account)

```
1. POST /accounts/export
2. Collect: user profile, activity_logs, uploaded files list
3. Package into ZIP archive (locally generated)
4. Store archive in exports/ directory
5. Return download URL (local path)
6. Log export event in audit_log
```

---

## 7. Security Design

- Passwords: bcrypt rounds=12, min 10 chars, at least 1 number + 1 symbol
- JWT: HS256, secret from env, configurable TTL (default 8h)
- Field encryption: AES-256-GCM for face templates, sensitive profile fields
- Audit log: INSERT-only for app DB role, 1-year retention
- Property-scoped access: Manager queries always filtered by property_id
- PII export: requires explicit `pii_export` permission grant
- Sensitive fields masked in all log output (password_hash, face template paths)
- Trace IDs: UUID per request, attached to all log lines and `X-Trace-Id` header
- File access: group members only for read; owner/admin only for delete
- Raw face images: hard-deleted after 24 hours via scheduled job

---

## 8. Background Jobs

| Job | Interval | Description |
|---|---|---|
| Face image cleanup | 15 min | Hard-delete raw face images past 24h retention |
| Import retry | 5 min | Retry failed import batches (max 3, exponential backoff) |
| Audit log retention check | daily | Alert if audit logs older than 1 year exist without archive |
| Quality checks | 1 hour | Run configured integrity checks per entity type |
| Export cleanup | 1 hour | Delete generated export archives older than 24h |

---

## 9. Error Handling

All errors return:
```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "human readable message",
  "traceId": "uuid"
}
```

Standard codes: VALIDATION_ERROR (400), UNAUTHORIZED (401), FORBIDDEN (403), NOT_FOUND (404), CONFLICT (409), IDEMPOTENCY_CONFLICT (409), INTERNAL_ERROR (500)

---

## 10. Docker Setup

```yaml
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: mysql://hospitality:hospitality@db:3306/hospitality
      JWT_SECRET: ${JWT_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
    volumes:
      - ./uploads:/app/uploads
      - ./exports:/app/exports
      - ./face-templates:/app/face-templates
    depends_on:
      db:
        condition: service_healthy

  db:
    image: mysql:8
    environment:
      MYSQL_USER: hospitality
      MYSQL_PASSWORD: hospitality
      MYSQL_DATABASE: hospitality
      MYSQL_ROOT_PASSWORD: rootpassword
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      retries: 10
    volumes:
      - mysqldata:/var/lib/mysql

volumes:
  mysqldata:
```

---

## 11. Performance Strategy

- Index all foreign keys
- Index `reservations.check_in_date`, `reservations.check_out_date`, `reservations.property_id`
- Index `audit_logs.created_at`, `audit_logs.actor_id`
- Index `notifications.group_id`, `notifications.created_at` (for cursor pagination)
- Index `staffing_records.employee_id`, `staffing_records.effective_date`
- Index `files.sha256` (for deduplication lookup)
- Sequelize query builder for complex reporting aggregations
- Connection pool: min 2, max 10
- Import batches processed in chunks of 500 rows
- Reporting queries use DB-level aggregation (SUM, COUNT, GROUP BY) not in-memory
