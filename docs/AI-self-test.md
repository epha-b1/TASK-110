
# Hospitality Operations Intelligence — AI Self-Test Checklist

This document is used to verify all prompt requirements are implemented before submission.

Evidence rule for each checked item:
- Link implementation and verification evidence as `path:line`.
- Include reproducible command(s) and expected result.
- If blocked by environment constraints, mark as `Unconfirmed` with exact boundary.

---

## Authentication and Accounts

- [ ] `POST /auth/register` — creates user, enforces min 10 chars + 1 number + 1 symbol
- [ ] `POST /auth/login` — validates credentials, returns JWT
- [ ] `POST /auth/logout` — invalidates session
- [ ] `PATCH /auth/change-password` — enforces password policy
- [ ] Account lockout after repeated failed attempts
- [ ] `GET /accounts/me` — returns profile (legal name, US address, tax invoice title, preferred currency)
- [ ] `PATCH /accounts/me` — updates profile fields
- [ ] `POST /accounts/me/delete` — soft-deletes account after password confirmation
- [ ] `POST /accounts/me/export` — packages profile + activity logs + files into local ZIP archive

---

## RBAC

- [ ] Role enum: hotel_admin, manager, analyst, member
- [ ] JWT claims include role and property_id
- [ ] RBAC middleware enforces role on all protected routes (wrong role → 403)
- [ ] Manager queries filtered by assigned property_id
- [ ] Analyst: read-only reporting access only
- [ ] Member: itinerary-only access
- [ ] PII export blocked unless `pii_export_allowed` flag set
- [ ] Route-level authorization verified (protected route unauthenticated -> 401, wrong role -> 403)
- [ ] Object-level authorization verified (resource ownership/membership required, not only ID lookup)
- [ ] Cross-tenant data isolation verified (cross-group and cross-property reads/writes blocked)

---

## Itinerary Groups

- [ ] `POST /groups` — creates group with unique join code
- [ ] `POST /groups/join` — joins group by code
- [ ] `GET /groups` — lists own groups
- [ ] `GET/PATCH /groups/:id` — get and update group
- [ ] `GET /groups/:id/members` — list members
- [ ] `DELETE /groups/:id/members/:userId` — remove member (owner/admin only)
- [ ] `GET/POST /groups/:id/required-fields` — manage required field configs
- [ ] `PATCH/DELETE /groups/:id/required-fields/:fieldId` — update/remove field config
- [ ] `GET/PUT /groups/:id/my-fields` — get and submit own field values
- [ ] US phone format validation on phone-type fields
- [ ] Notification emitted on member join/remove, field config change

---

## Itinerary Items

- [ ] `GET/POST /groups/:groupId/itineraries` — list and create items
- [ ] Meetup date validated as MM/DD/YYYY
- [ ] Meetup time validated as 12-hour format (HH:MM AM/PM)
- [ ] Notes max 2,000 chars enforced
- [ ] Idempotency key required on create/update (duplicate → return existing item)
- [ ] `GET/PATCH/DELETE /groups/:groupId/itineraries/:itemId` — get, update, delete
- [ ] `GET/POST /groups/:groupId/itineraries/:itemId/checkpoints` — manage checkpoints
- [ ] Max 30 checkpoints per item enforced (400 if exceeded)
- [ ] Checkpoints are ordered by position
- [ ] `POST /groups/:groupId/itineraries/:itemId/checkin` — validates required fields → 400 with missing list
- [ ] Notification emitted on item create/update/delete
- [ ] Transactional rollback on failed item create/update

---

## File Management

- [ ] `POST /groups/:groupId/files` — upload file (max 10 MB enforced)
- [ ] MIME allowlist enforced: jpeg, png, gif, webp, pdf, docx, xlsx
- [ ] SHA-256 deduplication: returns existing file if hash matches
- [ ] `GET /groups/:groupId/files` — list files (members only)
- [ ] `GET /groups/:groupId/files/:fileId` — download file (members only)
- [ ] `DELETE /groups/:groupId/files/:fileId` — delete file (owner/admin only → 403 otherwise)
- [ ] File access log on read and delete
- [ ] Notification emitted on file upload/delete

---

## Change Notifications

- [ ] `GET /notifications?groupId=&after=&limit=` — cursor-paginated notifications
- [ ] Notifications include: event_type, actor, resource_type, resource_id, detail, created_at
- [ ] Idempotency key on notification creation (duplicate = silent ignore)
- [ ] `PATCH /notifications/:id/read` — marks notification as read
- [ ] Events emitted for: item created/updated/deleted, member joined/removed, file uploaded/deleted, field config changed

---

## Reporting and Analytics

