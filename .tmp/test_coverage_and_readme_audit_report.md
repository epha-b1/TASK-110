# Test Coverage Audit

## Scope and method
- Re-audit executed with static inspection plus test re-run evidence.
- Static sources inspected: `src/app.ts`, `src/routes/*.ts`, `API_tests/*.spec.ts`, `unit_tests/*.spec.ts`, `jest.config.js`, `run_tests.sh`, `README.md`.
- Retest command executed: `./run_tests.sh`.

## Project type detection
- README now explicitly declares project type: **backend** (`README.md:3`).
- Inference corroboration: Express API codebase, no frontend source tree/components.

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

Source: `src/app.ts`, `src/routes/*.ts`.

## API Test Mapping Table (delta-focused + strict evidence)
| Endpoint | Covered | Test type | Test files | Evidence |
|---|---|---|---|---|
| `PATCH /auth/change-password` | yes | true no-mock HTTP | `API_tests/auth.api.spec.ts` | `describe('PATCH /auth/change-password')` + tests for 200/400/401 (`API_tests/auth.api.spec.ts:214`) |
| `DELETE /groups/:id/required-fields/:fieldId` | yes | true no-mock HTTP | `API_tests/groups.api.spec.ts` | `describe('DELETE /groups/:id/required-fields/:fieldId')` + 403/204/list checks (`API_tests/groups.api.spec.ts:202`) |
| `DELETE /groups/:groupId/itineraries/:itemId/checkpoints/:checkpointId` | yes | true no-mock HTTP | `API_tests/itineraries.api.spec.ts` | delete describe block with setup+403+204+list assertions (`API_tests/itineraries.api.spec.ts:164`) |
| `GET /api/docs/openapi.json` | yes | true no-mock HTTP | `API_tests/health.api.spec.ts` | `test('GET /api/docs/openapi.json returns the same OpenAPI 3 spec...')` (`API_tests/health.api.spec.ts:73`) |
| `PATCH /face/enrollments/:id` | yes | true no-mock HTTP | `API_tests/face.api.spec.ts` | deterministic setup then PATCH always executes (`API_tests/face.api.spec.ts:74`) |

All other endpoints in the inventory above are covered by API tests and execute through `request(app)` without API-layer mocking.

## API Test Classification
1. **True No-Mock HTTP**: all API specs under `API_tests/` use `supertest` against `app`; real middleware/routes/controllers execute.
2. **HTTP with Mocking**: none detected in `API_tests/`.
3. **Non-HTTP**: `unit_tests/*.spec.ts` (26 files) are unit-level/isolated.

## Mock detection
- API tests: no `jest.mock` / `vi.mock` / `sinon.stub` usage detected.
- Unit tests: mocking present by design (`jest.config.js` maps Sequelize/database to `src/__mocks__/sequelize.mock.ts`; explicit `jest.Mock` usage in unit specs such as `unit_tests/idempotency-service.spec.ts`, `unit_tests/reporting-sql.spec.ts`).

## Coverage Summary
- Total endpoints: **67**
- Endpoints with HTTP tests: **67**
- Endpoints with TRUE no-mock HTTP tests: **67**
- HTTP coverage %: **100%**
- True API coverage %: **100%**

## Unit Test Summary

### Backend Unit Tests
- Unit suites passed: **26** (`Test Suites: 26 passed, 26 total` from run output).
- Added/strengthened direct backend coverage includes:
  - `unit_tests/auth-controller.spec.ts` (direct controller wiring for register/login/logout/changePassword).
  - `unit_tests/groups.spec.ts` refocused to real service branch behavior.
  - `unit_tests/itineraries.spec.ts` refocused to real production validation schemas.
- Coverage spans controllers, services, middleware, validation, CSV/masking, import/reporting safety paths.

Important backend modules still not directly unit-isolated (but API-covered):
- `src/controllers/users.controller.ts`
- `src/controllers/files.controller.ts`
- `src/controllers/notifications.controller.ts`
- `src/controllers/quality.controller.ts`
- `src/controllers/face.controller.ts`

### Frontend Unit Tests (STRICT REQUIREMENT)
- Frontend test files: **NONE**.
- Frameworks/tools detected for frontend tests: **NONE**.
- Components/modules covered: **NONE**.
- Important frontend components/modules not tested: **N/A (backend project).**

**Frontend unit tests: MISSING**

Strict failure rule result:
- Not triggered (project type is backend, not fullstack/web).

### Cross-Layer Observation
- Not applicable; frontend layer not present.

## API Observability Check
- Improved from prior state: newly added tests include explicit request inputs and response assertions for previously uncovered endpoints.
- Strong examples:
  - Password rotation contract and auth behavior (`API_tests/auth.api.spec.ts:232`).
  - Deletion semantics + post-condition list checks (`API_tests/groups.api.spec.ts:222`, `API_tests/itineraries.api.spec.ts:185`).
  - Legacy OpenAPI alias equivalence assertions (`API_tests/health.api.spec.ts:73`).
  - Deterministic enrollment lifecycle then PATCH verification (`API_tests/face.api.spec.ts:74`).
- Residual weak spots: a few report tests are still status-first before deeper shape checks, but overall contract clarity is materially improved.

## Tests Check
- `run_tests.sh` remains Docker-based -> compliant.
- Retest result from execution:
  - Unit: `Test Suites: 26 passed, 26 total`; `Tests: 330 passed, 330 total`
  - API: `Test Suites: 18 passed, 18 total`; `Tests: 256 passed, 256 total`
  - Final script verdict: `ALL PASSED`

## Test Quality & Sufficiency
- Success, failure, validation, authz, edge-case, and security paths are broadly and credibly covered.
- Over-mocking is controlled: unit layer mocks; API layer remains no-mock HTTP.
- Prior critical endpoint gaps are closed.

## End-to-End Expectations
- Backend project: FE<->BE E2E not applicable.

## Test Coverage Score (0-100)
**95/100**

## Score Rationale
- Full endpoint HTTP coverage with true no-mock API execution.
- Strong deterministic assertions added on prior blind spots.
- High pass rate across both unit/API suites in Dockerized run.
- Minor deduction for remaining directly un-isolated controller unit coverage and a small number of status-first report checks.

## Key Gaps
1. No functional coverage gaps at route-method level.
2. Remaining improvement opportunity: deepen assertions in a few status-first report scenarios.

## Confidence & Assumptions
- Confidence: **high**.
- Assumptions:
  - Endpoint set is limited to explicit route registrations in inspected files.
  - No hidden runtime-generated routes.

---

# README Audit

## README location
- Required path exists: `README.md` at repository root.

## Hard Gate Failures
- **None detected**.

## High Priority Issues
- None.

## Medium Priority Issues
- None blocking strict compliance.

## Low Priority Issues
- Optional: add a short architecture/request-flow diagram for faster onboarding; not a gate requirement.

## Gate-by-gate assessment
- Formatting: **PASS** (`README.md` clean and structured).
- Startup instructions (backend/fullstack): **PASS** (exact `docker-compose up` present at `README.md:13`).
- Access method (URL+port): **PASS** (`README.md:34-43`).
- Verification method: **PASS** (explicit curl-based health/auth/profile verification with expected responses at `README.md:58-133`).
- Environment rules (Docker-contained): **PASS** (Docker-first startup/testing; no npm/pip/apt/manual DB setup instructions).
- Demo credentials with auth roles: **PASS** (all roles and passwords listed at `README.md:51-57`).
- Project type declaration: **PASS** (`README.md:3`).

## README Verdict
**PASS**

---

# Final Verdicts
- Test Coverage Audit: **PASS**
- README Audit: **PASS**
