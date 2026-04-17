# Test Coverage Audit

## Scope and method
- Static inspection only (no test execution, no builds, no containers run).
- Inspected only routing, API tests, unit tests, `README.md`, `run_tests.sh`, and minimal config needed for classification.
- Evidence sources: `src/app.ts`, `src/routes/*.ts`, `API_tests/*.spec.ts`, `unit_tests/*.spec.ts`, `jest.config.js`, `run_tests.sh`, `README.md`.

## Project type detection
- Required explicit type declaration at README top is missing (`README.md:1`).
- Inferred project type: **backend** (Express API-only structure, no frontend app/files).
- Inference evidence: backend routes/controllers in `src/`; no frontend source files found by glob `**/*.{tsx,jsx,vue,svelte}`.

## Backend Endpoint Inventory

1. `GET /health`
2. `GET /docs/openapi.json`
3. `GET /api/docs/openapi.json`
4. `GET /exports/:filename`
5. `POST /auth/register`
6. `POST /auth/login`
7. `POST /auth/logout`
8. `PATCH /auth/change-password`
9. `GET /accounts/me`
10. `PATCH /accounts/me`
11. `POST /accounts/me/delete`
12. `POST /accounts/me/export`
13. `GET /users`
14. `GET /users/:id`
15. `PATCH /users/:id`
16. `DELETE /users/:id`
17. `POST /groups/join`
18. `GET /groups`
19. `GET /groups/:id`
20. `GET /groups/:id/members`
21. `GET /groups/:id/required-fields`
22. `GET /groups/:id/my-fields`
23. `PUT /groups/:id/my-fields`
24. `POST /groups`
25. `PATCH /groups/:id`
26. `DELETE /groups/:id/members/:userId`
27. `POST /groups/:id/required-fields`
28. `PATCH /groups/:id/required-fields/:fieldId`
29. `DELETE /groups/:id/required-fields/:fieldId`
30. `GET /groups/:groupId/itineraries`
31. `POST /groups/:groupId/itineraries`
32. `GET /groups/:groupId/itineraries/:itemId`
33. `PATCH /groups/:groupId/itineraries/:itemId`
34. `DELETE /groups/:groupId/itineraries/:itemId`
35. `GET /groups/:groupId/itineraries/:itemId/checkpoints`
36. `POST /groups/:groupId/itineraries/:itemId/checkpoints`
37. `PATCH /groups/:groupId/itineraries/:itemId/checkpoints/:checkpointId`
38. `DELETE /groups/:groupId/itineraries/:itemId/checkpoints/:checkpointId`
39. `POST /groups/:groupId/itineraries/:itemId/checkin`
40. `GET /groups/:groupId/files`
41. `POST /groups/:groupId/files`
42. `GET /groups/:groupId/files/:fileId`
43. `DELETE /groups/:groupId/files/:fileId`
44. `GET /notifications`
45. `PATCH /notifications/:id/read`
46. `GET /reports/occupancy`
47. `GET /reports/adr`
48. `GET /reports/revpar`
49. `GET /reports/revenue-mix`
50. `POST /reports/export`
51. `GET /reports/staffing`
52. `GET /reports/evaluations`
53. `GET /import/templates/:datasetType`
54. `POST /import/upload`
55. `POST /import/:batchId/commit`
56. `GET /import/:batchId`
57. `POST /face/enroll/start`
58. `POST /face/enroll/:sessionId/capture`
59. `POST /face/enroll/:sessionId/complete`
60. `GET /face/enrollments`
61. `PATCH /face/enrollments/:id`
62. `GET /quality/checks`
63. `POST /quality/checks`
64. `POST /quality/checks/:id/run`
65. `GET /quality/results`
66. `GET /audit-logs`
67. `GET /audit-logs/export`

Endpoint sources: `src/app.ts` and `src/routes/*.ts`.

## API Test Mapping Table

