# AuditReport-1 Fix Check (Static)

## Verdict
- **Overall: Pass (Static Fix-Check)**
- All previously reported material issues (High/Medium/Low) are statically addressed in code, tests, and docs/spec.
- Runtime behavior is not executed in this audit; items that require execution remain manual verification.

## Scope / Boundary
- Reviewed statically only: `repo/src/**`, `repo/migrations/**`, `repo/API_tests/**`, `repo/unit_tests/**`, `repo/README.md`, `repo/docker-compose.yml`, `repo/src/swagger.ts`, `docs/api-spec.md`.
- Not executed: app startup, Docker, DB migration run, tests.

## Prior-Issue Fix Checklist

### 1) Cross-tenant itinerary idempotency leak (High)
- **Status: Fixed**
- Service lookup now scoped by `group_id + created_by + idempotency_key`: `repo/src/services/itinerary.service.ts:76`
- Model composite unique index added: `repo/src/models/itinerary.model.ts:46`
- Migration adds scoped unique index and removes global key index: `repo/migrations/018-fix-itinerary-idempotency-scope.js:42`
- Cross-tenant/cross-user regression tests present: `repo/API_tests/itineraries.api.spec.ts:178`

### 2) ADR/RevPAR denominator semantics (High)
- **Status: Fixed**
- Reporting rewritten to room-night CTE with check-in inclusive / check-out exclusive: `repo/src/services/reporting.service.ts:87`, `repo/src/services/reporting.service.ts:107`
- Maintenance excluded from availability: `repo/src/services/reporting.service.ts:77`, `repo/src/services/reporting.service.ts:82`
- Deterministic KPI numeric tests added: `repo/API_tests/reports-kpi.api.spec.ts:1`

### 3) Insecure production defaults for secrets (High)
- **Status: Fixed**
- Production fail-fast validation implemented: `repo/src/config/environment.ts:135`
- Weak/default secret detection implemented: `repo/src/config/environment.ts:45`
- Compose no longer hardcodes demo JWT/encryption secrets: `repo/docker-compose.yml:29`

### 4) Missing request validation on key endpoints (Medium)
- **Status: Fixed**
- Itinerary create/update/checkpoint validation wired: `repo/src/routes/itineraries.routes.ts:18`
- Reports query/body validation wired: `repo/src/routes/reports.routes.ts:20`, `repo/src/routes/reports.routes.ts:25`
- Schemas for itinerary/reports strict constraints present: `repo/src/utils/validation.ts:30`, `repo/src/utils/validation.ts:79`, `repo/src/utils/validation.ts:104`

### 5) Documentation reference inconsistency (Medium)
- **Status: Fixed**
- README references existing scripts for audit immutability: `repo/README.md:108`
- Referenced files exist: `repo/scripts/audit-immutability.sql`, `repo/scripts/verify-audit-immutability.sh`

### 6) API spec drift (`/accounts/me/export` response) (Medium)
- **Status: Fixed**
- Runtime returns `downloadUrl` and `expiresAt`: `repo/src/services/auth.service.ts:282`, `repo/src/services/auth.service.ts:326`
- Controller returns service payload directly: `repo/src/controllers/accounts.controller.ts:53`
- Swagger and static spec include `expiresAt`: `repo/src/swagger.ts:87`, `docs/api-spec.md:207`

### 7) Public import templates endpoint (Low)
- **Status: Fixed**
- Import routes now protected by auth + role guard: `repo/src/routes/import.routes.ts:16`, `repo/src/routes/import.routes.ts:18`
- API authorization tests added: `repo/API_tests/import.api.spec.ts:30`

### 8) Potential sensitive leakage in unhandled error path (Medium)
- **Status: Fixed**
- Production error sanitization in global handler: `repo/src/app.ts:123`, `repo/src/app.ts:145`, `repo/src/app.ts:153`
- Unit tests for production sanitization added: `repo/unit_tests/error-sanitization.spec.ts:59`

## Security Re-check Summary
- Authentication entry points: **Pass** (`repo/src/routes/auth.routes.ts:10`, `repo/src/middleware/auth.middleware.ts:24`)
- Route-level authorization: **Pass** (`repo/src/routes/users.routes.ts:10`, `repo/src/routes/audit.routes.ts:9`, `repo/src/routes/import.routes.ts:18`)
- Object-level authorization / tenant isolation: **Pass (static)** after scoped idempotency fix (`repo/src/services/itinerary.service.ts:76`)
- Admin/internal protection: **Pass** (`repo/src/routes/quality.routes.ts:9`, `repo/src/routes/audit.routes.ts:9`)

## Tests/Logging Re-check
- Unit tests: expanded around env validation and error sanitization (`repo/unit_tests/env-validation.spec.ts:1`, `repo/unit_tests/error-sanitization.spec.ts:1`)
- API tests: expanded around idempotency isolation and KPI exactness (`repo/API_tests/itineraries.api.spec.ts:178`, `repo/API_tests/reports-kpi.api.spec.ts:1`)
- Logging and masking controls remain present (`repo/src/utils/masking.ts:1`, `repo/src/controllers/audit.controller.ts:19`)

## Manual Verification Required (Outside Static Boundary)
- Apply migrations on a real MySQL instance and verify index state post-migration (`018` applied cleanly across environments).
- Execute KPI tests and spot-check SQL outputs on real DB engine.
- Start app in `NODE_ENV=production` to validate fail-fast behavior with weak/strong secrets.

## Final Conclusion
- **Static fix-check result: all previously reported issues are addressed.**
