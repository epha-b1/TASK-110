# Hospitality Operations Intelligence — Submission Folder Structure

Task ID: 110
Project Type: pure_backend
Stack: Express + TypeScript + Sequelize + MySQL

---

## ZIP Root Layout

```
110/
├── docs/
│   ├── design.md
│   ├── api-spec.md
│   ├── questions.md
│   ├── features.md
│   ├── build-order.md
│   ├── structure.md
│   └── AI-self-test.md
├── repo/                             # project code lives directly here
├── sessions/
│   ├── develop-1.json                # primary development session
│   └── bugfix-1.json                 # remediation session (if needed)
├── metadata.json
└── prompt.md
```

### metadata.json

```json
{
  "prompt": "...",
  "project_type": "pure_backend",
  "frontend_language": "none",
  "backend_language": "typescript",
  "frontend_framework": "none",
  "backend_framework": "express",
  "database": "mysql"
}
```

---

## repo/ — Full Project Structure

```
repo/
├── src/
│   ├── app.ts                        # express app setup
│   ├── server.ts                     # server bootstrap
│   ├── config/
│   │   ├── database.ts               # Sequelize configuration
│   │   ├── auth.ts                   # authentication config
│   │   └── environment.ts            # env variables
│   ├── controllers/
│   │   ├── auth.controller.ts        # authentication endpoints
│   │   ├── accounts.controller.ts    # account management
│   │   ├── groups.controller.ts      # itinerary groups
│   │   ├── itineraries.controller.ts # group itineraries
│   │   ├── files.controller.ts       # file/attachment handling
│   │   ├── reports.controller.ts     # reporting and analytics
│   │   ├── import.controller.ts      # data import
│   │   ├── face.controller.ts        # face enrollment
│   │   └── notifications.controller.ts
│   ├── services/
│   │   ├── auth.service.ts           # login, session management
│   │   ├── rbac.service.ts           # role-based access control
│   │   ├── group.service.ts          # group management logic
│   │   ├── itinerary.service.ts      # itinerary operations
│   │   ├── file.service.ts           # file upload/storage
│   │   ├── reporting.service.ts      # analytics and reporting
│   │   ├── import.service.ts         # Excel data processing
│   │   ├── face.service.ts           # face enrollment/recognition
│   │   ├── notification.service.ts   # in-system notifications
│   │   ├── encryption.service.ts     # AES-256 encryption
│   │   └── audit.service.ts          # audit logging
│   ├── middleware/
│   │   ├── auth.middleware.ts        # authentication
│   │   ├── rbac.middleware.ts        # authorization checks
│   │   ├── validation.middleware.ts  # input validation
│   │   ├── audit.middleware.ts       # audit logging
│   │   ├── rate-limit.middleware.ts  # rate limiting
│   │   └── file-upload.middleware.ts # file handling
│   ├── models/
│   │   ├── user.model.ts             # User entity
│   │   ├── role.model.ts             # Role/Permission models
│   │   ├── group.model.ts            # Itinerary groups
│   │   ├── itinerary.model.ts        # Itinerary items
│   │   ├── file.model.ts             # File attachments
│   │   ├── reservation.model.ts      # Hotel reservations
│   │   ├── room.model.ts             # Room inventory
│   │   ├── face.model.ts             # Face enrollment data
│   │   ├── audit.model.ts            # Audit logs
│   │   └── notification.model.ts     # Notification records
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── accounts.routes.ts
│   │   ├── groups.routes.ts
│   │   ├── itineraries.routes.ts
│   │   ├── files.routes.ts
│   │   ├── reports.routes.ts
│   │   ├── import.routes.ts
│   │   ├── face.routes.ts
│   │   └── notifications.routes.ts
│   ├── utils/
│   │   ├── logger.ts                 # structured logging
│   │   ├── validation.ts             # input validation
│   │   ├── crypto.ts                 # encryption utilities
│   │   ├── excel.ts                  # Excel processing
│   │   ├── face-detection.ts         # liveness checks
│   │   ├── reporting.ts              # report generation
│   │   └── errors.ts                 # error handling
│   └── types/
│       ├── auth.types.ts
│       ├── group.types.ts
│       ├── itinerary.types.ts
│       ├── reporting.types.ts
│       ├── face.types.ts
│       └── api.types.ts
├── migrations/                       # Sequelize migrations
│   ├── 001-create-users.js
│   ├── 002-create-roles.js
│   ├── 003-create-groups.js
│   ├── 004-create-itineraries.js
│   ├── 005-create-files.js
│   ├── 006-create-reservations.js
│   ├── 007-create-face-data.js
│   └── 008-create-audit-logs.js
├── seeders/                          # Sequelize seed data
│   ├── demo-users.js
│   ├── demo-roles.js
│   └── demo-data.js
├── tests/
│   ├── unit/
│   │   ├── auth.test.ts
│   │   ├── groups.test.ts
│   │   ├── itineraries.test.ts
│   │   ├── reporting.test.ts
│   │   ├── face.test.ts
│   │   └── import.test.ts
│   └── integration/
│       ├── auth.api.test.ts
│       ├── groups.api.test.ts
│       ├── itineraries.api.test.ts
│       ├── files.api.test.ts
│       ├── reports.api.test.ts
│       ├── import.api.test.ts
│       └── face.api.test.ts
├── uploads/                          # temporary file storage
├── exports/                          # generated reports
├── templates/                        # Excel import templates
├── face-templates/                   # encrypted face data
├── dist/                            # compiled output
├── node_modules/
├── run_tests.sh
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── .dockerignore
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

---

## What Must NOT Be in the ZIP

- no `node_modules/` directory
- no `dist/` or compiled output
- no `.env` with real credentials (only `.env.example`)
- no temp files in `uploads/`, `exports/`, or `face-templates/`
- no actual face template data

---

## Sessions Naming Rules

- primary development session → `sessions/develop-1.json`
- remediation session → `sessions/bugfix-1.json`
- additional sessions → `develop-2.json`, `bugfix-2.json`, etc.

---

## Submission Checklist

- [ ] `docker compose up` completes without errors
- [ ] Cold start tested in clean environment
- [ ] README has startup command, ports, test credentials
- [ ] `docs/design.md` and `docs/api-spec.md` present
- [ ] `docs/questions.md` has question + assumption + solution for each item
- [ ] Unit and integration tests exist, `run_tests.sh` passes
- [ ] No `node_modules/`, `dist/`, or compiled output in ZIP
- [ ] No real credentials in any config file
- [ ] All prompt requirements implemented — no silent substitutions
- [ ] `sessions/develop-1.json` trajectory file present
- [ ] `metadata.json` at root with all required fields
- [ ] `prompt.md` at root, unmodified
- [ ] Sequelize migrations work correctly
- [ ] MySQL database initializes properly
- [ ] API endpoints documented and functional
- [ ] Offline operation verified (no external dependencies)
- [ ] Face enrollment and liveness detection functional
- [ ] Reporting and analytics endpoints working