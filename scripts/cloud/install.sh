#!/usr/bin/env bash
# Cloud Agent install phase for Somafrik.
# Idempotent: installs PostgreSQL 16 (if missing), Node dependencies for every
# workspace, and ensures the `somafrik` role + database exist. Docker is not
# available inside Cloud Agent VMs, so the Docker Compose stack is reproduced
# natively (PostgreSQL + Express backend + Vite web).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# --- Node.js >= 22.12.0 (required by every workspace's package.json "engines") -
REQUIRED_NODE="${SOMAFRIK_REQUIRED_NODE:-22.12.0}"

# True when $1 (found) >= $2 (required), compared as semver via `sort -V`.
node_version_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

ensure_node() {
  local current=""
  command -v node >/dev/null 2>&1 && current="$(node --version 2>/dev/null | sed 's/^v//')"
  if [ -n "${current}" ] && node_version_ge "${current}" "${REQUIRED_NODE}"; then
    echo "==> [install] Node ${current} OK (>= ${REQUIRED_NODE})"
    return 0
  fi
  # Try to activate the pinned version via nvm (reads .nvmrc = ${REQUIRED_NODE}).
  local nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ -s "${nvm_sh}" ]; then
    # shellcheck disable=SC1090
    . "${nvm_sh}"
    nvm install >/dev/null 2>&1 || true
    nvm use >/dev/null 2>&1 || true
    current="$(node --version 2>/dev/null | sed 's/^v//')"
    if [ -n "${current}" ] && node_version_ge "${current}" "${REQUIRED_NODE}"; then
      echo "==> [install] Node ${current} activé via nvm (>= ${REQUIRED_NODE})"
      return 0
    fi
  fi
  echo "ERROR: Node >= ${REQUIRED_NODE} requis par les workspaces (trouvé: ${current:-absent})." >&2
  echo "       Installez Node ${REQUIRED_NODE} (voir .nvmrc) puis relancez l'installation." >&2
  return 1
}

echo "==> [install] Ensuring Node >= ${REQUIRED_NODE}"
ensure_node

# Test hook: validate only the Node guarantee, then stop (no PG / npm work).
if [ "${SOMAFRIK_CHECK_NODE_ONLY:-0}" = "1" ]; then
  exit 0
fi

# PostgreSQL cluster identity (overridable). The major version is pinned to 16
# to match CI (`postgres:16`) and docker-compose.
PG_VERSION="${SOMAFRIK_PG_VERSION:-16}"
PG_CLUSTER="${SOMAFRIK_PG_CLUSTER:-main}"
PG_BIN="/usr/lib/postgresql/${PG_VERSION}/bin"

# Connection parameters (aligned with docker-compose defaults). Any of these can
# be overridden; run-backend.sh consumes the same variables. The cluster is
# configured to actually listen on ${PG_PORT}.
PG_USER="${POSTGRES_USER:-somafrik}"
PG_PASSWORD="${POSTGRES_PASSWORD:-somafrik123}"
PG_DB="${POSTGRES_DB:-somafrik}"
PG_PORT="${POSTGRES_PORT:-5432}"

cluster_exists() {
  pg_lsclusters -h 2>/dev/null | awk '{print $1"/"$2}' | grep -qx "${PG_VERSION}/${PG_CLUSTER}"
}

cluster_port() {
  sudo pg_conftool "${PG_VERSION}" "${PG_CLUSTER}" show port 2>/dev/null | awk '{print $NF}'
}

# Make the cluster actually listen on ${PG_PORT}. Restart if it is already
# running on a different port so the change takes effect immediately.
ensure_cluster_port() {
  local current
  current="$(cluster_port)"
  if [ -n "${current}" ] && [ "${current}" != "${PG_PORT}" ]; then
    echo "==> [install] Reconfiguring cluster port ${current} -> ${PG_PORT}"
    sudo pg_conftool "${PG_VERSION}" "${PG_CLUSTER}" set port "${PG_PORT}"
    sudo pg_ctlcluster "${PG_VERSION}" "${PG_CLUSTER}" restart 2>/dev/null || true
  fi
}

echo "==> [install] Ensuring PostgreSQL ${PG_VERSION} is available"
# Detect the *specific* major version via its binaries — not the generic
# `pg_ctlcluster` wrapper, which is present even when another major is installed.
if [ ! -x "${PG_BIN}/pg_ctl" ]; then
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    "postgresql-${PG_VERSION}" "postgresql-client-${PG_VERSION}"
fi

echo "==> [install] Ensuring cluster ${PG_VERSION}/${PG_CLUSTER} on port ${PG_PORT}"
if ! cluster_exists; then
  # Create the cluster directly on the requested port.
  sudo pg_createcluster --port "${PG_PORT}" "${PG_VERSION}" "${PG_CLUSTER}" >/dev/null 2>&1 || true
fi
ensure_cluster_port

echo "==> [install] Installing Node dependencies (root, backend, web, Mobile)"
npm run install:all

echo "==> [install] Starting PostgreSQL cluster (for role/db provisioning)"
sudo pg_ctlcluster "${PG_VERSION}" "${PG_CLUSTER}" start 2>/dev/null || true
for _ in $(seq 1 30); do
  pg_isready -h 127.0.0.1 -p "${PG_PORT}" >/dev/null 2>&1 && break
  sleep 1
done

echo "==> [install] Provisioning role '${PG_USER}' and database '${PG_DB}' on port ${PG_PORT}"
# Safe provisioning: values are passed as psql variables and quoted with
# format(%I/%L) via \gexec — never interpolated into SQL text. This prevents
# SQL injection / breakage when identifiers or passwords contain quotes.
# -p targets the cluster's actual port so a custom port is honoured end-to-end.
sudo -u postgres psql -p "${PG_PORT}" -v ON_ERROR_STOP=1 \
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

echo "==> [install] Done (port ${PG_PORT})"
