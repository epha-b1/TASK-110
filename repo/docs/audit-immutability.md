# Audit Log Immutability — Enforcement & Verification

The product requires audit logs to be **immutable for at least 1 year**.
This document describes how the requirement is enforced in code, how to
provision the production database for it, and how an operator or
reviewer can verify each layer.

## Enforcement layers

| # | Layer | What it blocks | Where it lives |
|---|-------|----------------|-----------------|
| 1 | Sequelize ORM hooks | Any UPDATE/DELETE/SAVE through the ORM (instance + bulk) | `src/models/audit.model.ts` |
| 2 | DB triggers | Any UPDATE at any age, any DELETE of rows < 1 year old, regardless of credential | `migrations/017-audit-logs-immutability.js` |
| 3 | DB role grants (production) | Statement-level UPDATE/DELETE denied at permission level | `scripts/audit-immutability.sql` (manual, one-time) |

Layers 1 and 2 are applied automatically by `npm run migrate`. Layer 3
is a production-posture choice:

- **Default mode** — layers 1 + 2 are sufficient. The DB trigger
  rejects any DELETE of rows newer than 1 year regardless of which user
  issues the statement, which satisfies the "immutable for 1 year"
  requirement. The archival job runs under the main application
  credential.
- **Strict mode** — additionally REVOKE UPDATE (and optionally DELETE)
  from the application user on `audit_logs`. The archival job then
  authenticates as a dedicated `audit_maintainer` user via the
  `AUDIT_MAINTAINER_USER` / `AUDIT_MAINTAINER_PASSWORD` env vars (see
  `src/config/database.ts::createAuditMaintainerConnection`).

## Operator path (reproducible, idempotent)

Production provisioning is scripted in
[`scripts/audit-immutability.sql`](../scripts/audit-immutability.sql).
Apply it once per environment as a privileged MySQL user:

```bash
# Inside the docker compose stack
docker compose exec -T db mysql -u root -proot hospitality \
  < scripts/audit-immutability.sql

# Against a direct MySQL host
mysql -u root -p -D hospitality < scripts/audit-immutability.sql
```

The script:

1. Keeps INSERT on `audit_logs` for the app user.
2. REVOKEs UPDATE on `audit_logs` from the app user.
3. Optionally REVOKEs DELETE — the line is commented out by default.
   Uncomment it only if you have set `AUDIT_MAINTAINER_USER` /
   `AUDIT_MAINTAINER_PASSWORD` in the API environment.
4. Creates the `audit_maintainer` user with SELECT, DELETE on
   `audit_logs` and SELECT, INSERT on `audit_logs_archive`.
5. Re-asserts the two immutability triggers (defence against drift).

The script is idempotent — reruns are safe.

## Verification (reproducible)

`scripts/verify-audit-immutability.sh` runs a deterministic, read-only
probe of all three layers. It inserts a sentinel row, attempts UPDATE
and DELETE (both should be rejected), then emits a colored pass/fail
per layer. Exits non-zero on any failure.

```bash
./scripts/verify-audit-immutability.sh          # docker compose default
MYSQL_CLI="mysql -h db -u root" ./scripts/verify-audit-immutability.sh
```

Layer 1 (ORM hooks) is verified by `unit_tests/audit-immutability.spec.ts`
and does not require a running DB.

## Verification checklist (manual)

The scripted verification above covers the automated path. Below is
the manual fallback if you need to check each layer individually.

### 1. Triggers are installed

```sql
SHOW TRIGGERS FROM hospitality LIKE 'audit_logs';
-- Expect: audit_logs_block_update, audit_logs_block_delete
```

### 2. UPDATE is rejected at any age

```sql
-- As the app user
UPDATE audit_logs SET action = 'tampered' WHERE id = '<some-id>';
-- Expect: ERROR 1644 (45000): audit_logs is append-only; UPDATE is prohibited
```

### 3. DELETE of a recent row is rejected

```sql
-- As the app user
DELETE FROM audit_logs WHERE id = '<recent-id>';
-- Expect: ERROR 1644 (45000): audit_logs is immutable for 1 year; cannot DELETE rows newer than retention cutoff
```

### 4. DELETE of a row older than 1 year succeeds (retention path)

```sql
-- This is how the archive job retains the required window
DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL 1 YEAR LIMIT 1;
-- Expect: Query OK
```

### 5. App-level enforcement (no DB required)

The unit test `unit_tests/audit-immutability.spec.ts` calls the ORM
hooks directly and asserts that every mutation path throws. Run with:

```sh
npm run test -- --selectProjects unit --testPathPattern audit-immutability
```

### 6. API-level enforcement

`API_tests/audit.api.spec.ts` includes tests that:

- Insert an audit record with sensitive fields nested inside `detail`
- Assert the query view masks them
- Assert the CSV export masks them
- Assert that attempting to update/delete an audit log via the model
  throws with the `AUDIT_IMMUTABLE` code

Run with:

```sh
./run_tests.sh         # full suite in Docker
# or
npm run test -- --selectProjects api --testPathPattern audit
```

## Archival job behavior under strict mode

The retention job in `src/jobs/cleanup.ts::archiveAuditLogs()` checks
`AUDIT_MAINTAINER_USER` / `AUDIT_MAINTAINER_PASSWORD` at run time and
opens a short-lived second Sequelize pool under that credential. If the
env vars are unset, it falls back to the main app pool — which works
because the DB trigger's age-based DELETE guard is the actual retention
gate.

Log output includes the credential label so operators can confirm
which mode is active:

```json
{"message":"Audit log archive check completed","cutoff":"2025-04-09T...","credential":"audit_maintainer"}
```

## Residual risks

- The DB triggers rely on the MySQL server clock for the 1-year cutoff.
  Clock skew on the DB host could allow premature deletion up to the
  skew interval. Run NTP on the DB host.
- A DBA with global privileges can drop the triggers. Restrict the
  `SUPER` / `TRIGGER` privileges to the dedicated DBA role only.
- Backups are the ultimate immutability guarantee — ensure nightly
  logical backups of `audit_logs` are taken and stored off-host.
