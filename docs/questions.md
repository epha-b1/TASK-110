# Required Document Description: Business Logic Questions Log

This file records business-level ambiguities from the prompt and implementation decisions.
Each entry follows exactly: Question + My Understanding/Hypothesis + Solution.

## 1) Password Policy — What Counts as a Symbol?
Question: The prompt says passwords must have at least 1 number and 1 symbol. What characters qualify as a symbol?
My Understanding/Hypothesis: Any non-alphanumeric printable ASCII character qualifies: `!@#$%^&*()_+-=[]{}|;':",.<>?/~\``. Standard special character set.
Solution: Zod/regex validation: `/^(?=.*\d)(?=.*[^a-zA-Z0-9]).{10,}$/`. Applied at registration and password change.

## 2) Account Lockout — How Many Attempts and How Long?
Question: The prompt mentions account lockout but doesn't specify the threshold or duration.
My Understanding/Hypothesis: Lock after 5 consecutive failed login attempts. Lockout duration: 15 minutes. After lockout expires, failed_attempts resets on next successful login.
Solution: `users.failed_attempts` incremented on each failure. `users.locked_until` set to `now + 15 min` when threshold reached. Login checks `locked_until > now` → 423 response.

## 3) Join Code — How Is It Generated and How Long Is It Valid?
Question: The prompt says groups use a "pre-shared join code" but doesn't specify format, length, or expiry.
My Understanding/Hypothesis: Join codes are 8-character alphanumeric strings (uppercase), generated at group creation. They do not expire — they remain valid as long as the group is active. Archiving a group invalidates its join code.
Solution: `groups.join_code` generated with `crypto.randomBytes(4).toString('hex').toUpperCase()`. Unique constraint enforced. Archived groups return 404 on join attempt.

## 4) Itinerary Date/Time Format — Server-Side or Display Only?
Question: The prompt specifies MM/DD/YYYY and 12-hour time formats. Are these stored as-is or converted to ISO format internally?
My Understanding/Hypothesis: Store the client-facing values exactly as provided (`MM/DD/YYYY`, `HH:MM AM/PM`) for strict format fidelity, and also store a derived normalized datetime field for ordering/filtering safety.
Solution: Keep `meetup_date` (`varchar(10)`) + `meetup_time` (`varchar(8)`) with regex validation, and add `meetup_sort_at` (`datetime`) derived server-side from those values. API responses preserve the original prompt-required format.

## 5) Checkpoint Ordering — Can Positions Be Reordered?
Question: Checkpoints have an ordered position (1–30). Can positions be reordered after creation, or is position immutable?
My Understanding/Hypothesis: Positions can be updated via PATCH on a checkpoint. The service validates that no two checkpoints on the same item share the same position. Reordering is done by updating position values.
Solution: `PATCH /groups/:groupId/itineraries/:itemId/checkpoints/:checkpointId` accepts `{position}`. Service checks for position conflicts before saving.

## 6) File MIME Allowlist — Exact Types?
Question: The prompt says "image/document upload" with MIME-type allowlists. What exact MIME types are allowed?
My Understanding/Hypothesis: Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`. Documents: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (docx), `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (xlsx).
Solution: Allowlist defined in config. Multer middleware checks `file.mimetype` against allowlist before accepting upload. Returns 400 with code `MIME_NOT_ALLOWED` if rejected.

## 7) SHA-256 Deduplication — Scope: Per Group or Global?
Question: When a file's SHA-256 matches an existing file, is deduplication global (any user) or per-group? Global dedup with a single `group_id` FK would block the same file being uploaded to two different groups.
My Understanding/Hypothesis: Deduplication is scoped per-group (`UNIQUE(sha256, group_id)`), not global. This avoids cross-group information leakage and allows the same file content in multiple groups without a join table.
Solution: On upload, check if the same hash already exists in the same group — if so, return the existing file record. Different groups can independently store files with the same content.

## 8) Reporting — What Is the Room Availability Denominator for RevPAR?
Question: RevPAR = total revenue / available room nights. How is "available" defined — all rooms, or only non-maintenance rooms?
My Understanding/Hypothesis: Available room nights = all rooms with status `available` or `occupied` (i.e., excluding `maintenance`). A room under maintenance is not available for sale and should not inflate the denominator.
Solution: RevPAR denominator counts rooms where `status != 'maintenance'` for each day in the period, multiplied by the number of days.

## 9) PII Export Permission — How Is It Granted?
Question: The prompt says PII export requires "explicit permission grant." How is this permission managed?
My Understanding/Hypothesis: PII export is a separate permission flag on the user record (`pii_export_allowed: boolean`). Only Hotel Admin can grant this flag to other users. Analyst role can run reports but cannot export PII unless the flag is set.
Solution: `users.pii_export_allowed` boolean field. Report export endpoint checks this flag when `includePii: true` is requested. Returns 403 if flag is false.

## 10) Face Liveness — What Are the Pass Thresholds?
Question: The prompt describes liveness checks using blink timing, motion consistency, and texture/reflection heuristics. What are the pass/fail thresholds?
My Understanding/Hypothesis: Configurable thresholds with sensible defaults: blink timing 100–500ms (natural blink range), motion consistency score ≥ 0.6, texture/reflection score ≥ 0.5. All three must pass for a capture to be accepted.
Solution: Thresholds defined in environment config. Liveness service evaluates each metric and returns a per-metric pass/fail plus an overall result. Any single failure rejects the capture.