- [ ] `GET /reports/occupancy` — occupancy rate with day/week/month rollup
- [ ] `GET /reports/adr` — ADR with rollup
- [ ] `GET /reports/revpar` — RevPAR with rollup
- [ ] `GET /reports/revenue-mix` — revenue by channel and room type
- [ ] All reports support propertyId, from, to, groupBy filters
- [ ] Manager property-scope enforced (403 for other properties)
- [ ] `POST /reports/export` — generates CSV or Excel locally
- [ ] Export log: who exported, when, which filters used
- [ ] PII excluded from export unless `pii_export_allowed` flag set

---

## Data Import

- [ ] `GET /import/templates/:datasetType` — returns Excel template (staffing, evaluation)
- [ ] `POST /import/upload` — parses Excel, validates columns, returns error receipt (row, field, reason)
- [ ] Duplicate merge: employee_id + effective_date → update existing record
- [ ] `POST /import/:batchId/commit` — applies valid rows in a transaction (rollback on failure)
- [ ] `GET /import/:batchId` — batch status and error receipt
- [ ] `GET /reports/staffing` — position distribution and staffing gaps
- [ ] `GET /reports/evaluations` — results, rewards/penalties, signed-off-by
- [ ] Retry failed imports: exponential backoff, max 3 attempts

---

## Face Enrollment

- [ ] `POST /face/enroll/start` — creates enrollment session
- [ ] `POST /face/enroll/:sessionId/capture` — accepts angle + liveness metadata (blink, motion, texture)
- [ ] Liveness check per capture: all three metrics evaluated
- [ ] `POST /face/enroll/:sessionId/complete` — verifies all 3 angles + liveness, generates AES-256 encrypted template
- [ ] Raw image stored optionally, hard-deleted after 24h by scheduled job
- [ ] `GET /face/enrollments` — lists own enrollments with version and status
- [ ] `PATCH /face/enrollments/:id` — deactivates enrollment
- [ ] New enrollment creates new version, previous deactivated

---

## Data Quality and Observability

- [ ] `GET/POST /quality/checks` — manage quality check configs
- [ ] `POST /quality/checks/:id/run` — runs check on demand with trace ID
- [ ] Null coverage threshold check implemented
- [ ] Duplication ratio check implemented
- [ ] Outlier detection with configurable z-score bounds implemented
- [ ] Scheduled hourly quality checks
- [ ] `GET /quality/results` — latest results
- [ ] End-to-end trace IDs on all ingestion, reporting, and export operations
- [ ] Operational metrics stored in DB (job duration, queue depth, DB resource usage)

---

## Security and Audit

- [ ] bcrypt rounds=12 on all passwords
- [ ] AES-256-GCM on face templates and sensitive fields
- [ ] Sensitive fields masked in all log output ([REDACTED])
- [ ] Append-only audit_logs (no DELETE for app DB role), 1-year retention
- [ ] `GET /audit-logs` — query endpoint (Hotel Admin only)
- [ ] `GET /audit-logs/export` — CSV export with masking
- [ ] Transactional boundaries on imports and itinerary edits
- [ ] Exponential backoff retry (max 3 attempts) for import jobs
- [ ] X-Trace-Id header on every response
- [ ] Logs do not expose sensitive values (passwords, tokens, encryption keys, raw PII)
- [ ] Log channels/categories are consistent for auth/rbac/audit/import/reporting/system events

---

## Infrastructure

- [ ] `docker compose up` starts cleanly (API + MySQL)
- [ ] Sequelize migrations run on startup
- [ ] `GET /health` returns 200
- [ ] Swagger UI at `/api/docs`
- [ ] `run_tests.sh` passes all unit + integration tests
- [ ] README has startup command, ports, test credentials
- [ ] `.env.example` has all required vars
- [ ] No node_modules, dist, or compiled output in ZIP
- [ ] No real credentials in any config file
- [ ] `metadata.json` present with all required fields
- [ ] `sessions/develop-1.json` trajectory file present
- [ ] Face image cleanup job verified (24h hard-delete)
- [ ] Export archive cleanup job verified
- [ ] Offline operation verified (no external dependencies)

---

## Test Coverage Assessment (Static Audit)

- [ ] Prompt requirement checklist extracted (core + implicit risks)
- [ ] Mapping table completed: requirement -> test case -> assertion -> coverage judgment
- [ ] Happy-path coverage judged for major business flows
- [ ] Exception-path coverage judged (400/401/403/404/409/idempotency)
- [ ] Security coverage judged (auth entry, route authz, object authz, data isolation)
- [ ] Boundary coverage judged (pagination/filtering/empty/extreme/time/concurrency/transactions)
- [ ] Mock/stub scope and production-risk status documented
- [ ] Final static-audit conclusion set: Pass / Partially Pass / Fail / Unconfirmed
