# Hospitality Operations Intelligence — Feature Build Order

Build one slice at a time. Each slice must be fully working (implementation + tests) before moving to the next.

Acceptance execution rule for every slice:
- Capture objective evidence (endpoint result, test output, log sample, migration output).
- Record evidence locations as `path:line` in the acceptance report.
- If execution is blocked by environment limits, document exact command + boundary of what is confirmable.

---

## Slice 1 — Project Foundation
Done when:
- Express app boots with Sequelize connected to MySQL
- `docker compose up` starts cleanly
- Sequelize migrations run on startup
- Structured logging with trace IDs on every request (X-Trace-Id header)
- Log categories exist and are consistent (`auth`, `rbac`, `audit`, `import`, `reporting`, `security`, `system`)
- Health endpoint `GET /health` returns 200
- `.env.example` has all required vars
- `run_tests.sh` runs unit + integration tests

---

## Slice 2 — Authentication and Accounts
Done when:
- `POST /auth/register` creates user with bcrypt password (min 10 chars, 1 number, 1 symbol enforced)
- `POST /auth/login` validates credentials, returns JWT
- `POST /auth/logout` invalidates session
- `PATCH /auth/change-password` enforces password policy
- Account lockout after repeated failed attempts
- `GET /accounts/me` returns profile
- `PATCH /accounts/me` updates legal name, US address, tax invoice title, preferred currency
- `POST /accounts/me/delete` soft-deletes account after password confirmation
- `POST /accounts/me/export` packages profile + activity logs + file list into local ZIP
- Audit log on login, logout, profile change, deletion
- Unit tests: password policy, bcrypt, JWT
- Integration tests: register, login, wrong password, lockout, profile update, export

---

## Slice 3 — RBAC
Done when:
- Role enum enforced: hotel_admin, manager, analyst, member
- JWT claims include role and property_id
- RBAC middleware rejects wrong role with 403
- Manager queries filtered by property_id
- PII export blocked unless explicit permission granted
- Route-level authorization tests exist (401/403 on protected routes)
- Object-level authorization tests exist (cannot access/modify resources by ID without membership/ownership)
- Data isolation tests exist (cross-group and cross-property denial)
- Integration tests: role enforcement, cross-property 403, member-only itinerary access

---

## Slice 4 — Itinerary Groups
Done when:
- `POST /groups` creates group with unique join code
- `POST /groups/join` joins group by code
- `GET /groups` lists own groups
- `GET/PATCH /groups/:id` get and update group
- `GET /groups/:id/members` lists members
- `DELETE /groups/:id/members/:userId` removes member (owner/admin only)
- `GET/POST /groups/:id/required-fields` manage required field configs
- `PATCH/DELETE /groups/:id/required-fields/:fieldId` update/remove field config
- `GET/PUT /groups/:id/my-fields` get and submit own field values
- US phone format validation on phone-type fields
- Notification emitted on member join/remove, field config change
- Integration tests: join, duplicate join 409, member removal, field config

---

## Slice 5 — Itinerary Items and Check-in
Done when:
- `GET/POST /groups/:groupId/itineraries` list and create items
- Meetup date validated as MM/DD/YYYY
- Meetup time validated as 12-hour format (HH:MM AM/PM)
- Notes max 2,000 chars enforced
- Idempotency key required on create/update
- `GET/PATCH/DELETE /groups/:groupId/itineraries/:itemId` get, update, delete
- `GET/POST /groups/:groupId/itineraries/:itemId/checkpoints` manage checkpoints (max 30)
- `POST /groups/:groupId/itineraries/:itemId/checkin` validates required fields → 400 with missing list if incomplete
- Notification emitted on item create/update/delete
- Transactional rollback on failed item create/update
- Unit tests: date/time format validation, checkpoint limit, required field check
- Integration tests: create, idempotency retry, checkin with missing fields 400, checkpoint max 400, unauthorized item access 403/404

---

## Slice 6 — File Management
Done when:
- `POST /groups/:groupId/files` uploads file (max 10 MB, MIME allowlist enforced)
- SHA-256 deduplication: returns existing file if hash matches
- `GET /groups/:groupId/files` lists files (members only)
- `GET /groups/:groupId/files/:fileId` downloads file (members only)
- `DELETE /groups/:groupId/files/:fileId` deletes file (owner/admin only → 403 otherwise)
- File access log on read and delete
- Notification emitted on file upload/delete
- Integration tests: upload, MIME rejection 400, size rejection 400, dedup, access control 403

---

