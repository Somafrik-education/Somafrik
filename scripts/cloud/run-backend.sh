#!/usr/bin/env bash
# Runs the Somafrik Express API against the local PostgreSQL instance.
# Mirrors the docker-compose "backend" service (development defaults).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/backend"

export NODE_ENV="${NODE_ENV:-development}"
export PORT="${BACKEND_PORT:-5000}"
export DATABASE_URL="${DATABASE_URL:-postgresql://somafrik:somafrik123@127.0.0.1:5432/somafrik}"
export JWT_SECRET="${JWT_SECRET:-somafrik-dev-secret-change-me}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:5000,http://127.0.0.1:5000,http://localhost:5173,http://127.0.0.1:5173}"
export SOMAFRIK_DB_REQUIRED="${SOMAFRIK_DB_REQUIRED:-true}"
export SOMAFRIK_SKIP_DEMO_SEED="${SOMAFRIK_SKIP_DEMO_SEED:-false}"
export SOMAFRIK_DISABLE_LOGIN_LOCKOUT="${SOMAFRIK_DISABLE_LOGIN_LOCKOUT:-true}"

echo "==> [backend] Waiting for PostgreSQL"
for _ in $(seq 1 60); do
  pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && break
  sleep 1
done

echo "==> [backend] Starting Express API on :$PORT (database=postgresql)"
exec node server.js
