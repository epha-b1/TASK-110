
# Questions and Clarifications — Hospitality Operations Intelligence

---

## 1. Password Policy — What Counts as a Symbol?

**Question:** The prompt says passwords must have at least 1 number and 1 symbol. What characters qualify as a symbol?

**Assumption:** Any non-alphanumeric printable ASCII character qualifies: `!@#$%^&*()_+-=[]{}|;':",.<>?/~\``. Standard special character set.

**Solution:** Zod/regex validation: `/^(?=.*\d)(?=.*[^a-zA-Z0-9]).{10,}$/`. Applied at registration and password change.

---

## 2. Account Lockout — How Many Attempts and How Long?

**Question:** The prompt mentions account lockout but doesn't specify the threshold or duration.

**Assumption:** Lock after 5 consecutive failed login attempts. Lockout duration: 15 minutes. After lockout expires, failed_attempts resets on next successful login.

**Solution:** `users.failed_attempts` incremented on each failure. `users.locked_until` set to `now + 15 min` when threshold reached. Login checks `locked_until > now` → 423 response.

---

## 3. Join Code — How Is It Generated and How Long Is It Valid?

**Question:** The prompt says groups use a "pre-shared join code" but doesn't specify format, length, or expiry.

**Assumption:** Join codes are 8-character alphanumeric strings (uppercase), generated at group creation. They do not expire — they remain valid as long as the group is active. Archiving a group invalidates its join code.

**Solution:** `groups.join_code` generated with `crypto.randomBytes(4).toString('hex').toUpperCase()`. Unique constraint enforced. Archived groups return 404 on join attempt.

---

## 4. Itinerary Date/Time Format — Server-Side or Display Only?

**Question:** The prompt specifies MM/DD/YYYY and 12-hour time formats. Are these stored as-is or converted to ISO format internally?

**Assumption:** Store the client-facing values exactly as provided (`MM/DD/YYYY`, `HH:MM AM/PM`) for strict format fidelity, and also store a derived normalized datetime field for ordering/filtering safety.

**Solution:** Keep `meetup_date` (`varchar(10)`) + `meetup_time` (`varchar(8)`) with regex validation, and add `meetup_sort_at` (`datetime`) derived server-side from those values. API responses preserve the original prompt-required format.

---

## 5. Checkpoint Ordering — Can Positions Be Reordered?

**Question:** Checkpoints have an ordered position (1–30). Can positions be reordered after creation, or is position immutable?

**Assumption:** Positions can be updated via PATCH on a checkpoint. The service validates that no two checkpoints on the same item share the same position. Reordering is done by updating position values.

**Solution:** `PATCH /groups/:groupId/itineraries/:itemId/checkpoints/:checkpointId` accepts `{position}`. Service checks for position conflicts before saving.

---

## 6. File MIME Allowlist — Exact Types?

**Question:** The prompt says "image/document upload" with MIME-type allowlists. What exact MIME types are allowed?

**Assumption:** Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`. Documents: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (docx), `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (xlsx).

**Solution:** Allowlist defined in config. Multer middleware checks `file.mimetype` against allowlist before accepting upload. Returns 400 with code `MIME_NOT_ALLOWED` if rejected.

---

## 7. SHA-256 Deduplication — Scope: Per User or Global?

**Question:** When a file's SHA-256 matches an existing file, is deduplication global (any user) or per-group?

**Assumption:** Deduplication is global for storage efficiency, but API behavior must avoid cross-group information leakage.

**Solution:** `files.sha256` has a unique index. On hash match, create/ensure group association and return a generic success payload that does not disclose whether bytes already existed in another group. Access remains enforced by group membership checks.

---

## 8. Reporting — What Is the Room Availability Denominator for RevPAR?

**Question:** RevPAR = total revenue / available room nights. How is "available" defined — all rooms, or only non-maintenance rooms?

**Assumption:** Available room nights = all rooms with status `available` or `occupied` (i.e., excluding `maintenance`). A room under maintenance is not available for sale and should not inflate the denominator.

**Solution:** RevPAR denominator counts rooms where `status != 'maintenance'` for each day in the period, multiplied by the number of days.

---

## 9. PII Export Permission — How Is It Granted?

**Question:** The prompt says PII export requires "explicit permission grant." How is this permission managed?

**Assumption:** PII export is a separate permission flag on the user record (`pii_export_allowed: boolean`). Only Hotel Admin can grant this flag to other users. Analyst role can run reports but cannot export PII unless the flag is set.

**Solution:** `users.pii_export_allowed` boolean field. Report export endpoint checks this flag when `includePii: true` is requested. Returns 403 if flag is false.

---

## 10. Face Liveness — What Are the Pass Thresholds?

