# Hospitality Operations Intelligence — Feature Overview

Offline-first backend API platform for hotel group itinerary coordination, operational reporting, staffing imports, and face enrollment. Built with Express (TypeScript) + Sequelize + MySQL. No UI. Pure backend.

---

## Authentication and Accounts

What it does: Local username/password login with JWT, profile management, and self-service account deletion.

What needs to be built:
- Registration with password policy: min 10 chars, at least 1 number, 1 symbol
- Login endpoint with bcrypt verification and JWT issuance
- Account lockout after repeated failed attempts
- Profile management: legal name, US mailing address, tax invoice title, preferred currency
- Password change endpoint
- Self-service account deletion (soft delete)
- Data export endpoint: packages profile, activity logs, and uploaded files into a local ZIP archive
- Audit log on login, logout, profile change, deletion

---

## Role-Based Authorization

What it does: Four-role RBAC with property-scoped access for managers.

What needs to be built:
- Role enum: hotel_admin (full access), manager (property-scoped), analyst (read-only reporting), member (itinerary-only)
- JWT claims include role and property_id
- RBAC middleware enforces role on every protected route
- Manager queries always filtered by assigned property_id
- PII export requires explicit permission grant (not default for any role)
- Wrong role → 403

---

## Itinerary Groups

What it does: Create and manage travel/coordination groups with join codes and member management.

What needs to be built:
- Group CRUD (name, status)
- Join code generation (unique, pre-shared)
- Join group by code endpoint
- Member list and role management (owner, admin, member)
- Remove member endpoint (owner/admin only)
- Archive group endpoint
- Configure required member data fields per group (field name, type, required/optional flag)
- Member field value submission (vehicle make/model/license plate, emergency contact, etc.)
- US phone format validation for phone-type fields

---

## Itinerary Items

What it does: Structured itinerary items with checkpoints, notes, and member check-in.

What needs to be built:
- Itinerary item CRUD within a group
- Meetup date in MM/DD/YYYY format
- Meetup time in 12-hour format (HH:MM AM/PM)
- Meetup location text field
- Route checkpoints: ordered list, max 30 per item
- Notes field: max 2,000 characters
- Idempotency key required on create/update to prevent duplicate updates during retries
- Check-in endpoint: validates all required member fields are filled before allowing check-in
- Missing required fields → 400 with list of missing fields

---

## File and Attachment Management

What it does: Upload and manage files with deduplication and group-scoped access control.

What needs to be built:
- File upload endpoint (multipart/form-data), max 10 MB per file
- MIME-type allowlist: images (jpeg, png, gif, webp) and documents (pdf, docx, xlsx)
- SHA-256 fingerprinting for deduplication (return existing file if hash matches)
- Associate files with groups
- Access control: only group members can read files; only owner/admin can delete
- File access log (who read/deleted, when)
- File list endpoint (group-scoped)

---

## Change Notifications

What it does: In-system event records for group changes, queryable by cursor.

What needs to be built:
- Emit notification events on: item created/updated/deleted, member joined/removed, file uploaded/deleted, required field config changed
- Notification record: event_type, actor, resource_type, resource_id, detail (what changed), timestamp
- Cursor-based query endpoint: `GET /notifications?groupId=&after=<cursor>&limit=`
- Idempotency key on notification creation (duplicate key = silent ignore)
- Mark notification as read per user

---

## Reporting and Analytics

What it does: Configurable reporting over reservations and room inventory with CSV/Excel export.

What needs to be built:
- Occupancy rate: occupied rooms / total rooms per period
- ADR (Average Daily Rate): total room revenue / occupied room nights
- RevPAR (Revenue Per Available Room): total revenue / total available room nights
- Revenue mix by channel (direct, OTA, corporate, group)
- Rollups by day, week, month
- Rollups by room type
- Rollups by channel
- Configurable filters: property, date range, room type, channel, status
- CSV and Excel export of report results
- Export log: who exported, when, which filters used
- Property-scoped access for managers (cannot see other properties)
- PII fields excluded from export unless explicit permission granted

---

## Data Import — Staffing and Evaluations

What it does: Template-based Excel import for staffing and evaluation datasets.

What needs to be built:
- Excel template download per dataset type (staffing, evaluation)
- Upload and validate endpoint: strict column validation, returns error receipt artifact
- Error receipt: row number, field name, reason for each error
- Duplicate merge rule: match on employee_id + effective_date → update existing record
- Staffing report: position distribution, staffing gaps per property
- Evaluation report: results summary, rewards/penalties, signed-off-by metadata
- Retry failed imports: exponential backoff, max 3 attempts
- Transactional import: rollback entire batch on unrecoverable error

---

## Face Enrollment

What it does: Guided multi-angle face capture with local liveness checks and encrypted template storage.

What needs to be built:
- Enrollment session start endpoint
- Capture endpoint per angle (left, front, right) — all 3 required
- Liveness check per capture: blink timing, motion consistency, texture/reflection heuristics
- Encrypted face template generation (AES-256 at rest)
- Template versioning (new enrollment creates new version, old deactivated)
- Template update and deactivation endpoints
- Raw image optional storage with 24-hour hard-delete
- Face template list per user (versions, status)

---

## Data Quality and Observability

What it does: Configurable integrity checks, trace IDs, and operational metrics.

What needs to be built:
- Integrity check rules: null coverage thresholds, duplication ratios, outlier detection (configurable z-score bounds)
- Run checks on demand and on schedule (hourly)
- Quality check results stored with pass/fail and trace ID
- End-to-end trace IDs on all ingestion, reporting, and export operations
- Operational metrics: job duration, queue depth, DB resource usage (stored in DB)
- Structured JSON logging with trace ID on every request

---

## Security and Audit

What it does: Encryption, masking, immutable audit trail, transactional safety.

What needs to be built:
- bcrypt password hashing (rounds=12)
- AES-256-GCM for face templates and sensitive fields
- Sensitive fields masked in all log output
- Append-only audit_logs (no DELETE for app DB role), 1-year retention
- Transactional boundaries for imports and itinerary edits (rollback on failure)
- Exponential backoff retry (max 3 attempts) for import jobs
- Trace IDs on every request (X-Trace-Id header)
