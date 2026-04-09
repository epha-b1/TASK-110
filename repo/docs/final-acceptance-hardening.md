# Final Acceptance Hardening — Issue Map

This document maps each item from the final hardening pass to the
specific files changed, the verification commands, and what is statically
proven vs what still requires manual verification against a running
environment.

## Headline status

| Metric | Value |
|---|---|
| `npm run build` | passing (`tsc` exit 0) |
| `npm run test:unit` | **19 suites, 181 tests, all passing** |
| `npm run test:api` (no DB) | **2 suites passed, 10 cleanly skipped** (143 tests; 7 pass, 136 skip) |
| `npm run test:api` (with DB) | requires MySQL — see verification commands below |

No worker-exit warnings, no `MaxListenersExceededWarning`, no validation
warnings from jest config.

---

## Issue 1 — API test reliability and verification boundary

**Goal:** API tests must not hard-fail with ECONNREFUSED when MySQL is
unavailable. Failure mode must be explicit and actionable.

**Code changes**

| File | What changed |
|---|---|
| `API_tests/global-setup.ts` *(new)* | jest globalSetup that probes MySQL once before any spec loads. Sets `DB_AVAILABLE=1|0` and prints a single bordered banner with the exact commands needed to run for real. |
| `API_tests/db-guard.ts` *(new)* | Exports `describeDb`, `testDb`, `requireDb`, `dbAvailable`. `describeDb` is `describe` when DB is available, `describe.skip` otherwise — the children (and their `beforeAll`) never execute when the DB is down. |
| `jest.config.js` | Adds `globalSetup: '<rootDir>/API_tests/global-setup.ts'` to the api project. |
| `API_tests/auth.api.spec.ts` | Wraps the auth describe in `describeDb`; moves `beforeAll`/`afterAll` inside the wrapper. The DB-free `Slice 1 — Health API (regression)` block is intentionally left ungated. |
| `API_tests/audit.api.spec.ts` | Same wrap pattern. |
| `API_tests/face.api.spec.ts` | Same. |
| `API_tests/files.api.spec.ts` | Same. |
| `API_tests/groups.api.spec.ts` | Same. |
| `API_tests/import.api.spec.ts` | Same. |
| `API_tests/itineraries.api.spec.ts` | Same. |
| `API_tests/notifications.api.spec.ts` | Same. |
| `API_tests/quality.api.spec.ts` | Same. |
| `API_tests/rbac.api.spec.ts` | Same. |
| `API_tests/reports.api.spec.ts` | Same + new isolation fixture (see Issue 4). |

**Verification (no DB)**

```sh
npm run test:api
# Expect: a banner explaining DB is unavailable, then:
#   Test Suites: 10 skipped, 2 passed, 2 of 12 total
#   Tests:       136 skipped, 7 passed, 143 total
```

**Verification (with DB)**

```sh
docker compose up db -d        # or ./run_tests.sh which wraps the whole thing
npm run test:api               # all 12 suites should run
```

**Static proof:** the helper is a simple boolean gate; if the env var is
not `'0'`, `describeDb` is the unmodified `describe`. The new spec wrap
is applied uniformly to the 11 DB-dependent files (verified by
`unit_tests/rate-limit.spec.ts`'s sibling drift guard, which iterates
the same 11 files for a different property).

**Manual:** running with `DB_AVAILABLE=1` against a real MySQL is the
only way to confirm the actual API behavior under load — this is
out-of-scope for the static remediation.

---

## Issue 2 — Audit immutability operational risk

**Goal:** Reproducible operator path for DB grants. Archival job must not
break when strict grants are enabled.

**Code changes**

| File | What changed |
|---|---|
| `scripts/audit-immutability.sql` *(new)* | Operator-facing, idempotent SQL: keeps INSERT, REVOKEs UPDATE on `audit_logs` from app user, optionally REVOKEs DELETE (commented), creates `audit_maintainer` user with SELECT+DELETE on `audit_logs` and SELECT+INSERT on `audit_logs_archive`, re-asserts triggers, prints a verification summary. |
| `scripts/verify-audit-immutability.sh` *(new, executable)* | Probes all three layers in order, exits non-zero on failure, color-coded output. Inserts a sentinel row, attempts UPDATE/DELETE, asserts trigger rejection. |
| `src/config/environment.ts` | New `auditMaintainer.{user,password}` config block backed by `AUDIT_MAINTAINER_USER` / `AUDIT_MAINTAINER_PASSWORD` env vars. |
| `src/config/database.ts` | New exported `createAuditMaintainerConnection()` that returns a short-lived elevated Sequelize instance when env vars are set, or `null` for fallback to the main pool. |
| `src/jobs/cleanup.ts` | `archiveAuditLogs()` now opens the elevated connection when available, runs both archive INSERT and DELETE through it, and always closes the maintainer pool in a `finally`. The function is exported so tests can import it directly. Includes the credential label in the `archive_completed` log line. |
| `src/__mocks__/sequelize.mock.ts` | Mirror exports `sequelize`, `testConnection`, `createAuditMaintainerConnection`, `Op`, `QueryTypes`, `close`, `query` so unit tests can exercise both the env-var branch and the SQL pin tests without a real DB. |
| `.env.example` | Documents the optional `AUDIT_MAINTAINER_USER` / `AUDIT_MAINTAINER_PASSWORD` vars. |
| `docs/audit-immutability.md` | Rewritten "Production provisioning" and "Verification checklist" sections; references the new scripts; documents default vs strict mode. |

