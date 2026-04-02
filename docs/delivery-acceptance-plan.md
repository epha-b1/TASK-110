# Delivery Acceptance / Project Architecture Review Plan

This plan aligns project acceptance with the stated scoring criteria and hard rules.

## Execution Principles

- Evaluate item-by-item against acceptance criteria only.
- Prioritize security verification (authn/authz/object authorization/data isolation) above style concerns.
- Provide traceable evidence for every key conclusion (`path:line`).
- Prefer runnable verification; if blocked by environment limits, document command + verification boundary.
- Record final report in `./.tmp/delivery-acceptance-report.md`.
- Target quality bar is strict acceptance: no `Partially Pass` at release.
- Repeat acceptance cycles until results are stable across consecutive runs.

## Major Acceptance Checklist (Plan)

- [ ] 1. Mandatory Thresholds (runnability + Prompt-theme alignment)
- [ ] 2. Delivery Completeness (all core Prompt requirements + real deliverable form)
- [ ] 3. Engineering and Architecture Quality (structure, modularity, maintainability)
- [ ] 4. Engineering Details and Professionalism (validation, error handling, logs, interfaces)
- [ ] 5. Prompt Understanding and Fitness (business goal fidelity, constraints respected)
- [ ] 6. Test Coverage Assessment (Static Audit) + risk boundary conclusion
- [ ] 7. Final zero-partial-pass gate (all critical items fully pass)

Strict mode reference checklist:
- `docs/acceptance-checklist-strict.md`

## Required Verification Content Per Major Item

For each sub-item:
- Conclusion: `Pass` / `Partially Pass` / `Fail` / `Not Applicable` / `Unconfirmed`
- Reason: benchmark clause + engineering basis
- Evidence: implementation and docs `path:line`
- Verification: command/steps + expected result

For any `Not Applicable`:
- State why it does not apply and the judgment boundary.

## Security Priority Verification (Mandatory)

Must explicitly verify:
- Authentication entry points (registration/login/token handling/logout/password change)
- Route-level authorization (role checks and protected endpoints)
- Object-level authorization (resource ownership/membership checks)
- Data isolation (group/property/tenant boundaries)
- Admin/debug interface protections

Report each issue with:
- Priority (`Blocking` / `High` / `Medium` / `Low`)
- Impact
- Evidence (`path:line`)
- Minimal reproducible path
- Minimal actionable fix suggestion

## Static Test Coverage Assessment (Mandatory Section)

The report must include a separate section named `Test Coverage Assessment (Static Audit)` with:

- Test overview: unit/API/integration test existence, framework, entry command, README executability notes.
- Requirement mapping table:
  - `Requirement/Risk Point`
  - `Corresponding Test Case (file:line)`
  - `Key Assertion/Fixture/Mock (file:line)`
  - `Coverage Judgment`
  - `Gap`
  - `Minimal Test Addition Suggestion`
- Coverage judgment for:
  - Happy paths
  - Exception paths (400/401/403/404/409/idempotency)
  - Security paths (authn/authz/object authz/data isolation)
  - Boundaries (pagination/filtering/empty/extreme/time/concurrency/transactions)
  - Logs and sensitive info leakage risk
- Mock/stub notes:
  - Scope, activation conditions, accidental-production risk
- Overall conclusion (must be one): `Pass` / `Partially Pass` / `Fail` / `Unconfirmed`
- Explicit judgment boundary: what severe defects could still pass current tests

## Reproducible Command Set (No Docker Execution Here)

Use these commands during acceptance as applicable (without starting Docker in this environment):

```bash
# Documentation and project structure check
ls
ls docs

# Node/TypeScript project checks
npm run lint
npm run build
npm test

# Optional targeted tests
npm run test:unit
npm run test:integration
```

If command execution is blocked, report:
- exact error
- likely environmental cause
- what remains statically confirmable from code/docs

## Final Output Requirements

- Include prioritized issue list (`Blocking` to `Low`) with impact and evidence.
- Separate conclusions for:
  - Unit test audit
  - API/integration test audit
  - Log classification/sensitive info audit
- Do not report sandbox permission limits as project defects.
- Do not report compliant payment mocks as defects.

## Release Gate (Strict)

Release can proceed only if all conditions hold:
- Every mandatory item is `Pass`.
- `Partially Pass` count is `0`.
- `Fail` count is `0`.
- `Unconfirmed` count is `0` (except explicitly environment-blocked items with reproducible command + boundary, then release is deferred).
- Security section has zero open issues in `Blocking` and `High`.
- Static test coverage conclusion is `Pass`.

Recommended stabilization rule:
- Require two consecutive full acceptance runs with identical `Pass` outcomes before final sign-off.