## 11) Face Template — What Format Is the Encrypted Template?
Question: The prompt says "only encrypted face templates are stored." What is the template format before encryption?
My Understanding/Hypothesis: For this implementation, the face template is a JSON object containing the liveness metadata and capture scores for all three angles. It is serialized to JSON, then encrypted with AES-256-GCM. The raw image is not part of the template.
Solution: Template = `JSON.stringify({angles: {left: {...}, front: {...}, right: {...}}, enrolledAt: ...})`. Encrypted with AES-256-GCM using key from env. Stored as base64 string in `face_enrollments.template_path` (or as a file in `face-templates/`).

## 12) Notification Cursor — What Is the Cursor Format?
Question: The prompt says notifications are queryable by cursor. What is the cursor — a timestamp, an ID, or an offset?
My Understanding/Hypothesis: Cursor should be monotonic and stable under concurrent inserts; UUID lexical comparison is not reliable.
Solution: Use opaque cursor encoding `{created_at,id}` (base64 JSON). Query with `(created_at > ts) OR (created_at = ts AND id > id)` ordered by `created_at ASC, id ASC`. Endpoint stays `GET /notifications?groupId=&after=<cursor>&limit=50`, returning `nextCursor` with the same format.

## 13) Data Export Archive — What Format?
Question: The prompt says account data export packages profile, activity logs, and uploaded files into a "locally generated archive." What format?
My Understanding/Hypothesis: ZIP archive containing: `profile.json` (user profile), `activity_logs.json` (all activity log entries), `files/` directory with copies of uploaded files. Archive is stored in `exports/` directory and served via a time-limited local URL.
Solution: Node.js `archiver` library creates the ZIP. Archive expires and is deleted after 24 hours by the cleanup job. Download URL is a local API endpoint: `GET /exports/:archiveId`.

## 14) Staffing Import — What Columns Are Required?
Question: The prompt says strict column validation for staffing and evaluation imports. What are the required columns?
My Understanding/Hypothesis: - Staffing: `employee_id` (required), `effective_date` (required, YYYY-MM-DD), `position` (required), `department` (optional), `property_id` (optional), `signed_off_by` (optional) - Evaluation: `employee_id` (required), `effective_date` (required), `score` (required, decimal), `result` (required), `rewards` (optional), `penalties` (optional), `signed_off_by` (optional)
Solution: Column schema defined per dataset type. Import service validates presence and type of each column. Missing required columns → batch-level error (not row-level). Wrong type → row-level error.

## 15) Audit Log Retention — 1 Year — Hard Delete or Archive?
Question: The prompt says audit logs are immutable for 1 year. Does this mean rows are never deleted, or can they be archived after 1 year?
My Understanding/Hypothesis: Audit log rows are never deleted from the primary `audit_logs` table within the 1-year retention window. The app DB role has INSERT-only permission on `audit_logs`. After 1 year, rows may be archived to a cold table but are not hard-deleted from the system.
Solution: MySQL role for the app has INSERT-only on `audit_logs`. A daily job checks for rows older than 1 year and moves them to `audit_logs_archive`. The primary table retains all rows within the 1-year window.

## 16) Manager Property Scope — Can a Manager Be Assigned to Multiple Properties?
Question: The prompt says managers have "property-scoped access." Can a manager be assigned to more than one property?
My Understanding/Hypothesis: A manager is assigned to exactly one property (stored as `users.property_id`). If multi-property manager access is needed, it would require a separate `user_properties` join table, but the prompt implies single-property scope.
Solution: `users.property_id` is a single FK. All manager queries filter by this property_id. Hotel Admin has no property filter.

## 17) Idempotency on Itinerary Updates — What Is the Scope?
Question: The prompt says idempotency keys prevent duplicate updates during retries. Is the key scoped per item, per user, or globally?
My Understanding/Hypothesis: Idempotency keys are scoped by actor + operation + target resource and retained for 24 hours.
Solution: Use a dedicated `idempotency_keys` table (`key`, `actor_id`, `operation`, `resource_scope`, `request_hash`, `response_snapshot`, `expires_at`). On duplicate key with same request hash, return stored response; mismatched hash returns 409. The `idempotency_key` column on `itinerary_items` is retained for create-only dedup (UNIQUE constraint catches duplicate inserts), while the `idempotency_keys` table handles update idempotency with response replay.

## 18) Registration Default Role — What Role Does a New User Get?
Question: The prompt defines four roles (hotel_admin, manager, analyst, member) but doesn't specify what role a self-registered user receives.
My Understanding/Hypothesis: New users register with the `member` role by default. Only a `hotel_admin` can promote users to other roles. The first user in the system is seeded as `hotel_admin` — self-registration never grants admin/manager/analyst.
Solution: `POST /auth/register` always sets `role = 'member'`. Add `PATCH /accounts/:userId/role` (hotel_admin only) for role assignment. Seeder creates the initial admin user.

## 19) Rate Limiting — What Are the Limits?
Question: The architecture mentions rate-limit middleware but the prompt doesn't specify thresholds.
My Understanding/Hypothesis: Per-IP rate limit: 100 requests/minute for general endpoints, 10 requests/minute for auth endpoints (login/register) to mitigate brute force. Per-user rate limit: 200 requests/minute.
Solution: `rate-limit.middleware.ts` using `express-rate-limit` with separate limiters for auth and general routes. Returns 429 with `Retry-After` header when exceeded.

## 20) Account Deletion — What Happens to Group Data?
Question: When a user soft-deletes their account, what happens to groups they own, their group memberships, files they uploaded, and itinerary items they created?
My Understanding/Hypothesis: Soft-deleted users are removed from all groups. If the deleted user is a group owner, ownership transfers to the next admin, or if none exists, the group is archived. Files and itinerary items created by the user remain (attributed to a "deleted user" placeholder). Face enrollments are deactivated.
Solution: Account deletion triggers a cascade: deactivate face enrollments, remove group memberships, transfer or archive owned groups, and log the full operation in audit_logs. The user row retains `deleted_at` for data retention.
