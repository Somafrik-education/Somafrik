#!/usr/bin/env bash
# Runs the Somafrik Vite web dev server (proxies /api to the local backend).
# Mirrors the docker-compose "web-dev" service.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/web"

export VITE_API_URL="${VITE_API_URL:-http://localhost:5000}"
export VITE_API_TARGET="${VITE_API_TARGET:-http://127.0.0.1:5000}"
export VITE_SHOW_DEMO_ACCOUNTS="${VITE_SHOW_DEMO_ACCOUNTS:-true}"

echo "==> [web] Starting Vite dev server on :5173 (API=$VITE_API_URL)"
exec npm run dev -- --host 0.0.0.0 --port 5173
