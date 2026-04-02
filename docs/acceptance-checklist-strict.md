# Strict Acceptance Checklist (Zero Partial Pass)

Use this checklist repeatedly until every item is `Pass`.
Allowed final statuses: `Pass` or `Not Applicable` only.
Disallowed at release gate: `Partially Pass`, `Fail`, `Unconfirmed`.

## How to Run This

- Run gates in order.
- If any gate has non-pass items, stop, fix, and restart from Gate 1.
- Record evidence for every item as `path:line` and command output reference.
- Save each cycle report to `./.tmp/delivery-acceptance-report-cycle-<n>.md`.

## Gate 1 — Security and Access Control (Stop-Ship)

- [ ] Authentication entry points enforce expected behavior (`register`, `login`, `logout`, `change-password`).
- [ ] Route-level authorization is enforced (`401` unauthenticated, `403` unauthorized).
- [ ] Object-level authorization is enforced (ownership/membership checks on ID-based resources).
- [ ] Tenant/property/group isolation is enforced for read and write paths.
- [ ] Admin-only interfaces are protected and non-admin access is denied.
- [ ] No privilege escalation paths are found in role transitions or claims handling.
- [ ] Sensitive data is masked in logs and not exposed in API responses.

Fail rule:
- Any single failure here = release blocked.

## Gate 2 — Prompt Core Feature Completeness (Stop-Ship)

- [ ] Auth/accounts features complete, including data export archive and account deletion.
- [ ] RBAC complete for all four roles and property-scoped rules.
- [ ] Group/join-code/member/required-field flows complete.
- [ ] Itinerary/checkpoint/check-in/idempotency/rollback flows complete.
- [ ] File upload/access/delete/dedup/audit flow complete.
- [ ] Notification creation, cursor pagination, and read-state flow complete.
- [ ] Reporting metrics and export constraints (PII permissions) complete.
- [ ] Import templates/validation/merge/error-receipts/retry/rollback complete.
- [ ] Face enrollment/liveness/encryption/version/deactivation/retention complete.
- [ ] Data quality checks, trace IDs, and metrics collection complete.
- [ ] Audit immutability/retention and masking requirements complete.

Fail rule:
- Any missing core prompt feature = release blocked.

## Gate 3 — Engineering Reliability (Stop-Ship)

- [ ] Project starts with documented commands and no source edits required.
- [ ] Error handling is consistent and actionable across modules.
- [ ] Input validation exists on all external boundaries.
- [ ] Transaction boundaries protect imports and itinerary edits.
- [ ] Retry logic uses bounded exponential backoff (max 3 attempts).
- [ ] Logging categories are clear and traceable (`auth`, `rbac`, `audit`, `import`, `reporting`, `security`, `system`).
- [ ] Offline-only operation has no external runtime dependency.

## Gate 4 — Test Coverage Assessment (Static Audit, Mandatory)

- [ ] Requirement checklist extracted from Prompt and constraints.
- [ ] Mapping table complete: requirement -> test case -> assertion -> judgment.
- [ ] Happy paths covered for all critical user/business journeys.
- [ ] Exception paths covered (`400/401/403/404/409`, validation, duplicates, not-found).
- [ ] Security paths covered (authn, route authz, object authz, data isolation).
- [ ] Boundary paths covered (time/date, pagination, empty sets, extremes, concurrency/idempotency).
- [ ] Transaction/rollback and retry behavior covered.
- [ ] Log/sensitive info leakage risk audited in code/tests.
- [ ] Mock/stub scope and production activation risk documented.

Pass rule:
- Overall test-audit conclusion must be `Pass` (not `Partially Pass`).

## Gate 5 — Final Readiness

- [ ] README includes exact startup, test, and verification commands.
- [ ] API spec and docs match implemented behavior.
- [ ] No forbidden artifacts for delivery (`node_modules`, `dist`, real credentials, temp exports/uploads).
- [ ] Evidence-backed acceptance report generated at `./.tmp/delivery-acceptance-report.md`.
- [ ] All issues closed or explicitly `Not Applicable` with boundary rationale.

## Retest Loop (Repeat Until Pass)

For each failed item:
1. Create a minimal fix scoped to the failed requirement.
2. Re-run targeted checks for that requirement.
3. Re-run all prior gates (security first).
4. Update cycle report and evidence links.

Exit condition:
- Two consecutive full acceptance cycles with all items `Pass`.
