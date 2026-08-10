#!/usr/bin/env bash
# Cloud Agent start phase for Somafrik.
# Per-boot reconciliation: bring the PostgreSQL cluster online and wait until it
# accepts connections, then return. The backend/web dev servers run as terminals.
set -euo pipefail

echo "==> [start] Starting PostgreSQL 16 cluster"
sudo pg_ctlcluster 16 main start 2>/dev/null \
  || sudo pg_ctlcluster 16 main restart 2>/dev/null \
  || true

echo "==> [start] Waiting for PostgreSQL to accept connections"
for _ in $(seq 1 60); do
  if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    echo "==> [start] PostgreSQL is ready"
    exit 0
  fi
  sleep 1
done

echo "==> [start] PostgreSQL did not become ready in time" >&2
exit 1
