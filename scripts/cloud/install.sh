#!/usr/bin/env bash
# Cloud Agent install phase for Somafrik.
# Idempotent: installs PostgreSQL 16 (if missing), Node dependencies for every
# workspace, and ensures the `somafrik` role + database exist. Docker is not
# available inside Cloud Agent VMs, so the Docker Compose stack is reproduced
# natively (PostgreSQL + Express backend + Vite web).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

PG_USER="${POSTGRES_USER:-somafrik}"
PG_PASSWORD="${POSTGRES_PASSWORD:-somafrik123}"
PG_DB="${POSTGRES_DB:-somafrik}"

echo "==> [install] Ensuring PostgreSQL 16 is available"
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-16 postgresql-client-16
fi

echo "==> [install] Installing Node dependencies (root, backend, web, Mobile)"
npm run install:all

echo "==> [install] Starting PostgreSQL cluster (for role/db provisioning)"
sudo pg_ctlcluster 16 main start 2>/dev/null || true
for _ in $(seq 1 30); do
  pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && break
  sleep 1
done

echo "==> [install] Provisioning role '$PG_USER' and database '$PG_DB'"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${PG_USER}') THEN
    CREATE ROLE ${PG_USER} LOGIN PASSWORD '${PG_PASSWORD}';
  END IF;
END
\$\$;
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
  sudo -u postgres createdb -O "${PG_USER}" "${PG_DB}"
fi
sudo -u postgres psql -c "ALTER DATABASE ${PG_DB} OWNER TO ${PG_USER};" >/dev/null

echo "==> [install] Done"
