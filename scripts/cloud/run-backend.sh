#!/usr/bin/env bash
# Runs the Somafrik Express API against the local PostgreSQL instance.
# Mirrors the docker-compose "backend" service (development defaults).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/backend"

export NODE_ENV="${NODE_ENV:-development}"
export PORT="${BACKEND_PORT:-5000}"
export JWT_SECRET="${JWT_SECRET:-somafrik-dev-secret-change-me}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:5000,http://127.0.0.1:5000,http://localhost:5173,http://127.0.0.1:5173}"

# --- Database connection -----------------------------------------------------
# Thread any custom PostgreSQL parameters through to the backend. If DATABASE_URL
# is provided we honour it verbatim; otherwise we hand the backend the discrete
# POSTGRES_* variables (the same ones install.sh provisions). The backend
# (backend/db/connectionConfig.js) URL-encodes discrete credentials safely, so
# passwords/identifiers with special characters do not need manual escaping.
PG_HOST="${POSTGRES_HOST:-127.0.0.1}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_USER="${POSTGRES_USER:-somafrik}"
PG_PASSWORD="${POSTGRES_PASSWORD:-somafrik123}"
PG_DB="${POSTGRES_DB:-somafrik}"

# Resolve the readiness-probe target from the *effective* DB config so we never
# wait on 127.0.0.1:5432 when a remote DATABASE_URL (or a custom port) is used.
PROBE_ARGS=()
if [ -n "${DATABASE_URL:-}" ]; then
  export DATABASE_URL
  # Parse host:port for a human-readable log only (strip creds after the LAST '@',
  # then the path/query). The actual probe uses `pg_isready -d "$DATABASE_URL"`,
  # which parses the conninfo robustly.
  _hp="${DATABASE_URL##*@}"; _hp="${_hp%%\?*}"; _hp="${_hp%%/*}"
  PROBE_HOST="${_hp%%:*}"
  PROBE_PORT="${_hp##*:}"; [ "${PROBE_PORT}" = "${_hp}" ] && PROBE_PORT="5432"
  PROBE_ARGS=( -d "${DATABASE_URL}" )
  echo "==> [backend] Using provided DATABASE_URL (probe target ${PROBE_HOST}:${PROBE_PORT})"
else
  export POSTGRES_HOST="$PG_HOST" POSTGRES_PORT="$PG_PORT" \
         POSTGRES_USER="$PG_USER" POSTGRES_PASSWORD="$PG_PASSWORD" POSTGRES_DB="$PG_DB"
  PROBE_HOST="$PG_HOST"
  PROBE_PORT="$PG_PORT"
  PROBE_ARGS=( -h "$PG_HOST" -p "$PG_PORT" )
  echo "==> [backend] DB via discrete POSTGRES_* (probe target ${PROBE_HOST}:${PROBE_PORT})"
fi

export SOMAFRIK_DB_REQUIRED="${SOMAFRIK_DB_REQUIRED:-true}"

# --- Dev-only conveniences (PRIVATE, ephemeral, single-tenant Cloud Agent VM) --
# This environment is a private per-agent VM. For that context we seed the demo
# dataset and relax the login lockout so the app is immediately usable. Both are
# overridable and MUST stay at their production-safe values in any shared/public
# deployment: SOMAFRIK_SKIP_DEMO_SEED=true and SOMAFRIK_DISABLE_LOGIN_LOCKOUT=false.
export SOMAFRIK_SKIP_DEMO_SEED="${SOMAFRIK_SKIP_DEMO_SEED:-false}"
export SOMAFRIK_DISABLE_LOGIN_LOCKOUT="${SOMAFRIK_DISABLE_LOGIN_LOCKOUT:-true}"

# Test hook: resolve config + print the probe target, then exit without booting.
if [ "${SOMAFRIK_PROBE_ONLY:-0}" = "1" ]; then
  echo "PROBE_TARGET ${PROBE_HOST}:${PROBE_PORT}"
  exit 0
fi

WAIT_TRIES="${SOMAFRIK_DB_WAIT_TRIES:-60}"
echo "==> [backend] Waiting for PostgreSQL (${PROBE_HOST}:${PROBE_PORT}, up to ${WAIT_TRIES}s)"
for _ in $(seq 1 "${WAIT_TRIES}"); do
  pg_isready "${PROBE_ARGS[@]}" >/dev/null 2>&1 && break
  sleep 1
done

echo "==> [backend] Starting Express API on :$PORT (database=postgresql)"
exec node server.js
