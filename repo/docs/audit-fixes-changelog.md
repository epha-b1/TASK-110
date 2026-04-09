# Audit Fixes Changelog

End-to-end summary of the eight fixes from the latest audit pass.

## Headline status

| Metric | Value |
|---|---|
| `npm run build` (`tsc`) | exit 0 |
| `npm run test:unit` | **23 suites · 243 tests · all passing** · no warnings |
| `npm run test:api` (no MySQL) | **2 suites pass · 11 cleanly skipped** (164 tests; 7 pass, 157 skip) |
| `npm run test:api` (with MySQL) | requires `docker compose up db -d` first |

---

## 1) Cross-tenant idempotency isolation for itinerary creation

**Issue.** Itinerary create looked up replays via a global unique on
`itinerary_items.idempotency_key`. Same key in a different group OR
from a different user would either replay the wrong row or 409 — both
breaking tenant isolation.

**Fix.**
- `migrations/018-fix-itinerary-idempotency-scope.js` *(new)* — drops
  the global unique and adds composite unique
  `(group_id, created_by, idempotency_key)`.
- `src/models/itinerary.model.ts` — removed `unique: true` from the
  column; declared the composite index in `indexes` so test sync
  matches the migration.
- `src/services/itinerary.service.ts::createItem` — lookup is now
  `where: { group_id, created_by, idempotency_key }`. A repeat with
  the same scope but different body returns
  `409 IDEMPOTENCY_CONFLICT` (was: silent replay of the wrong row).
  Race against the unique index re-fetches and replays cleanly.

**Why correct.** The composite unique makes it physically impossible
for the same `(group_id, created_by, idempotency_key)` triple to
duplicate, while keys in different scopes are independent. A
SHA-256 body hash gates replay vs. conflict so client retries with the
exact same payload still succeed (idempotent), while client mistakes
that reuse a key with new content fail loudly.

**Tests proving the fix** (`API_tests/itineraries.api.spec.ts`):
- *same key in DIFFERENT groups → distinct items, no replay leak*
- *same key, same group, DIFFERENT users → distinct items, no replay leak*
- *same key + same scope + SAME body → idempotent replay (same id)*
- *same key + same scope + DIFFERENT body → 409 IDEMPOTENCY_CONFLICT*

---

## 2) Room-night-correct Occupancy / ADR / RevPAR

**Issue.** The reporting service counted reservations rather than
room-nights, so multi-night reservations were under/over-counted. The
audit flagged this as a fundamental KPI correctness defect.

**Fix.** Rewrote `src/services/reporting.service.ts` to compute a
per-night fact CTE and roll up from there:

```sql
WITH RECURSIVE calendar (night) AS (
  SELECT DATE(?) UNION ALL SELECT night + INTERVAL 1 DAY FROM calendar WHERE night < DATE(?)
),
available AS (...),  -- (room, night) where rm.status <> 'maintenance'
occupied  AS (...),  -- (room, night) where night >= check_in AND night < check_out AND status IN (...)
per_night AS (LEFT JOIN available + occupied)
SELECT period, SUM(...) ... FROM per_night GROUP BY period
```

