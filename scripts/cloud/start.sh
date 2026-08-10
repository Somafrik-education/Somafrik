#!/usr/bin/env bash
# Cloud Agent start phase for Somafrik.
# Per-boot reconciliation: bring the PostgreSQL cluster online and wait until it
# accepts connections, then return. The backend/web dev servers run as terminals.
set -euo pipefail

PG_VERSION="${SOMAFRIK_PG_VERSION:-16}"
PG_CLUSTER="${SOMAFRIK_PG_CLUSTER:-main}"
PG_BIN="/usr/lib/postgresql/${PG_VERSION}/bin"
PG_PORT="${POSTGRES_PORT:-5432}"

cluster_exists() {
  pg_lsclusters -h 2>/dev/null | awk '{print $1"/"$2}' | grep -qx "${PG_VERSION}/${PG_CLUSTER}"
}

echo "==> [start] Ensuring cluster ${PG_VERSION}/${PG_CLUSTER} exists"
if ! cluster_exists && [ -x "${PG_BIN}/pg_ctl" ]; then
  sudo pg_createcluster "${PG_VERSION}" "${PG_CLUSTER}" >/dev/null 2>&1 || true
fi

echo "==> [start] Starting PostgreSQL ${PG_VERSION}/${PG_CLUSTER} cluster"
sudo pg_ctlcluster "${PG_VERSION}" "${PG_CLUSTER}" start 2>/dev/null \
  || sudo pg_ctlcluster "${PG_VERSION}" "${PG_CLUSTER}" restart 2>/dev/null \
  || true

echo "==> [start] Waiting for PostgreSQL to accept connections on :${PG_PORT}"
for _ in $(seq 1 60); do
  if pg_isready -h 127.0.0.1 -p "${PG_PORT}" >/dev/null 2>&1; then
    echo "==> [start] PostgreSQL is ready"
    exit 0
  fi
  sleep 1
done

echo "==> [start] PostgreSQL did not become ready in time" >&2
exit 1
