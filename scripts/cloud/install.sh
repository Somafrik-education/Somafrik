#!/usr/bin/env bash
# Cloud Agent install phase for Somafrik.
# Idempotent: installs PostgreSQL 16 (if missing), Node dependencies for every
# workspace, and ensures the `somafrik` role + database exist. Docker is not
# available inside Cloud Agent VMs, so the Docker Compose stack is reproduced
# natively (PostgreSQL + Express backend + Vite web).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# PostgreSQL cluster identity (overridable). The major version is pinned to 16
# to match CI (`postgres:16`) and docker-compose.
PG_VERSION="${SOMAFRIK_PG_VERSION:-16}"
PG_CLUSTER="${SOMAFRIK_PG_CLUSTER:-main}"
PG_BIN="/usr/lib/postgresql/${PG_VERSION}/bin"

# Connection parameters (aligned with docker-compose defaults). Any of these can
# be overridden; run-backend.sh consumes the same variables.
PG_USER="${POSTGRES_USER:-somafrik}"
PG_PASSWORD="${POSTGRES_PASSWORD:-somafrik123}"
PG_DB="${POSTGRES_DB:-somafrik}"
PG_PORT="${POSTGRES_PORT:-5432}"

cluster_exists() {
  pg_lsclusters -h 2>/dev/null | awk '{print $1"/"$2}' | grep -qx "${PG_VERSION}/${PG_CLUSTER}"
}

echo "==> [install] Ensuring PostgreSQL ${PG_VERSION} is available"
# Detect the *specific* major version via its binaries — not the generic
# `pg_ctlcluster` wrapper, which is present even when another major is installed.
if [ ! -x "${PG_BIN}/pg_ctl" ]; then
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    "postgresql-${PG_VERSION}" "postgresql-client-${PG_VERSION}"
fi

echo "==> [install] Ensuring cluster ${PG_VERSION}/${PG_CLUSTER} exists"
if ! cluster_exists; then
  sudo pg_createcluster "${PG_VERSION}" "${PG_CLUSTER}" >/dev/null 2>&1 || true
fi

echo "==> [install] Installing Node dependencies (root, backend, web, Mobile)"
npm run install:all

echo "==> [install] Starting PostgreSQL cluster (for role/db provisioning)"
sudo pg_ctlcluster "${PG_VERSION}" "${PG_CLUSTER}" start 2>/dev/null || true
for _ in $(seq 1 30); do
  pg_isready -h 127.0.0.1 -p "${PG_PORT}" >/dev/null 2>&1 && break
  sleep 1
done

echo "==> [install] Provisioning role '${PG_USER}' and database '${PG_DB}'"
# Safe provisioning: values are passed as psql variables and quoted with
# format(%I/%L) via \gexec — never interpolated into SQL text. This prevents
# SQL injection / breakage when identifiers or passwords contain quotes.
sudo -u postgres psql -v ON_ERROR_STOP=1 \
  --set=pguser="${PG_USER}" \
  --set=pgpass="${PG_PASSWORD}" \
  --set=pgdb="${PG_DB}" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'pguser', :'pgpass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'pguser')
\gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'pguser', :'pgpass')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'pguser')
\gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'pgdb', :'pguser')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'pgdb')
\gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'pgdb', :'pguser')
WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = :'pgdb')
\gexec
SQL

echo "==> [install] Done"