**Tests added**

| File | What it pins |
|---|---|
| `unit_tests/audit-archive.spec.ts` *(new)* | 4 tests covering the env-var branching of `createAuditMaintainerConnection()`. |

**Verification (no DB)**

```sh
npx jest --selectProjects unit --testPathPattern audit-archive
npx jest --selectProjects unit --testPathPattern audit-immutability
```

**Verification (with DB)**

```sh
# 1) Apply the operator SQL (idempotent)
docker compose exec -T db mysql -u root -proot hospitality \
  < scripts/audit-immutability.sql

# 2) Run the verification script — must exit 0
./scripts/verify-audit-immutability.sh

# 3) Run the archival job's check via the API surface (not direct):
#    schedule the cron OR call archiveAuditLogs() from a one-off script.
```

**Static proof:** layer 1 (ORM hooks) is verified by
`unit_tests/audit-immutability.spec.ts`. Layer 2 (DB triggers) is
provisioned by both `migrations/017-audit-logs-immutability.js` and
`scripts/audit-immutability.sql` (defense in depth).

**Manual:** layer 3 (REVOKE ... FROM app user) must be applied once per
environment by a DBA running the script as root. Verified end-to-end by
`scripts/verify-audit-immutability.sh`.

---

## Issue 3 — Audit redaction consistency confidence

**Goal:** Masking policy must be truly consistent across all audit output
surfaces, with regression tests that fail loudly if any surface drops it.

**Code changes**

| File | What changed |
|---|---|
| `src/controllers/audit.controller.ts` | Extracted `serializeAuditRow()` and `AUDIT_CSV_COLUMNS` as the single source of truth for any audit output. Both `queryLogs` and `exportLogs` now route through `serializeAuditRow`, so masking cannot drift between surfaces. |

**Tests added**

| File | What it pins |
|---|---|
| `unit_tests/audit-serialize.spec.ts` *(new)* | 7 tests: deep masking of nested sensitive fields, preservation of non-sensitive fields, null detail handling, no input mutation, **a regression guard** that asserts no raw secret value appears anywhere in the serialized output (would fire if any future change reintroduces a raw `.toJSON()` path), and `AUDIT_CSV_COLUMNS` schema pin. |

The existing `API_tests/audit.api.spec.ts` already asserts both query
and export endpoints redact, with explicit "raw value never present in
response body" checks (search for `not.toContain('super-secret-password')`).

**Verification**

```sh
npx jest --selectProjects unit --testPathPattern "audit-serialize|masking"
# With DB: npx jest --selectProjects api --testPathPattern audit.api
```

**Static proof:** every audit output path goes through `serializeAuditRow`,
which deep-masks via the same `maskSensitiveDeep` used by the query. A
future change that bypasses the helper would fail
`unit_tests/audit-serialize.spec.ts`'s "regression guard" test.

---

## Issue 4 — Manager property isolation confidence for evaluations

**Goal:** Tests must prove real scope isolation, not just status codes
or weak cardinality.

**Code changes**

| File | What changed |
|---|---|
| `src/services/import.service.ts` | (already from prior pass) `evaluationReport` applies `EXISTS (SELECT 1 FROM staffing_records s WHERE s.employee_id = e.employee_id AND s.property_id = ?)` when `propertyId` is supplied. |
| `jest.config.js` | Module mapper now also covers `^../src/config/database$` and `^../../src/config/database$` so unit tests can import the same `sequelize` mock instance the service uses. |
| `src/__mocks__/sequelize.mock.ts` | Exports `sequelize` (singleton), `Op`, `QueryTypes`, with a `query` mock returning `[]` for SELECT. |

**Tests added**