## Slice 7 — Change Notifications
Done when:
- `GET /notifications?groupId=&after=&limit=` returns cursor-paginated notifications
- Notifications include: event_type, actor, resource_type, resource_id, detail, created_at
- Idempotency key on notification creation (duplicate = silent ignore)
- `PATCH /notifications/:id/read` marks notification as read
- Cursor is stable and monotonic under concurrent inserts
- Integration tests: cursor pagination, idempotency dedup, read marking, cross-group access blocked

---

## Slice 8 — Reporting and Analytics
Done when:
- `GET /reports/occupancy` — occupancy rate with day/week/month rollup
- `GET /reports/adr` — ADR with rollup
- `GET /reports/revpar` — RevPAR with rollup
- `GET /reports/revenue-mix` — revenue by channel and room type
- All reports support propertyId, from, to, groupBy filters
- Manager property-scope enforced (403 for other properties)
- `POST /reports/export` generates CSV or Excel locally, logs who/when/filters
- PII excluded from export unless explicit permission
- Unit tests: RevPAR formula, ADR formula, occupancy calculation
- Integration tests: report endpoints, export, cross-property 403, PII block

---

## Slice 9 — Data Import (Staffing and Evaluations)
Done when:
- `GET /import/templates/:datasetType` returns Excel template
- `POST /import/upload` parses Excel, validates columns, returns error receipt (row, field, reason)
- Duplicate merge: employee_id + effective_date → update existing record
- `POST /import/:batchId/commit` applies valid rows in a transaction (rollback on failure)
- `GET /import/:batchId` returns batch status and error receipt
- `GET /reports/staffing` — position distribution and staffing gaps
- `GET /reports/evaluations` — results, rewards/penalties, signed-off-by
- Retry failed imports: exponential backoff, max 3 attempts
- Unit tests: column validation, duplicate merge, rollback on error
- Integration tests: upload, commit, error receipt, staffing report, evaluation report

---

## Slice 10 — Face Enrollment
Done when:
- `POST /face/enroll/start` creates enrollment session
- `POST /face/enroll/:sessionId/capture` accepts angle + liveness metadata
- Liveness check: blink timing, motion consistency, texture/reflection heuristics
- `POST /face/enroll/:sessionId/complete` verifies all 3 angles + liveness, generates AES-256 encrypted template
- Raw image stored optionally, scheduled for hard-delete after 24h
- `GET /face/enrollments` lists own enrollments with version and status
- `PATCH /face/enrollments/:id` deactivates enrollment
- New enrollment creates new version, previous deactivated
- Unit tests: liveness scoring, template encryption, version increment
- Integration tests: full enrollment flow, incomplete angles 400, liveness fail 400

---

## Slice 11 — Data Quality and Observability
Done when:
- `GET/POST /quality/checks` manage quality check configs
- `POST /quality/checks/:id/run` runs check on demand with trace ID
- Scheduled hourly quality checks
- Null coverage, duplication ratio, outlier (configurable z-score) checks implemented
- `GET /quality/results` returns latest results
- Operational metrics stored in DB: job duration, queue depth, DB resource usage
- Integration tests: create config, run check, results endpoint

---

## Slice 12 — Audit Log and Security Hardening
Done when:
- AES-256-GCM encryption verified on face templates and sensitive fields
- Sensitive fields masked in all log output ([REDACTED])
- Append-only audit_logs (no DELETE for app DB role), 1-year retention
- `GET /audit-logs` query endpoint (Hotel Admin only)
- `GET /audit-logs/export` CSV export with masking
- Transactional boundaries verified on all import and itinerary operations
- Security-focused integration tests: auth entry points, role bypass attempts, object-level access denial, tenant isolation
- Tests/assertions confirm no password/token/secret leaks in API responses and logs
- Integration tests: audit log read, masking in export, 403 for non-admin

---

## Slice 13 — Final Polish
Done when:
- `run_tests.sh` passes all unit + integration tests
- `docker compose up` cold start works
- README has startup command, service addresses, test credentials
- No node_modules, dist, or compiled output in repo
- No real credentials in any config file
- Swagger UI available at `/api/docs`
- All p95 read queries have proper indexes
- Face image cleanup job verified
- Export archive cleanup job verified
- Static test coverage audit completed with Prompt Requirement Checklist mapping
- Acceptance report saved to `./.tmp/delivery-acceptance-report.md` with evidence `path:line`

---

## Acceptance Gate (After Slice 13)
Project is acceptance-ready only if:
- Mandatory thresholds pass: runnable verification or explicit environment-boundary statement.
- Core Prompt requirements are fully mapped to implementation artifacts.
- Security checks pass for authentication, route authorization, object authorization, and data isolation.
- Test Coverage Assessment (static audit) concludes at least `Partially Pass` with explicit risk boundaries.
