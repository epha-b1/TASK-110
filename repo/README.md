# Hospitality Operations Intelligence

Offline-first backend API for hotel group itinerary coordination, operational
reporting, staffing imports, face enrollment, and audit-grade logging.

## Quick Start (development)

```bash
docker compose up --build
```

The bundled `docker-compose.yml` defaults `NODE_ENV=development` and
provides the DB credentials inline. JWT_SECRET and ENCRYPTION_KEY are
NOT hardcoded — see "Production secrets" below for why.

If you want to run `npm run dev` outside Docker, copy the template:

```bash
cp .env.example .env
```

`.env.example` lists every variable the service reads (`DB_*`, `JWT_*`,
`ENCRYPTION_KEY`, `PORT`, optional `RATE_LIMIT_*`,
`AUDIT_MAINTAINER_*`).

## Production secrets (fail-fast)

When `NODE_ENV=production`, the application validates `JWT_SECRET`,
`ENCRYPTION_KEY` and `DB_PASSWORD` at startup and **refuses to boot**
if any of them are empty, too short, or set to a known weak default.
The validator lives in `src/config/environment.ts` and is exercised
by `unit_tests/env-validation.spec.ts`.

To run a production deployment via the bundled compose file:

```bash
NODE_ENV=production \
JWT_SECRET=$(openssl rand -hex 32) \
ENCRYPTION_KEY=$(openssl rand -hex 32) \
docker compose up --build
```

Without those vars set, the production container will exit with a
fatal banner listing every problem. This is intentional — it prevents
a misconfigured deployment from running with throwaway credentials.

## Ports

| Service | URL |
|---------|-----|
| API     | http://localhost:3000 |
| Swagger | http://localhost:3000/api/docs |
| MySQL   | localhost:3306 |

## Test Credentials

| Username  | Password        | Role        | Scope |
|-----------|-----------------|-------------|-------|
| admin     | Admin1!pass     | hotel_admin | all properties |
| manager1  | Manager1!pass   | manager     | Eagle Point Resort (property 1) |
| analyst1  | Analyst1!pass   | analyst     | all properties |
| member1   | Member1!pass    | member      | own groups only |

## Run Tests

The canonical test runner is the Docker wrapper, which brings up a MySQL
container, waits for the `/health` endpoint, then runs both projects:

```bash
# From the project root — starts containers, waits for health, runs all tests
./run_tests.sh
```

The Jest configuration defines two projects:

- `unit` — pure unit tests under `unit_tests/` (mocks Sequelize; no DB needed)
- `api`  — integration tests under `API_tests/` (require a running MySQL)

Run a single project or a single file directly with npm scripts:

```bash
npm run test:unit                                   # all unit tests
npm run test:api                                    # all API tests
npx jest --selectProjects api audit.api.spec.ts     # one API file
npx jest --selectProjects unit audit-immutability   # one unit suite
```

The API tests bail out with a clear message if MySQL is not reachable —
either run them inside Docker via `./run_tests.sh`, or start the DB
separately with `docker compose up db -d`.

## Directory Layout

| Path                     | Purpose |
|--------------------------|---------|
| `src/`                   | Application source (routes, controllers, services, models) |
| `migrations/`            | Sequelize migrations (numbered, run in order) |
| `seeders/`               | Demo data (users, properties, rooms) |
| `unit_tests/`            | Unit tests (Jest, mocked Sequelize) |
| `API_tests/`             | API/integration tests (supertest + real DB) |
| `exports/`               | Generated export artifacts (ignored) |
| `var/import-tmp/`        | Staging area for validated-but-uncommitted imports (ignored) |
| `uploads/`               | User-uploaded files (ignored) |
| `face-templates/`        | Face enrollment templates (ignored) |
| `docs/`                  | Supplementary docs (e.g. audit immutability) |

## Security Notes

- Audit logs are append-only and enforced by Sequelize hooks + MySQL
  triggers. See `docs/audit-immutability.md` for the enforcement model
  and verification steps.
- Sensitive fields (passwords, tokens, secrets, API keys, session tokens)
  are deep-masked before being returned from either `GET /audit-logs` or
  `GET /audit-logs/export`.
- CSV exports (reports and audit) use an RFC-4180 quoted serializer and
  neutralize spreadsheet formula injection prefixes.
- Per-user rate limits are applied inside each protected router AFTER
  authentication, so `req.user.id` is the actual limiter key.