| Endpoint | Covered | Test type | Test files | Evidence |
|---|---|---|---|---|
| `GET /health` | yes | true no-mock HTTP | `API_tests/health.api.spec.ts`, `API_tests/auth.api.spec.ts` | `describe('Slice 1 — Health API')`, `test('GET /health returns 200...')` |
| `GET /docs/openapi.json` | yes | true no-mock HTTP | `API_tests/health.api.spec.ts` | `test('GET /docs/openapi.json returns the raw OpenAPI 3 spec')` |
| `GET /api/docs/openapi.json` | no | none | - | route exists in `src/app.ts:65`; no matching request in API tests |
| `GET /exports/:filename` | yes | true no-mock HTTP | `API_tests/reports.api.spec.ts` | tests `GET /exports/:filename 401`, owner download, non-owner 403 |
| `POST /auth/register` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts`, others | `describe('POST /auth/register')` |
| `POST /auth/login` | yes | true no-mock HTTP | many API specs | `describe('POST /auth/login')` and setup logins |
| `POST /auth/logout` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts` | `describe('POST /auth/logout')` |
| `PATCH /auth/change-password` | no | none | - | route in `src/routes/auth.routes.ts:13`; no API test request |
| `GET /accounts/me` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts`, `API_tests/rbac.api.spec.ts` | `describe('GET /accounts/me')` |
| `PATCH /accounts/me` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts` | `describe('PATCH /accounts/me')` |
| `POST /accounts/me/delete` | yes | true no-mock HTTP | `API_tests/accounts-self-delete.api.spec.ts` | top describe `POST /accounts/me/delete` |
| `POST /accounts/me/export` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts`, `API_tests/security-sweep.api.spec.ts` | `describe('POST /accounts/me/export')` |
| `GET /users` | yes | true no-mock HTTP | `API_tests/rbac.api.spec.ts`, `API_tests/security-sweep.api.spec.ts` | `describe('GET /users')` |
| `GET /users/:id` | yes | true no-mock HTTP | `API_tests/rbac.api.spec.ts` | `describe('GET /users/:id')` |
| `PATCH /users/:id` | yes | true no-mock HTTP | `API_tests/rbac.api.spec.ts` | `describe('PATCH /users/:id')` |
| `DELETE /users/:id` | yes | true no-mock HTTP | `API_tests/rbac.api.spec.ts` | `describe('DELETE /users/:id')` |
| `POST /groups/join` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts` and others | `describe('POST /groups/join')` |
| `GET /groups` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts`, `API_tests/security-sweep.api.spec.ts` | `describe('GET /groups')` |
| `GET /groups/:id` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts`, `API_tests/security-sweep.api.spec.ts` | `describe('GET /groups/:id')` |
| `GET /groups/:id/members` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts` | `describe('GET /groups/:id/members')` |
| `GET /groups/:id/required-fields` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts` | `test('GET /groups/:id/required-fields 200...')` |
| `GET /groups/:id/my-fields` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts` | `test('GET /groups/:id/my-fields 200...')` |
| `PUT /groups/:id/my-fields` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts` | `test('PUT /groups/:id/my-fields 200...')` |
| `POST /groups` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts`, many others | `describe('POST /groups')` |
| `PATCH /groups/:id` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts` | `describe('PATCH /groups/:id')` |
| `DELETE /groups/:id/members/:userId` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts` | `describe('DELETE /groups/:id/members/:userId')` |
| `POST /groups/:id/required-fields` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts`, `API_tests/itineraries.api.spec.ts` | tests add required field |
| `PATCH /groups/:id/required-fields/:fieldId` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts` | `test('PATCH /groups/:id/required-fields/:fieldId 200...')` |
| `DELETE /groups/:id/required-fields/:fieldId` | no | none | - | route in `src/routes/groups.routes.ts:49`; no API request evidence |
| `GET /groups/:groupId/itineraries` | yes | true no-mock HTTP | `API_tests/itineraries.api.spec.ts` | `test('GET list items 200')` |
| `POST /groups/:groupId/itineraries` | yes | true no-mock HTTP | `API_tests/itineraries.api.spec.ts` | `test('POST create item 201')` |
| `GET /groups/:groupId/itineraries/:itemId` | yes | true no-mock HTTP | `API_tests/itineraries.api.spec.ts` | `test('GET single item 200')` |
| `PATCH /groups/:groupId/itineraries/:itemId` | yes | true no-mock HTTP | `API_tests/itineraries.api.spec.ts` | `test('PATCH update item 200')` |
| `DELETE /groups/:groupId/itineraries/:itemId` | yes | true no-mock HTTP | `API_tests/itineraries.api.spec.ts` | `test('DELETE item 204 — owner only')` |
| `GET /groups/:groupId/itineraries/:itemId/checkpoints` | yes | true no-mock HTTP | `API_tests/itineraries.api.spec.ts` | `test('GET list checkpoints 200')` |
| `POST /groups/:groupId/itineraries/:itemId/checkpoints` | yes | true no-mock HTTP | `API_tests/itineraries.api.spec.ts` | `test('POST add checkpoint 201')` |
| `PATCH /groups/:groupId/itineraries/:itemId/checkpoints/:checkpointId` | yes | true no-mock HTTP | `API_tests/itineraries.api.spec.ts` | `test('PATCH update checkpoint 200')` |
| `DELETE /groups/:groupId/itineraries/:itemId/checkpoints/:checkpointId` | no | none | - | route in `src/routes/itineraries.routes.ts:26`; no API request evidence |
| `POST /groups/:groupId/itineraries/:itemId/checkin` | yes | true no-mock HTTP | `API_tests/itineraries.api.spec.ts` | `test('POST checkin 200...')` |
| `GET /groups/:groupId/files` | yes | true no-mock HTTP | `API_tests/files.api.spec.ts` | `test('GET list files 200 (manager)')` |
| `POST /groups/:groupId/files` | yes | true no-mock HTTP | `API_tests/files.api.spec.ts` | `test('POST upload 201...')` |
| `GET /groups/:groupId/files/:fileId` | yes | true no-mock HTTP | `API_tests/files.api.spec.ts` | `test('GET file 403 — member cannot download')` |
| `DELETE /groups/:groupId/files/:fileId` | yes | true no-mock HTTP | `API_tests/files.api.spec.ts` | `test('DELETE file 204 — owner can delete')` |
| `GET /notifications` | yes | true no-mock HTTP | `API_tests/notifications.api.spec.ts` | `test('GET /notifications...')` |
| `PATCH /notifications/:id/read` | yes | true no-mock HTTP | `API_tests/notifications.api.spec.ts` | `test('PATCH /notifications/:id/read...')` |
| `GET /reports/occupancy` | yes | true no-mock HTTP | `API_tests/reports.api.spec.ts`, `reports-kpi.api.spec.ts` | `test('GET /reports/occupancy...')` |
| `GET /reports/adr` | yes | true no-mock HTTP | `API_tests/reports.api.spec.ts`, `reports-room-type.api.spec.ts`, `reports-kpi.api.spec.ts` | ADR tests |
| `GET /reports/revpar` | yes | true no-mock HTTP | `API_tests/reports.api.spec.ts`, `reports-room-type.api.spec.ts`, `reports-kpi.api.spec.ts` | RevPAR tests |
| `GET /reports/revenue-mix` | yes | true no-mock HTTP | `API_tests/reports.api.spec.ts`, `reports-revenue-mix-rollup.api.spec.ts` | revenue-mix tests |
| `POST /reports/export` | yes | true no-mock HTTP | `API_tests/reports.api.spec.ts`, `reports-export-room-type.api.spec.ts` | export tests |
| `GET /reports/staffing` | yes | true no-mock HTTP | `API_tests/reports.api.spec.ts` | `test('GET /reports/staffing 200')` |
| `GET /reports/evaluations` | yes | true no-mock HTTP | `API_tests/reports.api.spec.ts` | `test('GET /reports/evaluations 200')` |
| `GET /import/templates/:datasetType` | yes | true no-mock HTTP | `API_tests/import.api.spec.ts` | template auth + invalid datasetType tests |
| `POST /import/upload` | yes | true no-mock HTTP | `API_tests/import.api.spec.ts` | upload tests |
| `POST /import/:batchId/commit` | yes | true no-mock HTTP | `API_tests/import.api.spec.ts` | commit test |
| `GET /import/:batchId` | yes | true no-mock HTTP | `API_tests/import.api.spec.ts` | batch status test |
| `POST /face/enroll/start` | yes | true no-mock HTTP | `API_tests/face.api.spec.ts` | `test('POST /face/enroll/start 201...')` |
| `POST /face/enroll/:sessionId/capture` | yes | true no-mock HTTP | `API_tests/face.api.spec.ts` | capture tests |
| `POST /face/enroll/:sessionId/complete` | yes | true no-mock HTTP | `API_tests/face.api.spec.ts` | complete tests |
| `GET /face/enrollments` | yes | true no-mock HTTP | `API_tests/face.api.spec.ts` | list enrollments test |
| `PATCH /face/enrollments/:id` | yes (conditional path) | true no-mock HTTP | `API_tests/face.api.spec.ts` | `test('PATCH /face/enrollments/:id — deactivate')` with runtime `if (active)` branch |
| `GET /quality/checks` | yes | true no-mock HTTP | `API_tests/quality.api.spec.ts`, `security-sweep.api.spec.ts` | list checks test |
| `POST /quality/checks` | yes | true no-mock HTTP | `API_tests/quality.api.spec.ts` | create + member 403 tests |
| `POST /quality/checks/:id/run` | yes | true no-mock HTTP | `API_tests/quality.api.spec.ts` | run check test |
| `GET /quality/results` | yes | true no-mock HTTP | `API_tests/quality.api.spec.ts` | results test |
| `GET /audit-logs` | yes | true no-mock HTTP | `API_tests/audit.api.spec.ts`, `security-sweep.api.spec.ts` | audit list tests |
| `GET /audit-logs/export` | yes | true no-mock HTTP | `API_tests/audit.api.spec.ts` | export tests |

## API Test Classification

1. **True No-Mock HTTP tests**
   - API suite bootstraps app and uses supertest against `app` (`API_tests/*.spec.ts` imports `app` and calls `request(app)`), no mock declarations found in API tests.
   - Files: `API_tests/health.api.spec.ts`, `auth.api.spec.ts`, `rbac.api.spec.ts`, `accounts-self-delete.api.spec.ts`, `groups.api.spec.ts`, `itineraries.api.spec.ts`, `files.api.spec.ts`, `notifications.api.spec.ts`, `reports.api.spec.ts`, `reports-room-type.api.spec.ts`, `reports-export-room-type.api.spec.ts`, `reports-kpi.api.spec.ts`, `reports-revenue-mix-rollup.api.spec.ts`, `import.api.spec.ts`, `face.api.spec.ts`, `quality.api.spec.ts`, `audit.api.spec.ts`, `security-sweep.api.spec.ts`.

2. **HTTP with Mocking**
   - None detected in `API_tests/` (no `jest.mock`, `vi.mock`, `sinon.stub`, or DI overrides found by grep).

3. **Non-HTTP (unit / isolated integration)**
   - `unit_tests/*.spec.ts` (25 files) test services/controllers/middleware/utilities directly, often with Sequelize mocked.

## Mock Detection

- **Global unit-test DB mocking via mapper**
  - `jest.config.js:11-20` maps `sequelize` and `src/config/database` imports to `src/__mocks__/sequelize.mock.ts`.
  - Effect: unit tests bypass real DB and transport.

- **Mocked model/service calls in unit tests**
  - `unit_tests/idempotency-service.spec.ts` uses `(IdempotencyKey.findOne as jest.Mock)...` and `(IdempotencyKey.create as jest.Mock)...`.
  - `unit_tests/reporting-sql.spec.ts` uses `(sequelize.query as jest.Mock)...`.
  - `unit_tests/manager-scope-controller.spec.ts` uses mocked `sequelize.query` and fake req/res objects.

- **HTTP layer bypass in unit tests**
  - `unit_tests/rbac.spec.ts` executes middleware with fabricated request/response (`mockReqRes`), no HTTP routing.

- **API tests mock status**
  - No API-test transport/controller/service mocking detected in `API_tests/`.

## Coverage Summary

- Total endpoints: **67**
- Endpoints with HTTP tests: **63**
- Endpoints with true no-mock HTTP tests: **63**
- HTTP coverage: **94.03%** (`63/67`)
- True API coverage: **94.03%** (`63/67`)

Uncovered endpoints:
- `GET /api/docs/openapi.json`
- `PATCH /auth/change-password`
- `DELETE /groups/:id/required-fields/:fieldId`
- `DELETE /groups/:groupId/itineraries/:itemId/checkpoints/:checkpointId`

Note: this inventory includes explicit `app.get` and `router.<method>` endpoints. Uncovered count above reflects 4 uncovered endpoints. `PATCH /face/enrollments/:id` is counted as covered but conditionally exercised (`if (active)` branch in `API_tests/face.api.spec.ts`).

## Unit Test Summary

### Backend Unit Tests

- Unit test files detected: **25** under `unit_tests/`.
- Controllers covered:
  - `unit_tests/manager-scope-controller.spec.ts` (`evaluationReport`, `staffingReport` in `src/controllers/import.controller.ts`)
  - `unit_tests/report-csv.spec.ts` (`serializeReportRowsToCsv` in `src/controllers/reports.controller.ts`)
  - `unit_tests/audit-serialize.spec.ts` (`serializeAuditRow` in `src/controllers/audit.controller.ts`)
- Services covered:
  - `unit_tests/idempotency-service.spec.ts` (`src/services/idempotency.service.ts`)
  - `unit_tests/reporting-sql.spec.ts` (`src/services/reporting.service.ts`)
  - `unit_tests/manager-isolation.spec.ts` (`src/services/import.service.ts`)
- Middleware/guards covered:
  - `unit_tests/rbac.spec.ts` (`requireRole`, `requirePropertyScope`)
  - `unit_tests/rate-limit.spec.ts` (`userLimiterKey`)
  - `unit_tests/bootstrap.spec.ts` (`auditMiddleware`)
- Repositories/models covered indirectly through service/controller unit tests and audit immutability tests.

Important backend modules not unit-tested (directly) based on inspected scope:
- `src/controllers/auth.controller.ts` (no direct unit spec)
- `src/controllers/users.controller.ts` (no direct unit spec)
- `src/controllers/groups.controller.ts` (no direct unit spec)
- `src/controllers/files.controller.ts` (no direct unit spec)
- `src/controllers/notifications.controller.ts` (no direct unit spec)
- `src/controllers/quality.controller.ts` (no direct unit spec)
- `src/controllers/face.controller.ts` (no direct unit spec)

### Frontend Unit Tests (STRICT REQUIREMENT)

- Frontend test files: **NONE** (no frontend code files detected; no frontend test suites detected).
- Frameworks/tools detected for frontend component testing: **NONE**.
- Components/modules covered: **NONE**.
- Important frontend components/modules not tested: **Not applicable; no frontend layer found in repository.**

**Frontend unit tests: MISSING**

Strict failure rule check:
- Inferred project type is backend, not fullstack/web, so this is **not** flagged as the required CRITICAL GAP condition.

### Cross-Layer Observation

- No frontend layer detected; balance analysis across FE/BE is not applicable.

## API Observability Check

Strong examples (method/path/input/output explicit):
- `API_tests/auth.api.spec.ts` (`POST /auth/register`, `PATCH /accounts/me`) includes payload and response assertions.
- `API_tests/reports-kpi.api.spec.ts` includes deterministic numeric assertions on response body fields.
- `API_tests/audit.api.spec.ts` validates masking behavior and response content deeply.

Weak examples (request/response semantics shallow):
- `API_tests/reports.api.spec.ts` has several status-only assertions (`GET /reports/adr 200`, `GET /reports/revpar 200`, etc.).
- `API_tests/quality.api.spec.ts` includes tests with limited response-content assertions (`GET /quality/results 200`).
- `API_tests/face.api.spec.ts` patch deactivate path is conditional (`if (active)`) and may not always exercise endpoint.

Verdict: Observability is **mixed**; a subset of tests are weak.

## Tests Check

- `run_tests.sh` is Docker-based (`docker compose` orchestration + `docker compose exec ... jest`) -> **OK**.
- Script waits for health endpoint and runs both unit/api suites -> **OK**.
- Repository docs still present local non-Docker test flows (`npm run test:*`) in `README.md:79-90` -> **flag as weaker portability against strict Docker-only environment rule (README audit impact)**.

## Test Quality & Sufficiency

- Success paths: broadly covered across auth, groups, itineraries, files, notifications, reports, import, face, quality, audit.
- Failure/validation/authz paths: strong on many critical surfaces (RBAC, validation, idempotency, export ownership, sensitive masking).
- Edge cases: strong in reporting and idempotency suites.
- Gaps:
  - 4 route-method endpoints missing direct API tests.
  - Some API tests remain status-centric and could miss response-shape regressions.
  - Unit suite includes several synthetic tests that validate regex/constants rather than executable production branches (`unit_tests/groups.spec.ts`, `unit_tests/itineraries.spec.ts`, parts of `unit_tests/auth.spec.ts`).

## End-to-End Expectations

- For fullstack projects, FE<->BE E2E would be expected. This repository is inferred backend-only, so FE<->BE E2E is not applicable.

## Test Coverage Score (0-100)

**79/100**

## Score Rationale

- High route-method HTTP coverage with real handler execution and no API-layer mocking.
- Strong depth in several critical domains (security, reporting numerics, idempotency, audit masking/immutability).
- Deduction for uncovered endpoints, weak observability in part of API suite, and presence of low-value/synthetic unit tests.

## Key Gaps

1. Missing API tests for:
   - `PATCH /auth/change-password`
   - `DELETE /groups/:id/required-fields/:fieldId`
   - `DELETE /groups/:groupId/itineraries/:itemId/checkpoints/:checkpointId`
   - `GET /api/docs/openapi.json`
2. Conditional endpoint probe (`PATCH /face/enrollments/:id`) is not guaranteed to execute every run.
3. Several report/quality tests assert status only (weak contract checks).

## Confidence & Assumptions

- Confidence: **high** for route inventory and static test mapping.
- Assumptions:
  - Endpoint inventory is based on explicit method registrations only.
  - No runtime-generated routes beyond inspected files.
  - Coverage classified strictly from visible request calls in test code.

---

# README Audit

## README location

- Required file exists: `README.md` at repository root -> pass.

## Hard Gate Failures

1. **Startup instruction exact requirement mismatch (backend/fullstack)**
   - Requirement: must include `docker-compose up`.
   - Found: `docker compose up --build` (`README.md:9`) and `docker compose up db -d` (`README.md:90`), but not exact required command string.
   - Status: **FAIL**.

2. **Verification method incomplete**
   - Requirement: explicit method to confirm system works (API via curl/Postman or equivalent).
   - README has run/test instructions but no explicit runtime verification flow (e.g., health curl + expected output).
   - Status: **FAIL**.

3. **Environment rule violation (strict Docker-contained operation)**
   - Requirement forbids local runtime dependency paths.
   - README explicitly documents non-Docker local run/test paths (`npm run dev`, `npm run test:unit`, `npm run test:api`, `npx jest...`) in `README.md:16`, `README.md:79-86`.
   - Status: **FAIL**.

## High Priority Issues

- Missing explicit project-type declaration at top (`backend/fullstack/web/android/ios/desktop`) required by this audit protocol (`README.md:1-4`).
- Startup section does not include exact required command token `docker-compose up`.
- No explicit "how to verify API is running" step with concrete command and expected response.

## Medium Priority Issues

- README mixes Docker-first and local non-container workflows, weakening strict reproducibility posture.
- Verification instructions are test-run focused rather than user-facing functional verification.

## Low Priority Issues

- Overall markdown quality is good (clear sections/tables), but strict compliance wording could be tighter.
- Architecture explanation is present implicitly in directory layout/security notes, but could include clearer request flow overview.

## Gate-by-gate assessment

- Formatting quality: **PASS** (`README.md` structured and readable).
- Startup instructions (backend/fullstack): **FAIL** (exact required command string missing).
- Access method (URL+port): **PASS** (`README.md:49-53`).
- Verification method: **FAIL** (no explicit curl/Postman/UI validation flow).
- Environment rules (Docker-contained only): **FAIL** (local runtime paths documented).
- Demo credentials with roles (auth exists): **PASS** (`README.md:55-63`, includes all listed roles).

## README Verdict

**FAIL**

Rationale: multiple hard-gate failures under strict mode.