- Day / week / month rollups via `DATE_FORMAT(night, ...)`.
- Manager scope (`managerPropertyId`) overrides caller `propertyId`.
- `roomType` filter is positional and applied to both available + occupied subqueries.
- Reservation status whitelist excludes `cancelled`.
- `check_in` inclusive, `check_out` exclusive (the audit's exact ask).
- `NULLIF(SUM(available_rooms), 0)` guards zero-denominator divides.

**Files.**
- `src/services/reporting.service.ts` — full rewrite.

**Tests.**
- `unit_tests/reporting-sql.spec.ts` *(new, 13 tests)* — pins SQL
  shape: recursive CTE present, check-in/out semantics correct, no
  cancelled status, manager scope override, room-type filter
  positional, formula shapes for ADR/RevPAR, NULLIF guards, group-by
  format strings.
- `API_tests/reports-kpi.api.spec.ts` *(new, 7 tests, requires DB)* —
  seeds 4 available rooms + 1 maintenance room and 3 reservations
  (one cancelled), then asserts EXACT numerics:
  - per-night occupied/available counts
  - per-night ADR (100 / 150 / 150 cents)
  - per-night RevPAR (25 / 75 / 75 cents)
  - cancelled reservation never appears
  - check-out exclusive: 06-04 has 0 occupied for the 06-01→06-04 res
  - maintenance room excluded from available
  - weekly rollup folds 3 daily rows correctly

---

## 3) Fail-fast on insecure production secrets

**Issue.** `docker-compose.yml` set `NODE_ENV=production` with
hardcoded weak `JWT_SECRET=change_me_in_production` and
`ENCRYPTION_KEY=change_me_32_chars_minimum_here_x`. The application
silently warned but continued.

**Fix.**
- `src/config/environment.ts`:
  - New `validateProductionConfig(cfg)` function returning a list of
    structured problems for: known weak strings, length floors (32
    chars), default DB password, empty values.
  - New `ConfigValidationError` class.
  - Module-load fail-fast: when `NODE_ENV=production` and there are
    problems, prints a fatal banner and throws.
- `docker-compose.yml`:
  - Removed hardcoded weak secrets.
  - `JWT_SECRET: ${JWT_SECRET:-}` and `ENCRYPTION_KEY: ${ENCRYPTION_KEY:-}`
    pull from host env. Empty by default.
  - `NODE_ENV: ${NODE_ENV:-development}` defaults to dev so the local
    `docker compose up --build` flow still works. Production
    deployments must opt in explicitly.

**Why correct.** A production deployment cannot accidentally start
with a default secret — boot validation throws a `ConfigValidationError`
listing every problem, and the process supervisor sees a fatal banner
in its log even if it suppresses the throw.

**Tests** (`unit_tests/env-validation.spec.ts`, **14 tests**):
- defaults / empties / short / known-weak strings rejected for
  JWT_SECRET, ENCRYPTION_KEY, DB_PASSWORD
- aggregates multiple problems into a single error message
- module load: throws under NODE_ENV=production with defaults
- module load: passes under NODE_ENV=production with strong values
- module load: never throws under NODE_ENV=development

---

## 4) Zod validation on critical endpoints

**Issue.** Several high-risk endpoints accepted unvalidated bodies/queries.

**Fix.**
- `src/middleware/validation.middleware.ts` — added `validateQuery`
  helper alongside `validate(body)`.
- `src/utils/validation.ts` — new/strengthened schemas:
  - `createItinerarySchema` (now `.strict()`, MM/DD/YYYY + 12-hour
    time regex, max lengths)
  - `updateItinerarySchema` (`.strict()`, optional fields validate
    if provided)
  - `createCheckpointSchema`, `updateCheckpointSchema` (`.strict()`,
    position 1..30, label required)
  - `reportQuerySchema` (date format YYYY-MM-DD, groupBy enum,
    propertyId, roomType, **from <= to** refinement)
  - `revenueMixQuerySchema` (groupBy: channel | room_type)
  - `reportExportSchema` (full body with includePii boolean and
    date-order refinement)
- `src/routes/itineraries.routes.ts` — `validate(...)` on POST/PATCH
  for items and checkpoints.
- `src/routes/reports.routes.ts` — `validateQuery(...)` on
  /occupancy, /adr, /revpar, /revenue-mix; `validate(reportExportSchema)`
  on POST /export.

**Tests.**
- `unit_tests/validation-schemas.spec.ts` *(new, 31 tests)* — pins
  every accept/reject branch for each schema, including strict-mode
  unknown-field rejection and from > to.
- `API_tests/itineraries.api.spec.ts` — added 400 VALIDATION_ERROR
  cases for missing title, unknown field, bad date.
- `API_tests/reports.api.spec.ts` — added 400 VALIDATION_ERROR
  cases for missing from/to, bad date format, from > to, invalid
  reportType.

---

## 5) Documentation/reference consistency

**Issue.** `README.md` referenced `docs/audit-immutability.md` which
did not exist in the repo.

**Fix.**
- `docs/audit-immutability.md` *(restored)* — full enforcement model,
  operator path (script + verification), strict mode, archival
  behavior, residual risks.
- `README.md` — rewrote the Quick Start section to make the
  development vs production split explicit, documented the fail-fast
  secret validation, and added a Production secrets section pointing
  to the validator and unit tests.

---

## 6) `POST /accounts/me/export` spec/runtime drift

**Issue.** The OpenAPI spec implied an `expiresAt` field but the
runtime returned only `downloadUrl`.

**Fix.** Make the runtime match the prefer-richer contract:
- `src/services/auth.service.ts::exportData` — return type now
  `{ downloadUrl: string; expiresAt: string }` (ISO 8601). The
  expiry timestamp comes from the same value written to
  `export_records.expires_at`.
- `src/swagger.ts` — `/accounts/me/export` now declares an explicit
  200 response schema with both `downloadUrl` and `expiresAt`
  (date-time).

**Tests.**
- `API_tests/auth.api.spec.ts` — test rewritten to assert both fields
  exist, `expiresAt` parses as a valid Date, and the value is in the
  expected 24h ± slack window.

---

## 7) `/import/templates/:datasetType` endpoint exposure

**Issue.** The dataset templates endpoint was public, leaking the
column schema and serving as a reconnaissance hint before any auth
check.

**Fix.**
- `src/routes/import.routes.ts` — moved the templates route AFTER
  `authMiddleware`, `userLimiter`, and
  `requireRole('hotel_admin', 'manager')`. Least privilege; only
  roles that actually need to upload imports can fetch the templates.
- `src/swagger.ts` — `/import/templates/{datasetType}` switched from
  `pub(...)` to `endpoint(...)` with 401/403 documented.

**Tests** (`API_tests/import.api.spec.ts`):
- 401 unauthenticated rejected
- 403 member rejected
- 200 manager allowed
- 200 admin allowed

---

## 8) Sanitized error logging in production

**Issue.** The global error handler logged `err.message` and `err.stack`
unconditionally and surfaced `err.message` in the 500 response — a
classic information leak when error messages contain SQL fragments,
secrets, or path data.

**Fix.** `src/app.ts` global error handler:
- AppError path unchanged (already structured).
- Unhandled path:
  - Always logs `traceId` + `errorClass` (preserves traceability).
  - In **production**: omits `error` and `stack` from both the log
    line and the response body. The body returns a generic
    "Internal server error".
  - In **non-production**: logs the full message + stack and surfaces
    the underlying message in the response so developers can debug.
- Audit-log masking is unaffected — masking happens before the system
  logger and the system logger does not touch `audit_logs`.

**Tests** (`unit_tests/error-sanitization.spec.ts`, **4 tests**):
- non-prod: response and log carry the raw error string (`SECRET_VALUE_LEAK_token=abc123`)
- prod: response carries a generic 500; raw secret never appears
- prod: log entry has neither `error` nor `stack` but keeps `traceId` + `errorClass`
- AppError path unchanged in either env

---

## CI hygiene fix

While I was here I also added the unit-suite teardown
(`unit_tests/jest.setup.ts`) to the API project so its workers no
longer print "worker has failed to exit gracefully" warnings. The
warning was cosmetic but masked real failures in CI logs. Both
projects now exit cleanly.

---

## Files changed

| Area | Files |
|---|---|
| Itinerary idempotency | `migrations/018-fix-itinerary-idempotency-scope.js` *(new)*, `src/models/itinerary.model.ts`, `src/services/itinerary.service.ts`, `API_tests/itineraries.api.spec.ts` |
| Reporting KPIs | `src/services/reporting.service.ts`, `unit_tests/reporting-sql.spec.ts` *(new)*, `API_tests/reports-kpi.api.spec.ts` *(new)* |
| Production secrets | `src/config/environment.ts`, `docker-compose.yml`, `unit_tests/env-validation.spec.ts` *(new)*, `README.md` |
| Validation | `src/middleware/validation.middleware.ts`, `src/utils/validation.ts`, `src/routes/itineraries.routes.ts`, `src/routes/reports.routes.ts`, `unit_tests/validation-schemas.spec.ts` *(new)*, `API_tests/itineraries.api.spec.ts`, `API_tests/reports.api.spec.ts` |
| Docs consistency | `docs/audit-immutability.md` *(restored)*, `README.md` |
| Account export contract | `src/services/auth.service.ts`, `src/swagger.ts`, `API_tests/auth.api.spec.ts` |
| Import templates auth | `src/routes/import.routes.ts`, `src/swagger.ts`, `API_tests/import.api.spec.ts` |
| Error sanitization | `src/app.ts`, `unit_tests/error-sanitization.spec.ts` *(new)* |
| CI hygiene | `jest.config.js` |
| Changelog | `docs/audit-fixes-changelog.md` *(this file)* |

## Verification commands

```sh
npm run build                                              # tsc exit 0
npm run test:unit                                          # 23 suites / 243 tests / clean
npm run test:api                                           # boundary mode if no DB
docker compose up db -d && npm run test:api                # with DB

# New focused suites:
npx jest --selectProjects unit --testPathPattern reporting-sql
npx jest --selectProjects unit --testPathPattern validation-schemas
npx jest --selectProjects unit --testPathPattern env-validation
npx jest --selectProjects unit --testPathPattern error-sanitization
npx jest --selectProjects api  --testPathPattern reports-kpi
```

## Residual / not-blocked work

None of the eight items are partially-completed. The DB-dependent
tests for items 1, 2, 7 require `docker compose up db -d` to actually
exercise — under the boundary mode they are correctly **skipped**, not
fake-passed.
