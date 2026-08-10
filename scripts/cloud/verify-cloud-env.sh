#!/usr/bin/env bash
# Integration tests for the Cloud Agent env scripts (scripts/cloud/*).
# Covers the three cases required by review:
#   1. Custom POSTGRES_PORT honoured end-to-end (cluster listens on it + backend
#      connects and serves /api/health).
#   2. DATABASE_URL readiness probe targets the URL's real host:port (never
#      falls back to 127.0.0.1:5432), incl. a non-local host/port.
#   3. A distinct fake secret in the audit-evidence file is still detected by
#      gitleaks (no path is blanket-ignored).
#
# Uses a throwaway cluster (sftestport) and backend port so it never disturbs the
# default main/5432 cluster. Run: bash scripts/cloud/verify-cloud-env.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
PASS=0
FAIL=0
TEST_CLUSTER="sftestport"
TEST_PORT="6543"
TEST_BACKEND_PORT="5078"
BACKEND_PID=""

ok()   { echo "  PASS: $*"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }

cleanup() {
  [ -n "${BACKEND_PID}" ] && kill "${BACKEND_PID}" 2>/dev/null || true
  sudo pg_dropcluster --stop 16 "${TEST_CLUSTER}" 2>/dev/null || true
}
trap cleanup EXIT

echo "========================================================================"
echo "TEST 1 — POSTGRES_PORT non standard, de bout en bout (port ${TEST_PORT})"
echo "========================================================================"
sudo pg_dropcluster --stop 16 "${TEST_CLUSTER}" 2>/dev/null || true
# Create + start the cluster on the custom port using the real start.sh logic.
SOMAFRIK_PG_CLUSTER="${TEST_CLUSTER}" POSTGRES_PORT="${TEST_PORT}" bash "${HERE}/start.sh" >/tmp/vce_start.log 2>&1
listen_port="$(sudo pg_conftool 16 "${TEST_CLUSTER}" show port 2>/dev/null | awk '{print $NF}')"
if [ "${listen_port}" = "${TEST_PORT}" ]; then ok "cluster configuré sur le port ${TEST_PORT}"; else bad "cluster sur ${listen_port}, attendu ${TEST_PORT}"; fi
if pg_isready -h 127.0.0.1 -p "${TEST_PORT}" >/dev/null 2>&1; then ok "PostgreSQL accepte les connexions sur ${TEST_PORT}"; else bad "PostgreSQL injoignable sur ${TEST_PORT}"; cat /tmp/vce_start.log; fi

# Provision role/db on the custom port (safe %I/%L quoting, -p custom).
sudo -u postgres psql -p "${TEST_PORT}" -v ON_ERROR_STOP=1 \
  --set=pguser="qaport" --set=pgpass="qaport-secret" --set=pgdb="qaport" >/dev/null 2>&1 <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'pguser', :'pgpass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'pguser') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'pgdb', :'pguser')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'pgdb') \gexec
SQL

# Boot the backend against the custom port via run-backend.sh (discrete vars).
POSTGRES_HOST=127.0.0.1 POSTGRES_PORT="${TEST_PORT}" \
POSTGRES_USER=qaport POSTGRES_PASSWORD="qaport-secret" POSTGRES_DB=qaport \
BACKEND_PORT="${TEST_BACKEND_PORT}" SOMAFRIK_DB_WAIT_TRIES=60 \
bash "${HERE}/run-backend.sh" >/tmp/vce_backend.log 2>&1 &
BACKEND_PID=$!
health=""
for _ in $(seq 1 40); do
  health="$(curl -s "http://127.0.0.1:${TEST_BACKEND_PORT}/api/health" 2>/dev/null || true)"
  echo "${health}" | grep -q '"database":"postgresql"' && break
  sleep 1
done
if echo "${health}" | grep -q '"database":"postgresql"'; then
  ok "backend connecté à PostgreSQL sur le port ${TEST_PORT} (${health})"
else
  bad "backend non connecté sur ${TEST_PORT}"; tail -15 /tmp/vce_backend.log
fi
kill "${BACKEND_PID}" 2>/dev/null || true; BACKEND_PID=""

echo
echo "========================================================================"
echo "TEST 2 — Sonde DATABASE_URL / port ciblant la vraie destination"
echo "========================================================================"
probe_of() { # args: env assignments... ; prints PROBE_TARGET line
  env "$@" SOMAFRIK_PROBE_ONLY=1 bash "${HERE}/run-backend.sh" 2>/dev/null | sed -n 's/^PROBE_TARGET //p'
}
t_default="$(probe_of -u DATABASE_URL -u POSTGRES_PORT)"
[ "${t_default}" = "127.0.0.1:5432" ] && ok "défaut → 127.0.0.1:5432" || bad "défaut → ${t_default} (attendu 127.0.0.1:5432)"

t_port="$(probe_of -u DATABASE_URL POSTGRES_PORT=6543)"
[ "${t_port}" = "127.0.0.1:6543" ] && ok "POSTGRES_PORT custom → 127.0.0.1:6543" || bad "port custom → ${t_port}"

t_url="$(probe_of DATABASE_URL='postgresql://u:p@192.0.2.10:6543/db')"
[ "${t_url}" = "192.0.2.10:6543" ] && ok "DATABASE_URL distant → 192.0.2.10:6543 (pas de repli localhost)" || bad "URL distante → ${t_url}"

