# AGENTS.md

## Cursor Cloud specific instructions

Somafrik is a multi-country school governance platform. Everything is driven by one Node/Express **backend** API (`backend/`) that also serves the built React SPA at `/web/` and the legacy static BackOffice at `/backoffice/`. The **web** app (`web/`, Vite + React + TS) is the primary UI and, in dev, proxies `/api` to the backend. The **Mobile** app (`Mobile/`, Expo) is an additional, optional surface. Standard commands live in the root `package.json`, `backend/package.json`, `web/package.json`, `docker-compose.yml`, and `README.md` — refer to those rather than duplicating them.

The Cloud VM runs services **natively** (like `.github/workflows/ci.yml`), not via `docker compose` (Docker is not installed here). PostgreSQL 16 is installed as a system package by setup.

### Starting the stack (services are not auto-started)

The update script only refreshes npm dependencies. Start services yourself each session:

1. **PostgreSQL** (must be running before the backend; not started on boot):
   ```bash
   sudo pg_ctlcluster 16 main start
   ```
   The DB `somafrik` and role `somafrik` / password `somafrik123` (on default port 5432) are already created and persist in the snapshot. Quick check: `pg_isready -h 127.0.0.1 -p 5432`.

2. **Backend** (`backend/`, port 5000) — run against Postgres in dev. It requires these env vars (compose/`.env` values assume Docker's internal port 5432; locally point `DATABASE_URL` at 127.0.0.1:5432):
   ```bash
   cd backend
   DATABASE_URL=postgresql://somafrik:somafrik123@127.0.0.1:5432/somafrik \
   JWT_SECRET=dev-secret SOMAFRIK_DB_REQUIRED=true PORT=5000 CORS_ORIGINS='*' \
   node server.js
   ```
   Health: `curl http://127.0.0.1:5000/api/health` → `{"database":"postgresql"}`. On first boot with an empty DB the backend auto-seeds demo data. `npm run dev:memory` runs a no-Postgres in-memory variant for quick smoke tests.

3. **Web** (`web/`, port 5173): `npm --prefix web run dev -- --host 0.0.0.0`. Serves `http://localhost:5173/web/` and proxies `/api` to `http://127.0.0.1:5000` (override with `VITE_API_TARGET`).

### Gotchas

- **`node_modules` is committed for `backend/`** (but not `web/`/`Mobile/`), so `npm install` in `backend/` shows up as tracked-file changes in `git status`. Do **not** commit these dependency churn diffs (`backend/node_modules/**`, `backend/package-lock.json`).
- **Login endpoints differ:** the web/BackOffice console uses `POST /api/backoffice/login` with `{identifier, password}` (e.g. `superadmin` / `1234`); the mobile app uses `POST /api/login` with `{role, schoolCode, identifier, pin}`. Full demo-account list is in `README.md`.
- **`npm run build` (web) currently fails** on a pre-existing `tsc --noEmit` type error in `src/lib/subscriptionPolicy.ts`. `vite build` alone succeeds and `npm run typecheck`/`lint` report other pre-existing issues — these are not environment problems.
- The backend `postinstall` downloads Chromium (Puppeteer, for bulletin PDFs) into `~/.cache/puppeteer`; it is cached across runs.
- Mobile (Expo) is optional and needs a device/emulator plus `Mobile/.env.local`; it is not required to exercise the web + API core.