**Question:** The prompt describes liveness checks using blink timing, motion consistency, and texture/reflection heuristics. What are the pass/fail thresholds?

**Assumption:** Configurable thresholds with sensible defaults: blink timing 100–500ms (natural blink range), motion consistency score ≥ 0.6, texture/reflection score ≥ 0.5. All three must pass for a capture to be accepted.

**Solution:** Thresholds defined in environment config. Liveness service evaluates each metric and returns a per-metric pass/fail plus an overall result. Any single failure rejects the capture.

---

## 11. Face Template — What Format Is the Encrypted Template?

**Question:** The prompt says "only encrypted face templates are stored." What is the template format before encryption?

**Assumption:** For this implementation, the face template is a JSON object containing the liveness metadata and capture scores for all three angles. It is serialized to JSON, then encrypted with AES-256-GCM. The raw image is not part of the template.

**Solution:** Template = `JSON.stringify({angles: {left: {...}, front: {...}, right: {...}}, enrolledAt: ...})`. Encrypted with AES-256-GCM using key from env. Stored as base64 string in `face_enrollments.template_path` (or as a file in `face-templates/`).

---

## 12. Notification Cursor — What Is the Cursor Format?

**Question:** The prompt says notifications are queryable by cursor. What is the cursor — a timestamp, an ID, or an offset?

**Assumption:** Cursor should be monotonic and stable under concurrent inserts; UUID lexical comparison is not reliable.

**Solution:** Use opaque cursor encoding `{created_at,id}` (base64 JSON). Query with `(created_at > ts) OR (created_at = ts AND id > id)` ordered by `created_at ASC, id ASC`. Endpoint stays `GET /notifications?groupId=&after=<cursor>&limit=50`, returning `nextCursor` with the same format.

---

## 13. Data Export Archive — What Format?

**Question:** The prompt says account data export packages profile, activity logs, and uploaded files into a "locally generated archive." What format?

**Assumption:** ZIP archive containing: `profile.json` (user profile), `activity_logs.json` (all activity log entries), `files/` directory with copies of uploaded files. Archive is stored in `exports/` directory and served via a time-limited local URL.

**Solution:** Node.js `archiver` library creates the ZIP. Archive expires and is deleted after 24 hours by the cleanup job. Download URL is a local API endpoint: `GET /exports/:archiveId`.

---

## 14. Staffing Import — What Columns Are Required?

**Question:** The prompt says strict column validation for staffing and evaluation imports. What are the required columns?

**Assumption:**
- Staffing: `employee_id` (required), `effective_date` (required, YYYY-MM-DD), `position` (required), `department` (optional), `property_id` (optional), `signed_off_by` (optional)
- Evaluation: `employee_id` (required), `effective_date` (required), `score` (required, decimal), `result` (required), `rewards` (optional), `penalties` (optional), `signed_off_by` (optional)

**Solution:** Column schema defined per dataset type. Import service validates presence and type of each column. Missing required columns → batch-level error (not row-level). Wrong type → row-level error.

---

## 15. Audit Log Retention — 1 Year — Hard Delete or Archive?

**Question:** The prompt says audit logs are immutable for 1 year. Does this mean rows are never deleted, or can they be archived after 1 year?

**Assumption:** Audit log rows are never deleted from the primary `audit_logs` table within the 1-year retention window. The app DB role has INSERT-only permission on `audit_logs`. After 1 year, rows may be archived to a cold table but are not hard-deleted from the system.

**Solution:** MySQL role for the app has INSERT-only on `audit_logs`. A daily job checks for rows older than 1 year and moves them to `audit_logs_archive`. The primary table retains all rows within the 1-year window.

---

## 16. Manager Property Scope — Can a Manager Be Assigned to Multiple Properties?

**Question:** The prompt says managers have "property-scoped access." Can a manager be assigned to more than one property?

**Assumption:** A manager is assigned to exactly one property (stored as `users.property_id`). If multi-property manager access is needed, it would require a separate `user_properties` join table, but the prompt implies single-property scope.

**Solution:** `users.property_id` is a single FK. All manager queries filter by this property_id. Hotel Admin has no property filter.

---

## 17. Idempotency on Itinerary Updates — What Is the Scope?

**Question:** The prompt says idempotency keys prevent duplicate updates during retries. Is the key scoped per item, per user, or globally?

**Assumption:** Idempotency keys are scoped by actor + operation + target resource and retained for 24 hours.

**Solution:** Use a dedicated `idempotency_keys` table (`key`, `actor_id`, `operation`, `resource_scope`, `request_hash`, `response_snapshot`, `expires_at`). On duplicate key with same request hash, return stored response; mismatched hash returns 409. Avoid storing update idempotency directly on `itinerary_items` rows.
