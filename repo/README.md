# Hospitality Operations Intelligence

**Project type: backend**

Offline-first backend API for hotel group itinerary coordination, operational
reporting, staffing imports, face enrollment, and audit-grade logging.

## Start

Everything runs inside Docker. The single required command is:

```bash
docker-compose up
```

(Modern Docker installations also accept `docker compose up`; both start the
same stack defined by `docker-compose.yml`.)

This command:

- Builds the `hospitality-ops-api` image from the `Dockerfile` in this repo
- Starts the MySQL 8 database container with the right
  `--log-bin-trust-function-creators=1` flag so audit-log triggers can be
  installed
- Runs all Sequelize migrations and the demo-data seeders on first boot
- Starts the API server on port **3000** listening for HTTP requests

The first boot downloads the base images (~150 MB) and runs `npm ci`, so the
initial run takes a few minutes. Subsequent `docker-compose up` invocations
reuse the built image and come up in seconds.

## Access

| Surface      | URL                                    |
|--------------|----------------------------------------|
| API base     | http://localhost:3000                  |
| Health       | http://localhost:3000/health           |
| Swagger UI   | http://localhost:3000/docs             |
| OpenAPI JSON | http://localhost:3000/docs/openapi.json |
| Swagger (legacy path) | http://localhost:3000/api/docs |
| MySQL        | localhost:3306 (exposed by compose)    |

The API port (3000) is published by `docker-compose.yml`.

## Demo Credentials

The `002-demo-data` seeder creates four users covering every role the RBAC
model supports. Each user has an email-compatible username (no email address
is stored separately — the username IS the account identifier).

| Username  | Email / Identifier | Password        | Role         | Scope                                   |
|-----------|--------------------|-----------------|--------------|-----------------------------------------|
| `admin`    | admin             | `Admin1!pass`    | hotel_admin  | all properties, every endpoint          |
| `manager1` | manager1          | `Manager1!pass`  | manager      | Eagle Point Resort (property 1) only    |
| `analyst1` | analyst1          | `Analyst1!pass`  | analyst      | all properties, reporting only          |
| `member1`  | member1           | `Member1!pass`   | member       | itinerary-only (own groups)             |

## Verify the API is up and working

Once `docker-compose up` reports `repo-api-1 ... healthy`, run these
commands in a **separate terminal** to confirm the API is live and
answering requests. Every command below talks to the Docker-exposed port
on the host — no local Node/npm install is involved.

### 1) Health check (public, no auth)

```bash
curl -i http://localhost:3000/health
```

Expected response:

```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
X-Trace-Id: <uuid-v4>
...
{"status":"ok","timestamp":"2026-04-10T..."}
```

A 200 + `{"status":"ok"}` body with an `X-Trace-Id` header confirms the API
container is listening and the middleware chain is functioning.

### 2) Authenticated call — log in as `admin`

```bash
curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin1!pass"}'
```

Expected response (shape):

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": "<uuid>", "username": "admin", "role": "hotel_admin" }
}
```

### 3) Authenticated endpoint — call `/accounts/me` with the bearer token

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin1!pass"}' | jq -r .accessToken)

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/accounts/me
```

Expected shape:

```json
{
  "id": "<uuid>",
  "username": "admin",
  "role": "hotel_admin",
  "status": "active",
  "pii_export_allowed": true,
  ...
}
```

A 200 response with the caller's profile confirms JWT issuance, Bearer
verification, the auth middleware, and the database connection are all
working end-to-end.

### 4) OpenAPI / interactive docs

Open http://localhost:3000/docs in a browser for the Swagger UI, or
`curl http://localhost:3000/docs/openapi.json | jq '.paths | keys | length'`
to count the number of documented endpoints (67 at time of writing).

## Run the test suite

The canonical test runner is Docker-based. It brings up the full stack,
waits for `/health`, and runs both unit and API projects INSIDE the
running API container:

```bash
./run_tests.sh
```

This script:

1. Ensures the compose stack is up (`docker-compose up -d --build` if not)
2. Polls `/health` until the API reports ready
3. Runs `docker compose exec api npx jest --selectProjects=unit` for the unit project
4. Runs `docker compose exec api npx jest --selectProjects=api --runInBand` for the API project
5. Reports PASS/FAIL per project and exits non-zero on any failure

The two Jest projects defined in `jest.config.js`:

- `unit` — pure unit tests under `unit_tests/` (Sequelize mocked; no DB needed)
- `api`  — integration tests under `API_tests/` (real MySQL via supertest
  against the live `src/app.ts`, no controller or service mocking)

## Production secrets (fail-fast)

When `NODE_ENV=production`, the application validates `JWT_SECRET`,
`ENCRYPTION_KEY` and `DB_PASSWORD` at startup and **refuses to boot** if any
of them are empty, too short, or set to a known weak default. The validator
lives in `src/config/environment.ts` and is exercised by
`unit_tests/env-validation.spec.ts`.

To run a production deployment through the bundled compose file:

```bash
NODE_ENV=production \
JWT_SECRET=$(openssl rand -hex 32) \
ENCRYPTION_KEY=$(openssl rand -hex 32) \
docker-compose up --build
```

Without those vars set, the production container will exit with a fatal
banner listing every problem. This is intentional — it prevents a
misconfigured deployment from running with throwaway credentials.

## Directory Layout

| Path                     | Purpose |
|--------------------------|---------|
| `src/`                   | Application source (routes, controllers, services, models) |
| `migrations/`            | Sequelize migrations (numbered, run in order) |
| `seeders/`               | Demo data (users, properties, rooms) |
| `unit_tests/`            | Unit tests (Jest, mocked Sequelize) |
| `API_tests/`             | API/integration tests (supertest + real DB) |
| `exports/`               | Generated export artifacts (ignored by git) |
| `var/import-tmp/`        | Staging area for validated-but-uncommitted imports (ignored) |
| `uploads/`               | User-uploaded files (ignored) |
| `face-templates/`        | Face enrollment templates (ignored) |

## Security Notes

- Audit logs are append-only and enforced by Sequelize hooks **and** MySQL
  triggers installed by migration 017. The provisioning SQL and verification
  script live under `scripts/` (`audit-immutability.sql`,
  `verify-audit-immutability.sh`).
- Sensitive fields (passwords, tokens, secrets, API keys, session tokens)
  are deep-masked before being returned from either `GET /audit-logs` or
  `GET /audit-logs/export`.
- CSV exports (reports and audit) use an RFC-4180 quoted serializer and
  neutralize spreadsheet formula injection prefixes.
- Per-user rate limits are applied inside each protected router AFTER
  authentication, so `req.user.id` is the actual limiter key.
- The `member` user role is itinerary-only (spec-compliant): members can
  join groups and use itineraries, but cannot create groups, upload files,
  receive notifications, or access reports/imports/audit surfaces.
