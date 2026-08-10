#!/usr/bin/env bash
#
# Cloud Agent — start phase (per-boot, idempotent, returns quickly).
#
# Brings up the infrastructure every Cloud Agent boot needs:
#   - ensures local env files exist,
#   - starts the PostgreSQL 16 cluster and waits until it is ready,
#   - ensures the application role + database exist.
#
# The long-running dev servers (backend + web) run as named `terminals`, not here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/cloud-agent-lib.sh
source "$REPO_ROOT/scripts/cloud-agent-lib.sh"

echo "==> [start] Ensuring local env files"
somafrik_write_env_files

echo "==> [start] Starting PostgreSQL"
somafrik_pg_start

echo "==> [start] Ensuring role + database"
somafrik_pg_ensure_role_db

echo "==> [start] Infrastructure ready (backend + web run as terminals)."