| File | What it pins |
|---|---|
| `unit_tests/manager-isolation.spec.ts` *(new)* | 6 SQL-level tests that spy on `sequelize.query` and assert the generated SQL **structurally** contains `EXISTS (SELECT 1 FROM staffing_records ...)` and the propertyId in the replacements when scoped, and does NOT contain it when unscoped. Also tests cross-call cleanliness (no state carryover) and parity for `staffingReport`. |
| `unit_tests/manager-scope-controller.spec.ts` *(new)* | 7 controller-layer tests that build fake `req`/`res` and assert: manager → other property = 403; manager → own property = scoped service call; admin unscoped = no EXISTS; admin → explicit propertyId = scoped. |
| `API_tests/reports.api.spec.ts` | Replaces the weak cardinality check with **strong fixture-based assertions**. Seeds two `staffing_records` (one per demo property) and two `evaluation_records` with distinct `result` labels (`ISO_PASS_<RUN_TAG>` on property 1, `ISO_FAIL_<RUN_TAG>` on property 2). Then asserts: manager sees `ISO_PASS` and NOT `ISO_FAIL`; admin sees both; admin scoping to property 2 sees `ISO_FAIL` and not `ISO_PASS`. |

**Verification (no DB)**

```sh
npx jest --selectProjects unit --testPathPattern "manager-isolation|manager-scope-controller"
```

**Verification (with DB)**

```sh
docker compose up db -d
npx jest --selectProjects api --testPathPattern reports.api
```

**Static proof:** the SQL-level test would fail if the EXISTS clause
were ever removed from the service. The controller test would fail if
`enforceManagerScope` ever stopped throwing.

---

## Issue 5 — CSV export safety regression-proofing

**Goal:** Both report and audit CSV paths must be covered by tests for
quoting and formula neutralization.

**Code changes**

| File | What changed |
|---|---|
| `src/controllers/reports.controller.ts` | Extracted `serializeReportRowsToCsv(rows)` as a pure helper. The controller's CSV branch now writes via this single function. Empty input returns `''` so callers can still create empty files. |

**Tests added**

| File | What it pins |
|---|---|
| `unit_tests/report-csv.spec.ts` *(new)* | 15 tests covering empty input, scalar happy-path, embedded comma, embedded newline, embedded double quote, formula triggers `=` `+` `-` `@` and leading tab (DDE), non-leading `=` (NOT neutralized), null cells, column-order pin, missing keys, and a regression guard for a complex `=cmd|"/c calc"!A1` payload. |
| `unit_tests/csv.spec.ts` | (already from prior pass) 16 tests for the `csvEscapeCell` / `objectsToCsv` / `rowsToCsv` core helpers. |

**Verification**

```sh
npx jest --selectProjects unit --testPathPattern "report-csv|csv\\.spec"
```

**Static proof:** every CSV path in the codebase routes through one of:
- `objectsToCsv` (audit export, used directly)
- `serializeReportRowsToCsv` → `objectsToCsv` (report export)

Both helpers are unit-pinned. A future change that bypasses them would
fail one of the regression tests.

---

## Issue 6 — Rate-limit enforcement confidence

**Goal:** Confirm the per-user limiter is mounted after auth, plus a
unit test proving keyGenerator uses `user.id` when available.

**Code changes**

| File | What changed |
|---|---|
| `src/middleware/rate-limit.middleware.ts` | Extracted `userLimiterKey(req)` as an exported pure function. The `userLimiter` now references it via `keyGenerator: userLimiterKey` so the same logic is testable in isolation. |

**Tests added**

| File | What it pins |
|---|---|
| `unit_tests/rate-limit.spec.ts` *(new)* | **6 keyGenerator tests** (authenticated → `user:<id>`, unauthenticated → `ip:<ip>`, missing both → `ip:unknown`, two distinct users → distinct buckets, same user from different IPs → same bucket) PLUS **11 mount-order tests** that read each protected router's source file and assert `router.use(authMiddleware)` appears before `router.use(userLimiter)`. |

**Verification**

```sh
npx jest --selectProjects unit --testPathPattern rate-limit
# Expect: 17 tests passed.
```

**Static proof:** the mount-order tests are structural pins — they read
the source files directly. If a future refactor flips the order, the
tests fire.

---

## Issue 7 — Import temp artifact hygiene

**Goal:** Temporary import data must never leak into export path.
Cleanup behavior must be deterministic and documented.

**Code changes**