# The probe must actually hit the URL target, not localhost: a remote URL is
# unreachable (fails fast), while the same probe on the real local URL succeeds.
if ! pg_isready -t 2 -d 'postgresql://u:p@192.0.2.10:6543/db' >/dev/null 2>&1; then
  ok "pg_isready -d <url distante> échoue (cible bien la destination distante)"
else
  bad "pg_isready -d <url distante> a réussi (sonde probablement locale)"
fi
if pg_isready -t 2 -d 'postgresql://somafrik:somafrik123@127.0.0.1:5432/somafrik' >/dev/null 2>&1; then
  ok "pg_isready -d <url locale réelle> réussit"
else
  bad "pg_isready -d <url locale réelle> a échoué"
fi

echo
echo "========================================================================"
echo "TEST 3 — Un faux secret distinct dans le fichier de preuve reste détecté"
echo "========================================================================"
EVID_REL="docs/audits/evidence/teacher-record-fix-lot2-notes-attendance-runtime-results.json"
TMPD="$(mktemp -d)"
mkdir -p "${TMPD}/$(dirname "${EVID_REL}")"
if [ -f "${REPO_ROOT}/${EVID_REL}" ]; then
  cp "${REPO_ROOT}/${EVID_REL}" "${TMPD}/${EVID_REL}"
else
  echo '{ "results": [] }' > "${TMPD}/${EVID_REL}"
fi
# Build a distinct fake secret AT RUNTIME (random) so this committed test script
# never contains a matchable secret literal itself. Different from the historical
# business identifier; must still be flagged by gitleaks inside the evidence file.
fake_aws="AKIA$(LC_ALL=C tr -dc 'A-Z0-9' </dev/urandom | head -c 16)"
fake_api="$(openssl rand -hex 20 2>/dev/null || (LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c 40))"
printf '\n{"injected":"%s","api_key":"%s"}\n' "${fake_aws}" "${fake_api}" \
  >> "${TMPD}/${EVID_REL}"
gitleaks detect --no-git --source "${TMPD}" --config "${REPO_ROOT}/.gitleaks.toml" \
  --redact --no-banner --exit-code 1 >/tmp/vce_gl_inject.log 2>&1
gl_exit=$?
rm -rf "${TMPD}"
if [ "${gl_exit}" -ne 0 ]; then
  ok "faux secret distinct détecté dans le fichier de preuve (exit ${gl_exit})"
else
  bad "faux secret NON détecté — l'allowlist masque tout le fichier"
fi
# And the real repo must still be clean (no false positives / no suppression hiding).
if gitleaks detect --source "${REPO_ROOT}" --config "${REPO_ROOT}/.gitleaks.toml" --no-banner --exit-code 1 >/tmp/vce_gl.log 2>&1; then
  ok "scan complet du dépôt : aucun leak"
else
  bad "scan complet du dépôt : leak détecté"; tail -5 /tmp/vce_gl.log
fi

echo
echo "========================================================================"
echo "TEST 4 — install.sh garantit Node >= 22.12.0"
echo "========================================================================"
if SOMAFRIK_CHECK_NODE_ONLY=1 bash "${HERE}/install.sh" >/tmp/vce_node_ok.log 2>&1; then
  ok "Node courant accepté ($(node --version 2>/dev/null))"
else
  bad "Node courant rejeté à tort"; tail -3 /tmp/vce_node_ok.log
fi
NODE_SHIM_DIR="$(mktemp -d)"
printf '#!/usr/bin/env bash\necho "v20.0.0"\n' > "${NODE_SHIM_DIR}/node"
chmod +x "${NODE_SHIM_DIR}/node"
if PATH="${NODE_SHIM_DIR}:${PATH}" NVM_DIR=/nonexistent SOMAFRIK_CHECK_NODE_ONLY=1 \
     bash "${HERE}/install.sh" >/tmp/vce_node_old.log 2>&1; then
  bad "Node v20 accepté à tort (garantie absente)"
else
  ok "Node v20 rejeté ($(grep -m1 ERROR /tmp/vce_node_old.log || echo 'exit != 0'))"
fi
rm -rf "${NODE_SHIM_DIR}"

echo
echo "========================================================================"
echo "TEST 5 — La sonde suit la précédence backend (DB_* > POSTGRES_*)"
echo "========================================================================"
t_pref="$(env -u DATABASE_URL DB_HOST=10.1.2.3 DB_PORT=7000 \
  POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=6543 SOMAFRIK_PROBE_ONLY=1 \
  bash "${HERE}/run-backend.sh" 2>/dev/null | sed -n 's/^PROBE_TARGET //p')"
[ "${t_pref}" = "10.1.2.3:7000" ] && ok "sonde → 10.1.2.3:7000 (DB_* prioritaire sur POSTGRES_*)" || bad "sonde → ${t_pref} (attendu 10.1.2.3:7000)"
be_target="$(cd "${REPO_ROOT}/backend" && env -u DATABASE_URL \
  DB_HOST=10.1.2.3 DB_PORT=7000 DB_USER=u DB_PASSWORD=p DB_NAME=d \
  POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=6543 \
  node -e 'const{resolveDatabaseConfig}=require("./db/connectionConfig.js");const c=resolveDatabaseConfig(process.env);console.log(c.host+":"+c.port)' 2>/dev/null)"
[ "${be_target}" = "10.1.2.3:7000" ] && ok "backend résout la même cible 10.1.2.3:7000 (sonde alignée)" || bad "backend → ${be_target} (désaligné)"

echo
echo "========================================================================"
echo "RÉSULTAT : ${PASS} PASS / ${FAIL} FAIL"
echo "========================================================================"
[ "${FAIL}" -eq 0 ]
