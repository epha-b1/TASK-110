# Fix Check (Static Re-Review)

## Verdict
- No new **Blocker/High** issues found in the rechecked remediation scope.
- Status: **Serious issues addressed (static evidence present)**.

## What I Rechecked
1. `roomType` propagation for report export path
2. export/report schema + docs alignment
3. idempotency resource scoping
4. account self-delete cascade test coverage
5. sensitive face-template artifacts removed from tracked directory

## Evidence of Fixes

### 1) Report export now supports roomType
- `reportExportSchema` includes `roomType` with bounds: `repo/src/utils/validation.ts:104`
- Export controller reads and forwards `roomType`: `repo/src/controllers/reports.controller.ts:70`, `repo/src/controllers/reports.controller.ts:85`, `repo/src/controllers/reports.controller.ts:86`, `repo/src/controllers/reports.controller.ts:87`

### 2) API docs updated for export roomType
- OpenAPI runtime spec includes `roomType` on `/reports/export`: `repo/src/swagger.ts:221`
- External API doc includes `roomType` + validation notes: `docs/api-spec.md:1069`, `docs/api-spec.md:1099`, `docs/api-spec.md:1118`

### 3) Idempotency scope fixed to include target resource
- Service scope uses `(key, actor_id, operation, resource_id)`: `repo/src/services/idempotency.service.ts:12`, `repo/src/services/idempotency.service.ts:112`, `repo/src/services/idempotency.service.ts:151`
- Migration adds resource-aware unique index + normalization: `repo/migrations/019-idempotency-scope-by-resource.js:4`, `repo/migrations/019-idempotency-scope-by-resource.js:82`
- Itinerary update call sites pass `itemId` as scope: `repo/src/services/itinerary.service.ts:177`, `repo/src/services/itinerary.service.ts:204`

### 4) Account self-delete cascade now has direct API coverage
- New end-to-end cascade suite exists and covers ownership transfer/archive/membership/soft-delete/login-block/face deactivation: `repo/API_tests/accounts-self-delete.api.spec.ts:64`

### 5) Sensitive face-template artifacts cleaned
- Directory now only contains `.gitkeep`: `repo/face-templates`

### 6) Export roomType regression tests added
- End-to-end `/reports/export` roomType CSV assertions + validation negatives: `repo/API_tests/reports-export-room-type.api.spec.ts:112`, `repo/API_tests/reports-export-room-type.api.spec.ts:287`

## Remaining Boundary
- This is static-only verification; runtime behavior (DB state/migration execution/real HTTP responses) still requires manual execution to confirm.
