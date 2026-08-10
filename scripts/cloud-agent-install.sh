#!/usr/bin/env bash
#
# Cloud Agent — install phase (durable, idempotent).
#
# Prepares the Somafrik monorepo for native (Docker-less) development inside a
# Cursor Cloud Agent VM:
#   1. System packages: PostgreSQL 16 + the shared libraries Puppeteer's Chromium
#      needs for PDF bulletin generation.
#   2. A local PostgreSQL role + database ("somafrik").
#   3. Local .env / Mobile/.env.local pointing the backend at the local cluster.
#   4. npm dependencies for the 4 packages (root, backend, web, Mobile).
#
# This script only needs to succeed once to build the environment snapshot; it is
# safe to re-run. Per-boot service startup lives in cloud-agent-start.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/cloud-agent-lib.sh
source "$REPO_ROOT/scripts/cloud-agent-lib.sh"

echo "==> [install] System packages (PostgreSQL 16 + Chromium libs)"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq \
  postgresql-16 postgresql-client-16 \
  libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64 \
  libpango-1.0-0 libcairo2 libatspi2.0-0t64

echo "==> [install] Start PostgreSQL and ensure role + database"
somafrik_pg_start
somafrik_pg_ensure_role_db

echo "==> [install] Local env files"
somafrik_write_env_files

echo "==> [install] npm dependencies (root, backend, web, Mobile)"
# Use install:all (npm install) rather than ci:install (npm ci): the committed
# Mobile/package-lock.json is currently out of sync (js-yaml 3.15.0 vs 3.15.1),
# which makes `npm ci` fail. `npm install` resolves it without touching tracked files.
# Retry to tolerate transient registry network errors.
for attempt in 1 2 3 4; do
  if npm run install:all; then
    break
  fi
  echo "   install:all attempt ${attempt} failed; retrying in $((attempt * 5))s"
  sleep $((attempt * 5))
done

echo "==> [install] Done."