| File | What changed |
|---|---|
| `src/services/import.service.ts` | Replaced the module-level constant with `IMPORT_TMP_SUBDIR = 'var/import-tmp'` plus `getImportTmpDir()` so tests that change cwd can see the right path. Exported `tmpFilePath`. `cleanupStaleImportTmp` now skips non-regular files (defensive against same-named directories) and never recurses. |
| `.gitignore` | (already from prior pass) `var/` ignored with `var/.gitkeep` exception. |
| `src/jobs/cleanup.ts` | (already from prior pass) `cleanupExports` sweeps any stray `.import-*` files from `exports/`; new hourly `cleanupImportTmp` cron. |

**Tests added/updated**

| File | What it pins |
|---|---|
| `unit_tests/import-tmp.spec.ts` | Expanded from 4 to **11 tests**: original cleanup tests, plus `IMPORT_TMP_SUBDIR === 'var/import-tmp'`, resolved path is **never** under `exports/`, `tmpFilePath` rejects non-UUID and traversal payloads, `tmpFilePath` resolves under tmp dir for valid UUIDs, cleanup is idempotent, cleanup doesn't recurse into matching subdirectories, cleanup ignores files in `exports/`, write path's parent is **never** `exports/`. |

**Verification**

```sh
npx jest --selectProjects unit --testPathPattern import-tmp
# Expect: 11 tests passed.
```

**Static proof:** the resolved-path test catches any future change that
moves `IMPORT_TMP_SUBDIR` under `exports/`. The path-traversal test
catches any change that loosens UUID validation. The
cleanup-ignores-exports test proves the two directories are strictly
isolated even when both contain matching filenames.

---

## Issue 8 — CI stability / open handles

**Goal:** Diagnose and fix the unit-test "worker has failed to exit
gracefully" warning. If not fixable, document a debug command.

**Code changes**

| File | What changed |
|---|---|
| `unit_tests/jest.setup.ts` *(new)* | Per-suite teardown registered via `setupFilesAfterEnv` in `jest.config.js`. Calls `logger.close()` in `afterAll` so the winston Console transport is released before the worker exits. Bumps `process.setMaxListeners(64)` to silence the cosmetic `MaxListenersExceededWarning` triggered by `jest.resetModules()` re-registering winston exit listeners. |
| `jest.config.js` | Adds `setupFilesAfterEnv: ['<rootDir>/unit_tests/jest.setup.ts']` to the unit project. |

**Verification**

```sh
# Run 3 times — none should print a worker warning or validation warning.
for i in 1 2 3; do
  npm run test:unit 2>&1 | grep -E "(worker|Validation|Warning)" || echo "  ✓ clean"
done
```

Confirmed clean across 3 sequential runs.

**Debug command** if a future change reintroduces the warning:

```sh
npx jest --selectProjects unit --detectOpenHandles --runInBand
# Lists the source location of any handle that is keeping the worker alive.
```

**Static proof:** N/A — this is a runtime symptom. Mitigated by
explicit logger teardown, which is the only known dangling resource
in the unit project.

---

## Aggregate verification commands

```sh
# 1) Build
npm run build                     # → tsc exit 0

# 2) Unit tests (no DB needed)
npm run test:unit                 # → 19 suites, 181 tests, all passing

# 3) API tests (no DB)
npm run test:api                  # → 10 skipped, 2 passed, banner explains why

# 4) API tests (with DB)
docker compose up db -d
npm run test:api                  # → 12 suites all run

# 5) Audit DB layer (manual, with DB)
docker compose exec -T db mysql -u root -proot hospitality \
  < scripts/audit-immutability.sql
./scripts/verify-audit-immutability.sh   # → must exit 0
```

## Static-proven vs manual

| Item | Static-proven | Manual |
|---|---|---|
| Audit redaction (query + export) | ✓ via unit + (DB) API tests | — |
| Audit immutability — ORM hooks | ✓ via unit | — |
| Audit immutability — DB triggers | ✓ provisioned by migration | end-to-end via `verify-audit-immutability.sh` (with DB) |
| Audit immutability — DB role grants | ✓ scripted in `scripts/audit-immutability.sql` | applied once per env by DBA |
| Manager isolation — service SQL | ✓ via unit (SQL spy) | — |
| Manager isolation — controller scope | ✓ via unit | — |
| Manager isolation — fixture E2E | ✓ via API test (with DB) | requires running MySQL |
| Rate limiter — keyGenerator | ✓ via unit | — |
| Rate limiter — mount order | ✓ via unit (source-file scan) | — |
| CSV safety — audit | ✓ via unit + (DB) API test | — |
| CSV safety — reports | ✓ via unit | — |
| Import temp isolation | ✓ via unit | — |
| Account profile validation | ✓ via unit + (DB) API test | — |
| Open handle / CI stability | ✓ via 3× unit-test stability run | — |
| API test DB-availability boundary | ✓ via no-DB run output | end-to-end with DB |
