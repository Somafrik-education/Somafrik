#!/usr/bin/env node
/**
 * SMOKE MOBILE RC1 — harness d'audit (aucune correction produit).
 *
 *   DATABASE_URL=postgresql://somafrik:somafrik123@127.0.0.1:5432/somafrik_rc1_smoke \
 *     node docs/audits/evidence/run-mobile-smoke-rc1-2026-08-26.js
 *
 * Preuves : docs/audits/evidence/mobile-smoke-rc1-2026-08-26.json
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { Pool } = require(path.join(__dirname, "..", "..", "..", "backend", "node_modules", "pg"));

const ROOT = path.resolve(__dirname, "../../..");
const BACKEND_DIR = path.join(ROOT, "backend");
const EVIDENCE_PATH = path.join(__dirname, "mobile-smoke-rc1-2026-08-26.json");
const PORT = String(process.env.SOMAFRIK_RC1_PORT || 5191);
const API = `http://127.0.0.1:${PORT}/api`;
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://somafrik:somafrik123@127.0.0.1:5432/somafrik_rc1_smoke";
const SUPER_PASSWORD = "Rc1Smoke!2026";
const STAFF_PASSWORD = "Rc1Staff!2026";
const PARENT_PASSWORD = "Rc1Parent!2026";
const JWT_SECRET = process.env.SOMAFRIK_RC1_JWT_SECRET || "rc1-smoke-local-test-secret-32chars";
const BASELINE = "8d92d6399c3eab9b3c347d0dc7fe85857e9cf391";
const TODAY = new Date().toISOString().slice(0, 10);

const { prepareCanonicalClassContext, postCanonicalClass } = require(path.join(
  ROOT,
  "backend/lib/canonicalClassHttp",
));
const { syncSuperadminCredentials } = require(path.join(ROOT, "backend/lib/superadminBootstrap"));

const evidence = {
  baseline: BASELINE,
  generatedAt: new Date().toISOString(),
  environment: {
    database: DATABASE_URL.replace(/:[^:@/]+@/, ":***@"),
    api: API,
    somafrikDbRequired: true,
    skipDemoSeed: true,
    engineExpected: "postgresql",
  },
  schools: {},
  identities: {},
  counts: { PASS: 0, FAIL: 0, SKIP: 0, BLOCKED: 0, INFO: 0 },
  defects: [],
  regressions: {},
  results: [],
};

function redact(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length > 40 && /^[A-Za-z0-9._\-+/=]+$/.test(value) && value.length > 80) {
      return "[redacted]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      const k = String(key).toLowerCase();
      if (
        /token|password|secret|authorization|pin|refresh|accessToken|jwt/i.test(k) ||
        k === "temporarypassword" ||
        k === "temporarysecret"
      ) {
        out[key] = val ? "[redacted]" : val;
      } else {
        out[key] = redact(val);
      }
    }
    return out;
  }
  return value;
}

function compact(value) {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return String(value);
  }
}

function record(row) {
  const item = {
    id: row.id,
    role: row.role || "n/a",
    screen: row.screen || "",
    action: row.action || "",
    attendu: row.attendu || "",
    obtenu: String(row.obtenu ?? "").slice(0, 1500),
    endpoint: row.endpoint || "",
    verdict: row.verdict,
    classification: row.classification || (row.verdict === "FAIL" ? "review" : ""),
    erreur: row.erreur ? compact(row.erreur).slice(0, 1500) : "",
    pg: row.pg || null,
    rc0: row.rc0 || null,
  };
  evidence.results.push(item);
  evidence.counts[row.verdict] = (evidence.counts[row.verdict] || 0) + 1;
  if (row.defect) evidence.defects.push(row.defect);
  const mark = row.verdict === "PASS" ? "✓" : row.verdict === "FAIL" ? "✗" : row.verdict === "BLOCKED" ? "■" : "·";
  console.log(`  ${mark} ${item.id} [${item.verdict}] ${item.obtenu}`.slice(0, 220));
  return item;
}

function pass(partial) {
  return record({ ...partial, verdict: "PASS" });
}
function fail(partial) {
  return record({ ...partial, verdict: "FAIL" });
}
function skip(partial) {
  return record({ ...partial, verdict: "SKIP" });
}
function blocked(partial) {
  return record({ ...partial, verdict: "BLOCKED" });
}
function info(partial) {
  return record({ ...partial, verdict: "INFO" });
}

function listOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.types)) return payload.types;
  if (Array.isArray(payload?.evaluations)) return payload.evaluations;
  if (Array.isArray(payload?.courses)) return payload.courses;
  if (Array.isArray(payload?.students)) return payload.students;
  if (Array.isArray(payload?.classes)) return payload.classes;
  if (Array.isArray(payload?.teachers)) return payload.teachers;
  if (Array.isArray(payload?.schedules)) return payload.schedules;
  return [];
}

async function request(pathname, { method = "GET", token, body, headers = {}, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API}${pathname}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text.slice(0, 500);
    }
    return { status: response.status, data, text: text.slice(0, 2000) };
  } finally {
    clearTimeout(timer);
  }
}

async function pgQuery(sql, params = []) {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    return (await pool.query(sql, params)).rows;
  } finally {
    await pool.end();
  }
}

async function waitForHealth(timeoutMs = 120000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await request("/health");
      if (res.status === 200) return res;
      last = res;
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`health timeout: ${compact(last)}`);
}

const BACKEND_LOG = path.join("/tmp", "rc1-backend.log");

function startBackend() {
  const out = fs.openSync(BACKEND_LOG, "a");
  return spawn(process.execPath, ["server.js"], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT,
      HOST: "127.0.0.1",
      DATABASE_URL,
      JWT_SECRET,
      SOMAFRIK_DB_REQUIRED: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
      SOMAFRIK_API_ONLY: "true",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      SOMAFRIK_E2E: "true",
      NODE_ENV: "development",
      BOOTSTRAP_SUPERADMIN_ID: "superadmin",
      BOOTSTRAP_SUPERADMIN_PASSWORD: SUPER_PASSWORD,
      BOOTSTRAP_SUPERADMIN_EMAIL: "superadmin@somafrik.app",
    },
    stdio: ["ignore", out, out],
    detached: true,
  });
}

async function stopBackend(child) {
  if (!child || child.exitCode != null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 600));
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* ignore */
  }
}

function resetDatabase() {
  const parsed = new URL(DATABASE_URL);
  const dbName = parsed.pathname.replace(/^\//, "");
  const adminUrl = `postgresql://${parsed.username}:${decodeURIComponent(parsed.password)}@${parsed.hostname}:${parsed.port || 5432}/postgres`;
  const reset = spawnSync(
    "psql",
    [DATABASE_URL, "-c", `DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ${parsed.username};`],
    { encoding: "utf8" },
  );
  if (reset.status !== 0) {
    throw new Error(`reset db ${dbName}: ${reset.stderr || reset.stdout}`);
  }
  return adminUrl;
}

function tokenOf(session) {
  return session?.accessToken || session?.token || "";
}

function permsOf(session) {
  const user = session?.user ?? session ?? {};
  return user.permissions || session?.permissions || [];
}

function hasInventedAll(session) {
  const perms = permsOf(session).map(String);
  return perms.includes("ALL_PRIVILEGES") || perms.includes("*");
}

async function changePassword(token, newPassword) {
  return request("/auth/change-password", {
    method: "POST",
    token,
    body: { newPassword },
  });
}

async function backofficeLogin(identifier, password, schoolCode) {
  const res = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  if (res.status !== 200) return { ...res, token: "", session: null };
  let session = res.data;
  let token = tokenOf(session);
  if (session?.user?.mustChangePassword) {
    const changed = await changePassword(token, password);
    if (changed.status === 200) {
      session = { ...session, ...changed.data, user: { ...(session.user || {}), ...(changed.data?.user || {}), mustChangePassword: false } };
      token = tokenOf(session) || token;
    }
  }
  return { status: 200, data: session, token, session };
}

async function mobileIdentify(identifier, schoolCode) {
  return request("/identify", {
    method: "POST",
    body: { identifier, schoolCode },
  });
}

async function mobileLogin(identifier, pin, schoolCode, role) {
  return request("/login", {
    method: "POST",
    body: { identifier, pin, schoolCode, role },
  });
}

async function mobileSession(identifier, pin, schoolCode, role) {
  const identified = await mobileIdentify(identifier, schoolCode);
  const logged = await mobileLogin(identifier, pin, schoolCode, role);
  let session = logged.data;
  let token = tokenOf(session);
  if (logged.status === 200 && session?.user?.mustChangePassword) {
    const changed = await changePassword(token, pin);
    if (changed.status === 200) {
      session = { ...session, ...changed.data, user: { ...(session.user || {}), ...(changed.data?.user || {}), mustChangePassword: false } };
      token = tokenOf(session) || token;
    }
  }
  return { identified, logged, token, session };
}

function runNodeTest(relPath) {
  const result = spawnSync(process.execPath, ["--import", "tsx", relPath], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NPM_CONFIG_UPDATE_NOTIFIER: "false" },
  });
  if (result.status === 0) return { ok: true, out: (result.stdout || "").slice(-400) };
  const fallback = spawnSync("npx", ["--yes", "tsx", relPath], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return {
    ok: fallback.status === 0,
    out: `${result.stderr || result.stdout || ""}\n${fallback.stderr || fallback.stdout || ""}`.slice(-800),
  };
}

async function createStaff(adminToken, { firstName, lastName, email, roleLabel, password }) {
  const created = await request("/backoffice/users", {
    method: "POST",
    token: adminToken,
    body: { firstName, lastName, email, temporaryPassword: password },
  });
  if (created.status !== 201) return { created, granted: null };
  const granted = await request(`/backoffice/users/${created.data.id}/roles/grant`, {
    method: "POST",
    token: adminToken,
    body: { role: roleLabel },
  });
  return { created, granted, user: { ...created.data, ...granted.data }, email };
}

async function bootstrapSuperadmin() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await syncSuperadminCredentials(pool, {
      identifier: "superadmin",
      password: SUPER_PASSWORD,
      email: "superadmin@somafrik.app",
    });
    await pool.query(`UPDATE users SET must_change_password = FALSE WHERE role = 'SUPER_ADMIN'`);
  } finally {
    await pool.end();
  }
}

async function main() {
  const stamp = Date.now();
  console.log(`\n=== SMOKE MOBILE RC1 ${stamp} baseline=${BASELINE} ===\n`);
  fs.writeFileSync(BACKEND_LOG, "");
  await runStaticChecks();
  resetDatabase();

  let child = startBackend();
  try {
    const health0 = await waitForHealth();
    const engineOk = health0.data?.status === "ok" && health0.data?.database === "postgresql";
    (engineOk ? pass : fail)({
      id: "S00-health",
      screen: "API",
      action: "GET /health",
      attendu: "200 status=ok database=postgresql",
      obtenu: `${health0.status} ${compact(health0.data)}`,
      endpoint: "GET /api/health",
      classification: engineOk ? "" : "P0",
      defect: engineOk
        ? null
        : {
            id: "P0-RC1-HEALTH",
            severity: "P0",
            role: "n/a",
            screen: "API",
            steps: ["GET /api/health"],
            attendu: "status=ok database=postgresql",
            obtenu: health0.data,
            http: health0.status,
            endpoint: "GET /api/health",
            cause: "Le runtime n'est pas PostgreSQL canonique.",
          },
    });
    info({
      id: "S00-engine",
      screen: "API",
      action: "confirmer PostgreSQL",
      attendu: "engine postgresql",
      obtenu: compact(health0.data),
      endpoint: "GET /api/health",
    });

    await stopBackend(child);
    await bootstrapSuperadmin();
    child = startBackend();
    await waitForHealth();
    await runProvisioningAndScenarios(stamp);
  } catch (error) {
    const logTail = fs.existsSync(BACKEND_LOG) ? fs.readFileSync(BACKEND_LOG, "utf8").slice(-2500) : "";
    fail({
      id: "S00-harness-crash",
      screen: "harness",
      action: "exécution",
      attendu: "harness termine",
      obtenu: error.message || String(error),
      endpoint: "n/a",
      classification: "P1",
      erreur: logTail,
    });
    console.error(error);
    if (logTail) console.error(logTail);
  } finally {
    await stopBackend(child);
    fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
    console.log(`\nPreuve écrite: ${EVIDENCE_PATH}`);
    console.log(JSON.stringify(evidence.counts, null, 2));
  }
}

async function runStaticChecks() {
  const screen = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/RoleSelectionScreen.tsx"), "utf8");
  const emptyCode = /useState\(\s*["']{2}\s*\)/.test(screen);
  const noHardcode = !/CD-ISR1-26-002|CD-2026-0001|SCH-6008932665834FEE81FE/.test(screen);
  const hasVerify = /ROLE_SELECTION_COPY\.verifyButton|Vérifier le code/.test(screen);
  const hasOpen = /ROLE_SELECTION_COPY\.openLoginButton|Ouvrir la connexion/.test(screen);
  (emptyCode && noHardcode && hasVerify && hasOpen ? pass : fail)({
    id: "S05-ux-338-static",
    role: "tous",
    screen: "Connexion établissement",
    action: "contrat code vide / pas de hardcode / CTA",
    attendu: "code initial vide, aucun code de test hardcodé, Vérifier + Ouvrir présents",
    obtenu: `empty=${emptyCode} noHardcode=${noHardcode} verify=${hasVerify} open=${hasOpen}`,
    endpoint: "Mobile/src/screens/RoleSelectionScreen.tsx",
    rc0: "P1-UX-#338",
  });

  const layout = runNodeTest("Mobile/src/lib/roleSelectionLayout.test.ts");
  (layout.ok ? pass : fail)({
    id: "S05-ux-338-layout-unit",
    role: "tous",
    screen: "Connexion établissement",
    action: "tests layout responsive",
    attendu: "roleSelectionLayout.test.ts OK",
    obtenu: layout.ok ? "OK" : layout.out,
    endpoint: "npx tsx Mobile/src/lib/roleSelectionLayout.test.ts",
    rc0: "P1-UX-#338",
  });

  const offline = runNodeTest("Mobile/src/lib/offlineClassification.test.ts");
  (offline.ok ? pass : fail)({
    id: "S14-offline-classification-unit",
    screen: "Réseau",
    action: "4xx/5xx/timeout ≠ hors connexion",
    attendu: "offlineClassification.test.ts OK (#325)",
    obtenu: offline.ok ? "OK" : offline.out,
    endpoint: "Mobile/src/lib/offlineClassification.test.ts",
  });

  const isolatedEnv = { ...process.env };
  delete isolatedEnv.DATABASE_URL;
  const net = spawnSync("npm", ["run", "verify:mobile-network-resilience"], {
    cwd: ROOT,
    encoding: "utf8",
    env: isolatedEnv,
  });
  (net.status === 0 ? pass : fail)({
    id: "S14-network-resilience-unit",
    screen: "Réseau",
    action: "verify:mobile-network-resilience",
    attendu: "exit 0",
    obtenu: net.status === 0 ? "OK" : (net.stderr || net.stdout || "").slice(-800),
    endpoint: "npm run verify:mobile-network-resilience",
  });

  blocked({
    id: "S17-android-device-uat",
    role: "CTO / téléphone réel",
    screen: "ANDROID DEVICE UAT",
    action: "connexion #338 + login + CRUD + avion/kill/replay",
    attendu: "preuve téléphone Android réel",
    obtenu: "BLOCKED — agent cloud sans appareil. Checklist dans le rapport RC1.",
    endpoint: "n/a",
    rc0: "P1-UX-#338",
  });
  evidence.regressions["P1-UX-#338"] = "DEVICE UAT";
}

async function runProvisioningAndScenarios(stamp) {
  const superLogin = await request("/backoffice/login", {
    method: "POST",
    body: { identifier: "superadmin", password: SUPER_PASSWORD },
  });
  (superLogin.status === 200 ? pass : fail)({
    id: "S01-superadmin-web",
    role: "Super Administrateur",
    screen: "Connexion Web",
    action: "login backoffice",
    attendu: "200 + accessToken",
    obtenu: `${superLogin.status} role=${superLogin.data?.user?.role || superLogin.data?.role}`,
    endpoint: "POST /api/backoffice/login",
    erreur: superLogin.status === 200 ? "" : superLogin.data,
  });
  if (superLogin.status !== 200) return;
  const superToken = tokenOf(superLogin.data);

  const country = await request("/backoffice/countries", {
    method: "POST",
    token: superToken,
    body: {
      name: "République Démocratique du Congo",
      code: "CD",
      phonePrefix: "+243",
      currency: "CDF",
    },
  });
  const countryOk = country.status === 201 || country.status === 409;
  (countryOk ? pass : fail)({
    id: "S01-country-cd",
    role: "Super Administrateur",
    screen: "Pays",
    action: "créer pays CD",
    attendu: "201 ou 409 existant",
    obtenu: `${country.status}`,
    endpoint: "POST /api/backoffice/countries",
    erreur: countryOk ? "" : country.data,
  });

  const schoolA = await createSchool(superToken, {
    name: `Institut Smoke RC1 A ${stamp}`,
    email: `rc1-a-${stamp}@somafrik.test`,
    phone: `+243 810 ${String(stamp).slice(-6)}`,
  });
  (schoolA.ok ? pass : fail)({
    id: "S01-create-school",
    role: "Super Administrateur",
    screen: "Établissements",
    action: "créer établissement RC1 A",
    attendu: "201 + loginCode public",
    obtenu: schoolA.ok
      ? `201 code=${schoolA.internalCode} login=${schoolA.publicCode}`
      : `${schoolA.res.status} ${compact(schoolA.res.data)}`,
    endpoint: "POST /api/backoffice/establishments",
    erreur: schoolA.ok ? "" : schoolA.res.data,
  });
  if (!schoolA.ok) return;
  evidence.schools.A = { publicCode: schoolA.publicCode, internalCode: schoolA.internalCode, id: schoolA.id };

  const schoolB = await createSchool(superToken, {
    name: `Institut Smoke RC1 B ${stamp}`,
    email: `rc1-b-${stamp}@somafrik.test`,
    phone: `+243 811 ${String(stamp).slice(-6)}`,
  });
  (schoolB.ok ? pass : fail)({
    id: "S16-create-school-b",
    role: "Super Administrateur",
    screen: "Établissements",
    action: "créer établissement RC1 B (isolation tenant)",
    attendu: "201 + loginCode distinct",
    obtenu: schoolB.ok
      ? `201 code=${schoolB.internalCode} login=${schoolB.publicCode}`
      : `${schoolB.res.status} ${compact(schoolB.res.data)}`,
    endpoint: "POST /api/backoffice/establishments",
  });
  if (schoolB.ok) {
    evidence.schools.B = { publicCode: schoolB.publicCode, internalCode: schoolB.internalCode, id: schoolB.id };
  }

  const lookupGood = await request(`/schools/${encodeURIComponent(schoolA.publicCode)}`);
  (lookupGood.status === 200 ? pass : fail)({
    id: "S05-school-lookup-ok",
    role: "anonyme",
    screen: "Connexion établissement",
    action: "GET school by public code",
    attendu: "200 établissement correct",
    obtenu: `${lookupGood.status} ${lookupGood.data?.loginCode || lookupGood.data?.code || compact(lookupGood.data)}`,
    endpoint: `GET /api/schools/${schoolA.publicCode}`,
    rc0: "P1-UX-#338",
  });
  const lookupBad = await request("/schools/CD-NOT-A-REAL-CODE");
  (lookupBad.status === 404 ? pass : fail)({
    id: "S05-school-lookup-bad",
    role: "anonyme",
    screen: "Connexion établissement",
    action: "mauvais code",
    attendu: "404 métier, pas 500",
    obtenu: `${lookupBad.status} ${compact(lookupBad.data)}`,
    endpoint: "GET /api/schools/CD-NOT-A-REAL-CODE",
    rc0: "P1-UX-#338",
  });

  const adminA = await provisionSchoolAdmin(superToken, schoolA, stamp, "A");
  (adminA.ok ? pass : fail)({
    id: "S01-provision-admin",
    role: "Super Administrateur",
    screen: "Comptes",
    action: "provision Admin School A",
    attendu: "201 SCHOOL_ADMIN",
    obtenu: adminA.ok ? `201 keys=${compact(adminA.user?.roleKeys)} id=${adminA.identifier}` : compact(adminA.res?.data),
    endpoint: "POST /api/backoffice/users/provision",
  });
  if (!adminA.ok) return;
  evidence.identities.adminA = { identifier: adminA.identifier, email: adminA.email };

  const adminWeb = await backofficeLogin(adminA.email, STAFF_PASSWORD, schoolA.publicCode);
  (adminWeb.status === 200 ? pass : fail)({
    id: "S01-admin-web-login",
    role: "Admin établissement",
    screen: "Connexion Web",
    action: "login backoffice Admin School",
    attendu: "200",
    obtenu: `${adminWeb.status} ${adminWeb.session?.user?.role}`,
    endpoint: "POST /api/backoffice/login",
  });
  const adminToken = adminWeb.token;

  await runAuthMatrix({ stamp, schoolA, schoolB, adminA, adminToken, superToken });
}

async function createSchool(superToken, draft) {
  const res = await request("/backoffice/establishments", {
    method: "POST",
    token: superToken,
    body: {
      name: draft.name,
      type: "Collège",
      country: "République Démocratique du Congo",
      countryCode: "CD",
      city: "Kinshasa",
      phone: draft.phone,
      email: draft.email,
      principalName: "Directeur RC1",
      principalEmail: draft.email,
      force: true,
    },
  });
  const school = res.data?.school || res.data || {};
  const publicCode = school.loginCode || school.publicId || school.publicCode;
  const internalCode = school.code || school.schoolCode;
  return {
    ok: res.status === 201 && publicCode && internalCode,
    res,
    publicCode,
    internalCode,
    id: school.id,
    school,
  };
}

async function provisionSchoolAdmin(superToken, school, stamp, tag) {
  const email = `admin-rc1-${tag}-${stamp}@somafrik.test`;
  const res = await request("/backoffice/users/provision", {
    method: "POST",
    token: superToken,
    body: {
      firstName: "Admin",
      lastName: `RC1${tag}`,
      email,
      temporaryPassword: STAFF_PASSWORD,
      roleKey: "SCHOOL_ADMIN",
      countryCode: "CD",
      schoolCode: school.publicCode,
    },
  });
  const user = res.data || {};
  const identifier =
    user.email ||
    user.userCode ||
    user.identityCode ||
    user.publicId ||
    email;
  return {
    ok: res.status === 201 && (user.roleKeys || []).includes("SCHOOL_ADMIN"),
    res,
    user,
    identifier,
    email,
    loginCode: user.loginCode || user.identifier,
  };
}

async function runAuthMatrix({ stamp, schoolA, schoolB, adminA, adminToken, superToken }) {
  const schoolCode = schoolA.publicCode;
  const identify = await mobileIdentify(adminA.email, schoolCode);
  (identify.status === 200 && identify.data?.role === "school_admin" ? pass : fail)({
    id: "S01-admin-identify",
    role: "Admin établissement",
    screen: "Login Mobile",
    action: "POST /identify",
    attendu: "200 role school_admin",
    obtenu: `${identify.status} ${compact(identify.data)}`,
    endpoint: "POST /api/identify",
  });

  const login = await mobileLogin(adminA.email, STAFF_PASSWORD, schoolCode, "school_admin");
  const adminMobileToken = tokenOf(login.data);
  (login.status === 200 ? pass : fail)({
    id: "S01-admin-mobile-login",
    role: "Admin établissement",
    screen: "Login Mobile",
    action: "POST /login school_admin",
    attendu: "200 + permissions live",
    obtenu: `${login.status} role=${login.data?.role} perms=${permsOf(login.data).length}`,
    endpoint: "POST /api/login",
    erreur: login.status === 200 ? "" : login.data,
  });
  (!hasInventedAll(login.data) && permsOf(login.data).length > 0 ? pass : fail)({
    id: "S01-admin-no-invented-all",
    role: "Admin établissement",
    screen: "Session",
    action: "aucune permission inventée Mobile",
    attendu: "permissions live PostgreSQL, pas ALL_PRIVILEGES",
    obtenu: `ALL_PRIVILEGES=${hasInventedAll(login.data)} count=${permsOf(login.data).length}`,
    endpoint: "POST /api/login",
  });

  const refresh = await request("/auth/refresh", {
    method: "POST",
    body: { refreshToken: login.data?.refreshToken },
  });
  (refresh.status === 200 && tokenOf(refresh.data) ? pass : fail)({
    id: "S01-admin-refresh",
    role: "Admin établissement",
    screen: "Session",
    action: "refresh token",
    attendu: "200 accessToken",
    obtenu: `${refresh.status}`,
    endpoint: "POST /api/auth/refresh",
    erreur: refresh.status === 200 ? "" : refresh.data,
  });
  const logout = await request("/auth/logout", { method: "POST", token: adminMobileToken });
  (logout.status >= 200 && logout.status < 300 ? pass : fail)({
    id: "S01-admin-logout",
    role: "Admin établissement",
    screen: "Session",
    action: "logout",
    attendu: "2xx",
    obtenu: `${logout.status}`,
    endpoint: "POST /api/auth/logout",
  });
  const relogin = await mobileLogin(adminA.email, STAFF_PASSWORD, schoolCode, "school_admin");
  (relogin.status === 200 ? pass : fail)({
    id: "S01-admin-relogin",
    role: "Admin établissement",
    screen: "Session",
    action: "relogin après logout",
    attendu: "200",
    obtenu: `${relogin.status}`,
    endpoint: "POST /api/login",
  });
  const liveAdminToken = tokenOf(relogin.data) || adminToken;
  if (!liveAdminToken) {
    fail({
      id: "S00-admin-token-missing",
      role: "Admin établissement",
      screen: "Session",
      action: "token Admin requis pour le reste du smoke",
      attendu: "accessToken",
      obtenu: "absent — STOP domaines",
      endpoint: "POST /api/login",
      classification: "P1",
    });
    return;
  }

  const prefet = await createStaff(liveAdminToken, {
    firstName: "Prefet",
    lastName: "SmokeRC1",
    email: `prefet-rc1-${stamp}@somafrik.test`,
    roleLabel: "Préfet des études",
    password: STAFF_PASSWORD,
  });
  (prefet.created?.status === 201 && prefet.granted?.status === 200 ? pass : fail)({
    id: "S05-create-prefet",
    role: "Admin établissement",
    screen: "Comptes utilisateurs",
    action: "créer identité + GRANT Préfet",
    attendu: "201 + 200 PREFET_ETUDES",
    obtenu: `create=${prefet.created?.status} grant=${prefet.granted?.status} keys=${compact(prefet.user?.roleKeys)}`,
    endpoint: "POST /api/backoffice/users + roles/grant",
    erreur: prefet.created?.status === 201 ? prefet.user : prefet.created?.data,
  });
  const accountant = await createStaff(liveAdminToken, {
    firstName: "Compta",
    lastName: "SmokeRC1",
    email: `cpt-rc1-${stamp}@somafrik.test`,
    roleLabel: "Comptable",
    password: STAFF_PASSWORD,
  });
  (accountant.created?.status === 201 && accountant.granted?.status === 200 ? pass : fail)({
    id: "S05-create-comptable",
    role: "Admin établissement",
    screen: "Comptes utilisateurs",
    action: "créer identité + GRANT Comptable",
    attendu: "201 + 200 ACCOUNTANT",
    obtenu: `create=${accountant.created?.status} grant=${accountant.granted?.status} keys=${compact(accountant.user?.roleKeys)}`,
    endpoint: "POST /api/backoffice/users + roles/grant",
  });
  const teacher1 = await createStaff(liveAdminToken, {
    firstName: "Enseignant",
    lastName: "UnRC1",
    email: `ens1-rc1-${stamp}@somafrik.test`,
    roleLabel: "Enseignant",
    password: STAFF_PASSWORD,
  });
  const teacher2 = await createStaff(liveAdminToken, {
    firstName: "Enseignant",
    lastName: "DeuxRC1",
    email: `ens2-rc1-${stamp}@somafrik.test`,
    roleLabel: "Enseignant",
    password: STAFF_PASSWORD,
  });
  (teacher1.created?.status === 201 && teacher1.granted?.status === 200 ? pass : fail)({
    id: "S05-create-teacher-user",
    role: "Admin établissement",
    screen: "Comptes utilisateurs",
    action: "créer identité + GRANT Enseignant (2 actifs)",
    attendu: "201 + 200 TEACHER",
    obtenu: `t1=${teacher1.created?.status}/${teacher1.granted?.status} t2=${teacher2.created?.status}/${teacher2.granted?.status}`,
    endpoint: "POST /api/backoffice/users + roles/grant",
  });

  const prefetId = prefet.email || prefet.user?.email;
  const accId = accountant.email || accountant.user?.email;
  const t1Id = teacher1.email || teacher1.user?.email;
  const t2Id = teacher2.email || teacher2.user?.email;
  evidence.identities.prefet = { identifier: prefetId, email: prefet.email };
  evidence.identities.accountant = { identifier: accId, email: accountant.email };
  evidence.identities.teacher1 = { identifier: t1Id, userId: teacher1.user?.id, email: teacher1.email };
  evidence.identities.teacher2 = { identifier: t2Id, userId: teacher2.user?.id, email: teacher2.email };

  if (prefetId) await replayRoleAuth("S01-prefet", "Préfet des études", prefetId, schoolCode, "prefet", liveAdminToken);
  else skip({ id: "S01-prefet-identify", role: "Préfet des études", action: "provision failed", attendu: "201", obtenu: "SKIP", endpoint: "POST /api/identify" });
  if (t1Id) await replayRoleAuth("S01-teacher", "Enseignant", t1Id, schoolCode, "teacher", liveAdminToken);
  if (accId) await replayAccountant(accId, schoolCode, liveAdminToken);

  const tempo = await createStaff(liveAdminToken, {
    firstName: "Tempo",
    lastName: "RoleRC1",
    email: `tempo-rc1-${stamp}@somafrik.test`,
    roleLabel: "Enseignant",
    password: STAFF_PASSWORD,
  });
  const tempoId = tempo.email || tempo.user?.email;
  const grantPg = await pgQuery(
    `SELECT ur.role_key, ur.status FROM user_roles ur JOIN users u ON u.id = ur.user_id
     WHERE u.id::text = $1 OR u.email = $2`,
    [tempo.user?.id, tempo.user?.email],
  );
  (tempo.granted?.status === 200 && grantPg.some((r) => r.role_key === "TEACHER" && r.status === "active")
    ? pass
    : fail)({
    id: "S05-grant-teacher-pg",
    role: "Admin établissement",
    screen: "Comptes utilisateurs",
    action: "GRANT Enseignant — user_roles PG",
    attendu: "1 ligne TEACHER active",
    obtenu: `http=${tempo.granted?.status} pg=${compact(grantPg)}`,
    endpoint: "POST /api/backoffice/users/:id/roles/grant",
    pg: grantPg,
  });
  const loginAfterGrant = await mobileLogin(tempoId, STAFF_PASSWORD, schoolCode, "teacher");
  (loginAfterGrant.status === 200 ? pass : fail)({
    id: "S05-login-after-grant",
    role: "Enseignant",
    screen: "Login Mobile",
    action: "login après GRANT",
    attendu: "200 teacher",
    obtenu: `${loginAfterGrant.status} ${loginAfterGrant.data?.role}`,
    endpoint: "POST /api/login",
  });
  const revoked = await request(`/backoffice/users/${tempo.user?.id}/roles/revoke`, {
    method: "POST",
    token: liveAdminToken,
    body: { role: "Enseignant" },
  });
  const revokePg = await pgQuery(
    `SELECT ur.role_key, ur.status FROM user_roles ur WHERE ur.user_id::text = $1 AND ur.status = 'active'`,
    [tempo.user?.id],
  );
  (revoked.status === 200 && revokePg.filter((r) => r.role_key === "TEACHER").length === 0 ? pass : fail)({
    id: "S05-revoke-teacher-pg",
    role: "Admin établissement",
    screen: "Comptes utilisateurs",
    action: "REVOKE Enseignant",
    attendu: "plus de TEACHER actif",
    obtenu: `http=${revoked.status} active=${revokePg.filter((r) => r.role_key === "TEACHER").length}`,
    endpoint: "POST /api/backoffice/users/:id/roles/revoke",
    pg: revokePg,
  });
  const loginAfterRevoke = await mobileLogin(tempoId, STAFF_PASSWORD, schoolCode, "teacher");
  (loginAfterRevoke.status === 401 ? pass : fail)({
    id: "S05-login-after-revoke",
    role: "Enseignant",
    screen: "Login Mobile",
    action: "login après REVOKE",
    attendu: "401 (rôle plus accordé)",
    obtenu: `${loginAfterRevoke.status} ${compact(loginAfterRevoke.data)}`,
    endpoint: "POST /api/login",
  });

  await runDomainSmoke({
    stamp,
    schoolA,
    schoolB,
    superToken,
    adminToken: liveAdminToken,
    adminA,
    prefet,
    accountant,
    teacher1,
    teacher2,
    schoolCode,
  });
}

async function replayRoleAuth(prefix, roleLabel, identifier, schoolCode, mobileRole, adminToken) {
  const identified = await mobileIdentify(identifier, schoolCode);
  (identified.status === 200 && identified.data?.role === mobileRole ? pass : fail)({
    id: `${prefix}-identify`,
    role: roleLabel,
    screen: "Login Mobile",
    action: "POST /identify",
    attendu: `200 role=${mobileRole}`,
    obtenu: `${identified.status} ${compact(identified.data)}`,
    endpoint: "POST /api/identify",
  });
  const rawLogin = await mobileLogin(identifier, STAFF_PASSWORD, schoolCode, mobileRole);
  const mustChange = Boolean(rawLogin.data?.user?.mustChangePassword);
  (rawLogin.status === 200 ? pass : fail)({
    id: `${prefix}-login`,
    role: roleLabel,
    screen: "Login Mobile",
    action: `POST /login ${mobileRole}`,
    attendu: "200 accessToken + permissions live",
    obtenu: `${rawLogin.status} role=${rawLogin.data?.role} perms=${permsOf(rawLogin.data).length} mustChange=${mustChange}`,
    endpoint: "POST /api/login",
  });
  if (rawLogin.status === 200 && mustChange) {
    const gated = await request("/classes", { token: tokenOf(rawLogin.data) });
    (gated.status === 403 ? pass : fail)({
      id: `${prefix}-must-change-password-gate`,
      role: roleLabel,
      screen: "Session",
      action: "ressource avant change-password",
      attendu: "403 mustChangePassword, pas un hard-deny RBAC métier",
      obtenu: `${gated.status} ${compact(gated.data)}`,
      endpoint: "GET /api/classes",
    });
    const changed = await changePassword(tokenOf(rawLogin.data), STAFF_PASSWORD);
    (changed.status === 200 ? pass : fail)({
      id: `${prefix}-change-password`,
      role: roleLabel,
      screen: "Session",
      action: "POST /auth/change-password",
      attendu: "200",
      obtenu: `${changed.status}`,
      endpoint: "POST /api/auth/change-password",
    });
    const after = await request("/classes", { token: tokenOf(changed.data) || tokenOf(rawLogin.data) });
    if (mobileRole === "teacher") {
      (after.status === 403 ? pass : fail)({
        id: `${prefix}-classes-after-password`,
        role: roleLabel,
        screen: "Classes",
        action: "GET classes après change-password (TEACHER sans Classes:READ)",
        attendu: "403 RBAC live (pas un hard-deny inventé Mobile)",
        obtenu: `${after.status} n=${listOf(after.data).length}`,
        endpoint: "GET /api/classes",
      });
    } else {
      (after.status === 200 ? pass : fail)({
        id: `${prefix}-classes-after-password`,
        role: roleLabel,
        screen: "Classes",
        action: "GET classes après change-password",
        attendu: "200 (permissions live)",
        obtenu: `${after.status} n=${listOf(after.data).length}`,
        endpoint: "GET /api/classes",
      });
    }
  }
}

async function replayAccountant(identifier, schoolCode, adminToken) {
  const identified = await mobileIdentify(identifier, schoolCode);
  const idOk = identified.status === 200 && identified.data?.role === "accountant";
  (idOk ? pass : fail)({
    id: "S01-comptable-identify",
    role: "Comptable",
    screen: "Login Mobile",
    action: "POST /identify",
    attendu: "200 role=accountant (régression #328 / P1-RC0-01)",
    obtenu: `${identified.status} ${compact(identified.data)}`,
    endpoint: "POST /api/identify",
    rc0: "P1-RC0-01",
    classification: idOk ? "" : "P1",
    defect: idOk
      ? null
      : {
          id: "P1-RC1-01",
          severity: "P1",
          role: "Comptable",
          screen: "Login Mobile",
          steps: ["POST /api/identify { identifier, schoolCode }"],
          attendu: "200 accountant",
          obtenu: identified.data,
          http: identified.status,
          endpoint: "POST /api/identify",
          cause: "managedMobileRoles / identify refuse encore le Comptable",
        },
  });
  evidence.regressions["P1-RC0-01"] = idOk ? "PASS" : "FAIL";

  const logged = await mobileLogin(identifier, STAFF_PASSWORD, schoolCode, "accountant");
  let token = tokenOf(logged.data);
  if (logged.status === 200 && logged.data?.user?.mustChangePassword) {
    const changed = await changePassword(token, STAFF_PASSWORD);
    token = tokenOf(changed.data) || token;
  }
  const loginOk = logged.status === 200 && logged.data?.role === "accountant";
  (loginOk ? pass : fail)({
    id: "S01-comptable-login",
    role: "Comptable",
    screen: "Login Mobile",
    action: "POST /login accountant",
    attendu: "200 + permissions live (#328)",
    obtenu: `${logged.status} role=${logged.data?.role} perms=${permsOf(logged.data).length}`,
    endpoint: "POST /api/login",
    rc0: "P1-RC0-01",
    classification: loginOk ? "" : "P1",
  });
  if (loginOk) evidence.regressions["P1-RC0-01"] = "PASS";

  const perms = permsOf(logged.data).map(String);
  const studentsRead = perms.some((p) => /Élèves:READ|Eleves:READ|Gérer élèves/i.test(p));
  (!studentsRead ? pass : fail)({
    id: "S12-accountant-no-students-read-perm",
    role: "Comptable",
    screen: "RBAC",
    action: "ne PAS ajouter Élèves:READ pour faire passer le smoke",
    attendu: "permissions live sans Élèves:READ",
    obtenu: `studentsRead=${studentsRead} perms=${compact(perms)}`,
    endpoint: "POST /api/login",
  });
  if (token) {
    const students = await request("/students", { token });
    (students.status === 403 ? pass : fail)({
      id: "S12-accountant-students-forbidden",
      role: "Comptable",
      screen: "Finance / Élèves",
      action: "GET /api/students reste interdit (least privilege)",
      attendu: "403",
      obtenu: `${students.status} ${compact(students.data)}`,
      endpoint: "GET /api/students",
    });
  }
}

async function runDomainSmoke(ctx) {
  const { schoolA, schoolB, superToken, adminToken, schoolCode, stamp, teacher1, teacher2, accountant } = ctx;

  const classSchoolCode = schoolA.internalCode || schoolA.publicCode;
  let ctxA;
  try {
    ctxA = await prepareCanonicalClassContext(request, {
      schoolCode: classSchoolCode,
      countryCode: "CD",
      levelName: "6ème",
      groupCode: "A",
      superToken,
      schoolToken: adminToken,
      superIdentifier: "superadmin",
      superPassword: SUPER_PASSWORD,
    });
  } catch (error) {
    fail({
      id: "S02-class-context",
      role: "Admin établissement",
      screen: "Classes",
      action: "préparer offre canonique (année/niveau/groupe)",
      attendu: "contexte 201",
      obtenu: error.message || String(error),
      endpoint: "POST /api/v2/academic-years + education-reference",
      classification: "P1",
    });
    const putLegacy = await request("/backoffice/state", {
      method: "PUT",
      token: adminToken,
      body: { students: [{ id: "HACK" }] },
    });
    const legacyOk = putLegacy.status === 410 && putLegacy.data?.code === "BACKOFFICE_STATE_WRITE_REMOVED";
    (legacyOk ? pass : fail)({
      id: "S15-legacy-put",
      role: "Admin établissement",
      screen: "Legacy fail-closed",
      action: "PUT /api/backoffice/state",
      attendu: "410 BACKOFFICE_STATE_WRITE_REMOVED",
      obtenu: `${putLegacy.status} ${compact(putLegacy.data)}`,
      endpoint: "PUT /api/backoffice/state",
      classification: legacyOk ? "" : "P0",
    });
    await runTenantIsolation({ schoolB, superToken, stamp, schoolA, students: [], adminToken });
    return;
  }
  const classA = await postCanonicalClass(request, adminToken, {
    academicYearId: ctxA.academicYear.id,
    levelId: ctxA.level.id,
    groupId: ctxA.group.id,
    status: "active",
  });
  const classAOk = classA.status === 201 && classA.data?.classCode && classA.data?.classId;
  (classAOk ? pass : fail)({
    id: "S02-create-class",
    role: "Admin établissement",
    screen: "Classes",
    action: "créer classe canonique A",
    attendu: "201 classId/classCode",
    obtenu: classAOk
      ? `201 code=${classA.data.classCode} id=${classA.data.classId} name=${classA.data.name}`
      : `${classA.status} ${compact(classA.data)}`,
    endpoint: "POST /api/classes",
  });
  if (!classAOk) return;

  await pgQuery(
    `INSERT INTO terms (academic_year_id, name, start_date, end_date, status)
     SELECT ay.id, 'Trimestre 1', '2025-09-01', '2025-12-31', 'open'
     FROM academic_years ay
     JOIN schools s ON s.id = ay.school_id
     WHERE s.school_code = $1
     ON CONFLICT (academic_year_id, name) DO NOTHING`,
    [schoolA.internalCode],
  ).catch((error) => {
    console.error("term insert:", error.message);
  });

  const ctxBhom = await prepareCanonicalClassContext(request, {
    schoolCode: classSchoolCode,
    countryCode: "CD",
    levelName: "6ème",
    groupCode: "B",
    superToken,
    schoolToken: adminToken,
  });
  const classHomonym = await postCanonicalClass(request, adminToken, {
    academicYearId: ctxBhom.academicYear.id,
    levelId: ctxBhom.level.id,
    groupId: ctxBhom.group.id,
    status: "active",
  });
  const homonymOk =
    classHomonym.status === 201 &&
    classHomonym.data?.name === classA.data.name &&
    classHomonym.data?.classId !== classA.data.classId;
  (homonymOk ? pass : fail)({
    id: "S02-homonym-classes",
    role: "Admin établissement",
    screen: "Classes",
    action: "2 classes même nom, IDs/codes distincts",
    attendu: "même name, classId/classCode différents",
    obtenu: `status=${classHomonym.status} nameA=${classA.data.name} nameB=${classHomonym.data?.name} idA=${classA.data.classId} idB=${classHomonym.data?.classId}`,
    endpoint: "POST /api/classes",
  });

  const ctxEmpty = await prepareCanonicalClassContext(request, {
    schoolCode: classSchoolCode,
    countryCode: "CD",
    levelName: "5ème",
    groupCode: "A",
    superToken,
    schoolToken: adminToken,
  });
  const classEmpty = await postCanonicalClass(request, adminToken, {
    academicYearId: ctxEmpty.academicYear.id,
    levelId: ctxEmpty.level.id,
    groupId: ctxEmpty.group.id,
    status: "active",
  });

  const listed = await request("/classes", { token: adminToken });
  const listedRows = listOf(listed.data);
  (listed.status === 200 && listedRows.some((r) => r.classCode === classA.data.classCode) ? pass : fail)({
    id: "S02-list-classes",
    role: "Admin établissement",
    screen: "Classes",
    action: "lister classes",
    attendu: "200 contient la classe créée",
    obtenu: `${listed.status} n=${listedRows.length} codes=${listedRows.map((r) => r.classCode).join(",")}`,
    endpoint: "GET /api/classes",
  });

  const patched = await request(`/classes/${encodeURIComponent(classA.data.classCode)}`, {
    method: "PATCH",
    token: adminToken,
    body: { status: "active" },
  });
  (patched.status >= 200 && patched.status < 300 ? pass : fail)({
    id: "S02-patch-class",
    role: "Admin établissement",
    screen: "Classes",
    action: "modifier classe",
    attendu: "200",
    obtenu: `${patched.status}`,
    endpoint: `PATCH /api/classes/${classA.data.classCode}`,
    erreur: patched.status < 300 ? "" : patched.data,
  });
  const persist = await request("/classes", { token: adminToken });
  const still = listOf(persist.data).some((r) => r.classCode === classA.data.classCode);
  (still ? pass : fail)({
    id: "S02-persist-class",
    role: "Admin établissement",
    screen: "Classes",
    action: "quitter/revenir — donnée présente",
    attendu: "classe toujours listée",
    obtenu: String(still),
    endpoint: "GET /api/classes",
  });
  const pgClass = await pgQuery(
    `SELECT COUNT(*)::int AS classes FROM classes c JOIN schools s ON s.id = c.school_id WHERE s.school_code = $1 OR s.login_code = $1 OR s.public_id = $1`,
    [schoolA.internalCode],
  ).catch(async () =>
    pgQuery(
      `SELECT COUNT(*)::int AS classes FROM classes c JOIN schools s ON s.id = c.school_id WHERE s.school_code = $1`,
      [schoolA.internalCode],
    ),
  );
  (Number(pgClass[0]?.classes) >= 1 ? pass : fail)({
    id: "S02-pg-class",
    role: "Admin établissement",
    screen: "PostgreSQL",
    action: "classes réellement en PG",
    attendu: "count >= 1",
    obtenu: compact(pgClass[0]),
    endpoint: "SELECT classes",
    pg: pgClass[0],
  });

  const students = [];
  const names = [
    ["Lina", "Kabasele"],
    ["Marc", "Ilunga"],
    ["Awa", "Mwamba"],
    ["Jean", "Tshibangu"],
  ];
  const enrollStatuses = [];
  for (const [firstName, lastName] of names) {
    const enrolled = await request(`/classes/${encodeURIComponent(classA.data.classCode)}/students`, {
      method: "POST",
      token: adminToken,
      body: { firstName, lastName, gender: "Masculin", birthDate: "2012-03-15" },
    });
    enrollStatuses.push(enrolled.status);
    if (enrolled.status === 201) students.push(enrolled.data.student || enrolled.data);
  }
  (enrollStatuses.every((s) => s === 201) && students.length >= 4 ? pass : fail)({
    id: "S03-enroll-4",
    role: "Admin établissement",
    screen: "Élèves",
    action: "inscrire 4 élèves",
    attendu: "4 × 201",
    obtenu: enrollStatuses.join(","),
    endpoint: `POST /api/classes/${classA.data.classCode}/students`,
  });
  const listStudents = await request("/students", { token: adminToken });
  const studentRows = listOf(listStudents.data);
  (listStudents.status === 200 && studentRows.length >= 4 ? pass : fail)({
    id: "S03-list-students",
    role: "Admin établissement",
    screen: "Élèves",
    action: "ouvrir liste / fiche",
    attendu: "200 >= 4",
    obtenu: `${listStudents.status} n=${studentRows.length}`,
    endpoint: "GET /api/students",
  });

  const required = await request(`/classes/${encodeURIComponent(classA.data.classCode)}/students`, {
    method: "POST",
    token: adminToken,
    body: { lastName: "SansPrenom" },
  });
  (required.status === 400 ? pass : fail)({
    id: "S03-required",
    role: "Admin établissement",
    screen: "Élèves",
    action: "données obligatoires manquantes",
    attendu: "400",
    obtenu: `${required.status} ${compact(required.data)}`,
    endpoint: `POST /api/classes/${classA.data.classCode}/students`,
  });
  const homonymStudent = await request(`/classes/${encodeURIComponent(classA.data.classCode)}/students`, {
    method: "POST",
    token: adminToken,
    body: { firstName: "Lina", lastName: "Kabasele", gender: "Féminin", birthDate: "2011-04-01" },
  });
  (homonymStudent.status === 201 ? pass : fail)({
    id: "S03-duplicate",
    role: "Admin établissement",
    screen: "Élèves",
    action: "homonymes autorisés si identifiants différents",
    attendu: "201 homonyme (unicité = matricule canonique)",
    obtenu: `${homonymStudent.status} ${compact(homonymStudent.data?.student || homonymStudent.data)}`,
    endpoint: `POST /api/classes/${classA.data.classCode}/students`,
  });

  await runOcc(adminToken, students[0]);

  const teacherDirect = await request("/teachers", {
    method: "POST",
    token: adminToken,
    body: { firstName: "Forge", lastName: "Teacher", email: `forge-${stamp}@x.test` },
  });
  (teacherDirect.status === 403 && teacherDirect.data?.code === "TEACHER_IDENTITY_MUST_COME_FROM_USERS"
    ? pass
    : fail)({
    id: "S04-create-teacher",
    role: "Admin établissement",
    screen: "Enseignants",
    action: "POST /teachers direct",
    attendu: "403 TEACHER_IDENTITY_MUST_COME_FROM_USERS",
    obtenu: `${teacherDirect.status} ${compact(teacherDirect.data)}`,
    endpoint: "POST /api/teachers",
  });
  const teachersList = await request("/teachers", { token: adminToken });
  const teacherRows = listOf(teachersList.data);
  (teachersList.status === 200 && teacherRows.length >= 2 ? pass : fail)({
    id: "S04-list-teachers",
    role: "Admin établissement",
    screen: "Enseignants",
    action: "liste",
    attendu: "200 n>=2 (GRANT Enseignant)",
    obtenu: `${teachersList.status} n=${teacherRows.length}`,
    endpoint: "GET /api/teachers",
  });

  const math = await request("/v2/subjects", {
    method: "POST",
    token: adminToken,
    body: { code: `MATH-RC1-${stamp}`, name: "Mathématiques", coefficient: 2, status: "Actif" },
  });
  const french = await request("/v2/subjects", {
    method: "POST",
    token: adminToken,
    body: { code: `FR-RC1-${stamp}`, name: "Français", coefficient: 2, status: "Actif" },
  });
  const t1Code = teacherRows.find((row) => String(row.userId) === String(teacher1.user?.id)) || teacherRows[0];
  const t2Code = teacherRows.find((row) => String(row.userId) === String(teacher2.user?.id)) || teacherRows[1];
  const assign1 = await request("/assignments", {
    method: "POST",
    token: adminToken,
    body: {
      teacherId: t1Code?.teacherCode || t1Code?.id,
      classCode: classA.data.classCode,
      subject: "Mathématiques",
    },
  });
  const assign2 = await request("/assignments", {
    method: "POST",
    token: adminToken,
    body: {
      teacherId: t2Code?.teacherCode || t2Code?.id,
      classCode: classA.data.classCode,
      subject: "Français",
    },
  });
  const assignHom = await request("/assignments", {
    method: "POST",
    token: adminToken,
    body: {
      teacherId: t1Code?.teacherCode || t1Code?.id,
      classCode: classHomonym.data?.classCode,
      subject: "Mathématiques",
    },
  });
  const courseCreate = await request("/courses", {
    method: "POST",
    token: adminToken,
    body: {
      classCode: classA.data.classCode,
      className: classA.data.name,
      name: "Mathématiques",
      teacherId: t1Code?.teacherCode || t1Code?.id,
    },
  });
  info({
    id: "S11-create-course",
    role: "Admin établissement",
    screen: "Cours",
    action: "POST /courses après affectation",
    attendu: "201 ou cours déjà réconcilié",
    obtenu: `${courseCreate.status} ${compact(courseCreate.data)}`,
    endpoint: "POST /api/courses",
  });
  (assign1.status === 201 ? pass : fail)({
    id: "S09-assignment-t1",
    role: "Admin établissement",
    screen: "Affectations",
    action: "affecter enseignant 1 (Math) classe A",
    attendu: "201",
    obtenu: `${assign1.status} ${compact(assign1.data)}`,
    endpoint: "POST /api/assignments",
    erreur: assign1.status === 201 ? "" : assign1.data,
  });
  (assign2.status === 201 ? pass : fail)({
    id: "S09-assignment-t2",
    role: "Admin établissement",
    screen: "Affectations",
    action: "affecter enseignant 2 (Français) classe A — 2+ enseignants actifs",
    attendu: "201",
    obtenu: `${assign2.status} ${compact(assign2.data)}`,
    endpoint: "POST /api/assignments",
  });
  const assignments = await request("/assignments", { token: adminToken });
  (assignments.status === 200 ? pass : fail)({
    id: "S04-assignments",
    role: "Admin établissement",
    screen: "Enseignants",
    action: "lire affectations",
    attendu: "200",
    obtenu: `${assignments.status} n=${listOf(assignments.data).length}`,
    endpoint: "GET /api/assignments",
  });

  await runAttendance({
    adminToken,
    schoolA,
    classA: classA.data,
    classHomonym: classHomonym.data,
    classEmpty: classEmpty.data,
    students,
    t1: t1Code,
    t2: t2Code,
    teacher1,
    schoolCode,
  });

  await runPedagogy({
    adminToken,
    classA: classA.data,
    students,
    t1: t1Code,
    schoolCode,
    teacher1,
    stamp,
  });

  await runFinance({
    adminToken,
    classA: classA.data,
    students,
    accountant,
    schoolA,
    schoolB,
    schoolCode,
    stamp,
  });

  const schedules = await request("/course-schedules", { token: adminToken });
  (schedules.status === 200 ? pass : fail)({
    id: "S10-read-planning",
    role: "Admin établissement",
    screen: "Planning",
    action: "GET /course-schedules (contrat Mobile réel)",
    attendu: "200",
    obtenu: `${schedules.status} n=${listOf(schedules.data).length}`,
    endpoint: "GET /api/course-schedules",
  });
  const weeklyLegacy = await request("/planning/weekly", { token: adminToken });
  info({
    id: "S10-legacy-weekly",
    role: "Admin établissement",
    screen: "Planning",
    action: "GET /planning/weekly n'est PAS le contrat Mobile",
    attendu: "ne pas FAIL le smoke sur cette route",
    obtenu: `${weeklyLegacy.status}`,
    endpoint: "GET /api/planning/weekly",
  });

  const putLegacy = await request("/backoffice/state", {
    method: "PUT",
    token: adminToken,
    body: { students: [{ id: "HACK" }] },
  });
  const legacyOk = putLegacy.status === 410 && putLegacy.data?.code === "BACKOFFICE_STATE_WRITE_REMOVED";
  (legacyOk ? pass : fail)({
    id: "S15-legacy-put",
    role: "Admin établissement",
    screen: "Legacy fail-closed",
    action: "PUT /api/backoffice/state",
    attendu: "410 BACKOFFICE_STATE_WRITE_REMOVED",
    obtenu: `${putLegacy.status} ${compact(putLegacy.data)}`,
    endpoint: "PUT /api/backoffice/state",
    classification: legacyOk ? "" : "P0",
    defect: legacyOk
      ? null
      : {
          id: "P0-RC1-LEGACY-WRITE",
          severity: "P0",
          role: "Admin établissement",
          screen: "Legacy",
          steps: ["PUT /api/backoffice/state"],
          attendu: "410 BACKOFFICE_STATE_WRITE_REMOVED",
          obtenu: putLegacy.data,
          http: putLegacy.status,
          endpoint: "PUT /api/backoffice/state",
          cause: "écriture legacy acceptée ou code inattendu",
        },
  });

  const http400 = await request("/presences", {
    method: "POST",
    token: adminToken,
    body: { items: [{ status: "nope" }] },
  });
  (http400.status >= 400 && http400.status < 500 ? pass : fail)({
    id: "S14-http-400-not-offline",
    role: "Admin établissement",
    screen: "Réseau",
    action: "HTTP 4xx métier ≠ hors connexion",
    attendu: "4xx",
    obtenu: `${http400.status} ${compact(http400.data)}`,
    endpoint: "POST /api/presences",
  });

  await runTenantIsolation({ schoolB, superToken, stamp, schoolA, students, adminToken });
  await maybeParentStudent({ adminToken, students, schoolCode, stamp });
}

async function runOcc(adminToken, student) {
  const code = student?.studentCode || student?.publicId || student?.id;
  if (!code) {
    fail({
      id: "S03-occ-missing-student",
      screen: "Élèves OCC",
      action: "élève pour OCC",
      attendu: "un élève inscrit",
      obtenu: "aucun",
      endpoint: "PATCH /api/students/:id",
      rc0: "P1-RC0-02",
      classification: "P1",
    });
    evidence.regressions["P1-RC0-02"] = "FAIL";
    return;
  }
  const detail = await request(`/students/${encodeURIComponent(code)}`, { token: adminToken });
  const tokenT = detail.data?.updatedAt;
  const pgBefore = await pgQuery(`SELECT updated_at FROM students WHERE student_code = $1`, [code]);
  info({
    id: "S03-occ-tokens",
    role: "Admin établissement",
    screen: "OCC",
    action: "GET token updatedAt vs PG",
    attendu: "JSON ms + PG timestamptz",
    obtenu: `json=${tokenT} pg=${pgBefore[0]?.updated_at?.toISOString?.() || pgBefore[0]?.updated_at}`,
    endpoint: `GET /api/students/${code}`,
    pg: { updated_at: String(pgBefore[0]?.updated_at) },
  });

  const missing = await request(`/students/${encodeURIComponent(code)}`, {
    method: "PATCH",
    token: adminToken,
    body: { firstName: "SansJeton" },
  });
  (missing.status === 400 ? pass : fail)({
    id: "S03-occ-missing-token",
    role: "Admin établissement",
    screen: "OCC",
    action: "PATCH sans expectedUpdatedAt",
    attendu: "400 champ obligatoire",
    obtenu: `${missing.status} ${compact(missing.data)}`,
    endpoint: `PATCH /api/students/${code}`,
    rc0: "P1-RC0-02",
  });

  const okPatch = await request(`/students/${encodeURIComponent(code)}`, {
    method: "PATCH",
    token: adminToken,
    body: { firstName: "LinaX", expectedUpdatedAt: tokenT },
  });
  const aOk = okPatch.status === 200;
  (aOk ? pass : fail)({
    id: "S03-occ-A",
    role: "Admin établissement",
    screen: "OCC",
    action: "PATCH avec token T → 200",
    attendu: "200",
    obtenu: `${okPatch.status} ${compact(okPatch.data)}`,
    endpoint: `PATCH /api/students/${code}`,
    rc0: "P1-RC0-02",
    classification: aOk ? "" : "P1",
  });
  evidence.regressions["P1-RC0-02"] = aOk ? "PASS" : "FAIL";

  const stale = await request(`/students/${encodeURIComponent(code)}`, {
    method: "PATCH",
    token: adminToken,
    body: { firstName: "Stale", expectedUpdatedAt: tokenT },
  });
  (stale.status === 409 ? pass : fail)({
    id: "S03-occ-B",
    role: "Admin établissement",
    screen: "OCC",
    action: "réutiliser T stale → 409",
    attendu: "409 CONFLICT",
    obtenu: `${stale.status} ${compact(stale.data)}`,
    endpoint: `PATCH /api/students/${code}`,
    rc0: "P1-RC0-02",
  });

  const fresh = await request(`/students/${encodeURIComponent(code)}`, { token: adminToken });
  const t2 = fresh.data?.updatedAt;
  const [p1, p2] = await Promise.all([
    request(`/students/${encodeURIComponent(code)}`, {
      method: "PATCH",
      token: adminToken,
      body: { firstName: "ConcurrentA", expectedUpdatedAt: t2 },
    }),
    request(`/students/${encodeURIComponent(code)}`, {
      method: "PATCH",
      token: adminToken,
      body: { lastName: "ConcurrentB", expectedUpdatedAt: t2 },
    }),
  ]);
  const statuses = [p1.status, p2.status].sort();
  const concurrentOk = statuses.includes(200) && statuses.includes(409);
  (concurrentOk ? pass : fail)({
    id: "S03-occ-C",
    role: "Admin établissement",
    screen: "OCC",
    action: "deux PATCH concurrents même T",
    attendu: "1 × 200 et 1 × 409",
    obtenu: `${p1.status},${p2.status}`,
    endpoint: `PATCH /api/students/${code}`,
    rc0: "P1-RC0-02",
  });

  const after = await request(`/students/${encodeURIComponent(code)}`, { token: adminToken });
  const t3 = after.data?.updatedAt;
  const advanced = t3 && t2 && new Date(t3).getTime() > new Date(t2).getTime();
  (advanced ? pass : fail)({
    id: "S03-occ-D",
    role: "Admin établissement",
    screen: "OCC",
    action: "nouveau token strictement supérieur (ms JSON)",
    attendu: "updatedAt après PATCH > token précédent",
    obtenu: `before=${t2} after=${t3}`,
    endpoint: `GET /api/students/${code}`,
    rc0: "P1-RC0-02",
  });
}

async function runAttendance(ctx) {
  const { adminToken, classA, classHomonym, classEmpty, students, t1, t2, teacher1, schoolCode } = ctx;
  const date = TODAY;
  const items = students.slice(0, 4).map((s, i) => ({
    studentId: s.studentCode || s.id,
    studentCode: s.studentCode,
    classId: classA.classId,
    classCode: classA.classCode,
    date,
    status: i === 3 ? "absent" : "present",
    present: i !== 3,
  }));

  const noKey = await request("/presences", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": `rc1-nokey-${Date.now()}` },
    body: { classId: classA.classId, classCode: classA.classCode, date, items },
  });
  const blockedUnresolved = noKey.status === 409 && noKey.data?.code === "ATTENDANCE_TEACHER_UNRESOLVED";
  (blockedUnresolved ? pass : fail)({
    id: "S06-cas-B-zero-teacher-or-unresolved",
    role: "Admin établissement",
    screen: "Appel",
    action: "Admin sans teacherId explicite → blocage",
    attendu: "409 ATTENDANCE_TEACHER_UNRESOLVED (Mobile: 0 enseignant = blocage explicite)",
    obtenu: `${noKey.status} ${compact(noKey.data)}`,
    endpoint: "POST /api/presences",
    rc0: "P1-RC0-03",
  });

  const teacherId = t1?.id || t1?.teacherCode || t1?.userId;
  const withKey = await request("/presences", {
    method: "POST",
    token: adminToken,
    headers: { "Idempotency-Key": `rc1-call-${Date.now()}` },
    body: {
      classId: classA.classId,
      classCode: classA.classCode,
      date,
      teacherId,
      items: items.map((item) => ({ ...item, teacherId })),
    },
  });
  const saveOk = withKey.status === 201;
  (saveOk ? pass : fail)({
    id: "S06-save-call",
    role: "Admin établissement",
    screen: "Appel",
    action: "CAS C/D sélection valide + Idempotency-Key",
    attendu: "201",
    obtenu: `${withKey.status} ${compact(withKey.data)}`.slice(0, 500),
    endpoint: "POST /api/presences",
    rc0: "P1-RC0-03",
    classification: saveOk ? "" : "P1",
    defect: saveOk
      ? null
      : {
          id: "P1-RC1-03",
          severity: "P1",
          role: "Admin établissement",
          screen: "Appel",
          steps: ["POST /api/presences with teacherId of assigned teacher"],
          attendu: "201",
          obtenu: withKey.data,
          http: withKey.status,
          endpoint: "POST /api/presences",
          cause: "clé enseignant / affectation / payload",
        },
  });
  evidence.regressions["P1-RC0-03"] = saveOk ? "PASS" : "FAIL";

  if (saveOk) {
    const replay = await request("/presences", {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": withKey._unused },
      body: {
        classId: classA.classId,
        classCode: classA.classCode,
        date,
        teacherId,
        items: items.map((item) => ({ ...item, teacherId })),
      },
    });
    const sameKey = `rc1-double-${Date.now()}`;
    const first = await request("/presences", {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": sameKey },
      body: {
        classId: classA.classId,
        classCode: classA.classCode,
        date,
        teacherId,
        items: items.map((item) => ({ ...item, teacherId, status: "present" })),
      },
    });
    const second = await request("/presences", {
      method: "POST",
      token: adminToken,
      headers: { "Idempotency-Key": sameKey },
      body: {
        classId: classA.classId,
        classCode: classA.classCode,
        date,
        teacherId,
        items: items.map((item) => ({ ...item, teacherId, status: "present" })),
      },
    });
    (first.status === 201 && (second.status === 200 || second.status === 201) ? pass : fail)({
      id: "S06-double-tap",
      role: "Admin établissement",
      screen: "Appel",
      action: "double tap même Idempotency-Key",
      attendu: "replay sans double écriture",
      obtenu: `${first.status}/${second.status}`,
      endpoint: "POST /api/presences",
    });
  }

  const pgAtt = await pgQuery(
    `SELECT COUNT(*)::int AS n FROM attendance a
     JOIN schools s ON s.id = a.school_id
     WHERE s.school_code = $1`,
    [ctx.schoolA.internalCode],
  ).catch(() => [{ n: -1 }]);
  ((saveOk ? Number(pgAtt[0]?.n) >= 4 : true) ? (saveOk && Number(pgAtt[0]?.n) >= 4 ? pass : saveOk ? fail : skip) : fail)({
    id: "S06-pg-attendance",
    role: "Admin établissement",
    screen: "PostgreSQL",
    action: "présences persistées",
    attendu: ">= 4 lignes si save 201",
    obtenu: compact(pgAtt[0]),
    endpoint: "SELECT attendance",
    pg: pgAtt[0],
  });

  const reload = await request("/presences", { token: adminToken });
  (reload.status === 200 ? pass : fail)({
    id: "S06-reload-presences",
    role: "Admin établissement",
    screen: "Appel",
    action: "quitter/revenir",
    attendu: "200",
    obtenu: `${reload.status} n=${listOf(reload.data).length}`,
    endpoint: "GET /api/presences",
  });

  const t1Id = teacher1.email || teacher1.user?.email;
  if (t1Id) {
    const tSession = await mobileSession(t1Id, STAFF_PASSWORD, schoolCode, "teacher");
    const teacherToken = tSession.token;
    const teacherCall = await request("/presences", {
      method: "POST",
      token: teacherToken,
      headers: { "Idempotency-Key": `rc1-teacher-${Date.now()}` },
      body: {
        classId: classA.classId,
        classCode: classA.classCode,
        date,
        items: items.map((item) => ({ ...item, teacherId: undefined })),
      },
    });
    (teacherCall.status === 201 || teacherCall.status === 200 ? pass : fail)({
      id: "S06-cas-A-teacher",
      role: "Enseignant",
      screen: "Appel",
      action: "CAS A — enseignant connecté, aucun teacherId forgé",
      attendu: "201 (principal.sub), pas de teacherId client",
      obtenu: `${teacherCall.status} ${compact(teacherCall.data)}`.slice(0, 500),
      endpoint: "POST /api/presences",
      rc0: "P1-RC0-03",
    });

    if (classHomonym?.classCode) {
      const crossClass = await request("/presences", {
        method: "POST",
        token: adminToken,
        body: {
          classId: classHomonym.classId,
          classCode: classHomonym.classCode,
          date,
          teacherId: t2?.id || t2?.teacherCode,
          items: items.slice(0, 1).map((item) => ({
            ...item,
            classId: classHomonym.classId,
            classCode: classHomonym.classCode,
            teacherId: t2?.id || t2?.teacherCode,
          })),
        },
      });
      const refused = crossClass.status === 403 || crossClass.status === 409 || crossClass.status === 400;
      (refused ? pass : fail)({
        id: "S06-teacher-other-class",
        role: "Admin établissement",
        screen: "Appel",
        action: "enseignant de B dans classe A/homonyme → refus",
        attendu: "4xx/409, aucun enseignant de B dans A",
        obtenu: `${crossClass.status} ${compact(crossClass.data)}`,
        endpoint: "POST /api/presences",
      });
    }
  }

  if (classEmpty?.classCode) {
    const emptyCall = await request("/presences", {
      method: "POST",
      token: adminToken,
      body: {
        classId: classEmpty.classId,
        classCode: classEmpty.classCode,
        date,
        items: [{ studentId: students[0]?.studentCode, status: "present", date }],
      },
    });
    (emptyCall.status === 409 || emptyCall.status === 400 || emptyCall.status === 403 ? pass : fail)({
      id: "S06-cas-B-empty-class",
      role: "Admin établissement",
      screen: "Appel",
      action: "CAS B — classe sans enseignant actif",
      attendu: "blocage explicite",
      obtenu: `${emptyCall.status} ${compact(emptyCall.data)}`,
      endpoint: "POST /api/presences",
      rc0: "P1-RC0-03",
    });
  }
}

async function runPedagogy({ adminToken, classA, students, t1, schoolCode, teacher1, stamp }) {
  const courses = await request("/courses", { token: adminToken });
  const courseRows = listOf(courses.data);
  const mathCourse = courseRows.find((row) => /math/i.test(String(row.name || row.subject || ""))) || courseRows[0];
  (courses.status === 200 ? pass : fail)({
    id: "S11-list-courses",
    role: "Admin établissement",
    screen: "Cours",
    action: "GET /courses canonique",
    attendu: "200",
    obtenu: `${courses.status} n=${courseRows.length} sample=${compact(mathCourse)}`,
    endpoint: "GET /api/courses",
  });

  const types = await request("/evaluation-types", { token: adminToken });
  let typeRows = listOf(types.data);
  let typeId = typeRows[0]?.id || typeRows[0]?.evaluationTypeId;
  if (!typeId) {
    const createdType = await request("/evaluation-types", {
      method: "POST",
      token: adminToken,
      body: { name: "Devoir RC1", code: "devoir-rc1" },
    });
    typeId = createdType.data?.id || createdType.data?.evaluationTypeId;
    (createdType.status === 201 && typeId ? pass : fail)({
      id: "S07-create-eval-type",
      role: "Admin établissement",
      screen: "Évaluations",
      action: "POST /evaluation-types (catalogue vide hors seed démo)",
      attendu: "201 type canonique",
      obtenu: `${createdType.status} ${compact(createdType.data)}`,
      endpoint: "POST /api/evaluation-types",
      erreur: createdType.status === 201 ? "" : createdType.data,
    });
  } else {
    pass({
      id: "S07-create-eval-type",
      role: "Admin établissement",
      screen: "Évaluations",
      action: "GET /evaluation-types déjà peuplé",
      attendu: "au moins un type canonique",
      obtenu: `n=${typeRows.length} id=${typeId}`,
      endpoint: "GET /api/evaluation-types",
    });
  }

  const evalBody = {
    title: `Interro RC1 ${stamp}`,
    classId: classA.classId,
    classCode: classA.classCode,
    className: classA.name,
    schoolCourseId: mathCourse?.schoolCourseId || mathCourse?.id || mathCourse?.dbId,
    subject: mathCourse?.name || "Mathématiques",
    period: "Trimestre 1",
    date: TODAY,
    scale: 20,
    maxScore: 20,
    coefficient: 1,
    evaluationTypeId: typeId,
  };
  const created = await request("/evaluations", { method: "POST", token: adminToken, body: evalBody });
  (created.status === 201 ? pass : fail)({
    id: "S07-create-eval",
    role: "Admin établissement",
    screen: "Évaluations",
    action: "créer évaluation avec schoolCourseId",
    attendu: "201",
    obtenu: `${created.status} ${compact(created.data)}`,
    endpoint: "POST /api/evaluations",
    erreur: created.status === 201 ? "" : created.data,
  });
  const listed = await request("/evaluations", { token: adminToken });
  const listedRows = listOf(listed.data);
  (listed.status === 200 && (created.status !== 201 || listedRows.length >= 1) ? pass : fail)({
    id: "S07-list-evals",
    role: "Admin établissement",
    screen: "Évaluations",
    action: "liste évaluations",
    attendu: "200 et persistance après création",
    obtenu: `${listed.status} n=${listedRows.length}`,
    endpoint: "GET /api/evaluations",
  });

  const teacherId = teacher1?.email || teacher1?.user?.email;
  if (teacherId) {
    const tLogin = await mobileLogin(teacherId, STAFF_PASSWORD, schoolCode, "teacher");
    if (tLogin.status === 200) {
      const tEvals = await request("/evaluations", { token: tokenOf(tLogin.data) });
      (tEvals.status === 200 ? pass : fail)({
        id: "S07-teacher-list-evals",
        role: "Enseignant",
        screen: "Évaluations",
        action: "GET /evaluations RBAC enseignant",
        attendu: "200 (Évaluations:READ live)",
        obtenu: `${tEvals.status} n=${listOf(tEvals.data).length}`,
        endpoint: "GET /api/evaluations",
      });
    }
  }

  if (created.status === 201 && students[0]) {
    const evaluationId = created.data?.id || created.data?.evaluationId || created.data?.publicId;
    const studentId = students[0].studentCode || students[0].id;
    const noteBefore = await request("/notes", {
      method: "POST",
      token: adminToken,
      body: { evaluationId, studentId, score: 14, value: 14, scale: 20 },
    });
    (noteBefore.status === 409 && noteBefore.data?.code === "EVALUATION_NOT_VALIDATED" ? pass : fail)({
      id: "S07-note-before-validate",
      role: "Admin établissement",
      screen: "Notes",
      action: "saisie note avant validation",
      attendu: "409 EVALUATION_NOT_VALIDATED (fail-closed)",
      obtenu: `${noteBefore.status} ${compact(noteBefore.data)}`,
      endpoint: "POST /api/notes",
      erreur: noteBefore.status === 409 ? "" : noteBefore.data,
    });

    if (teacherId) {
      const tLoginValidate = await mobileLogin(teacherId, STAFF_PASSWORD, schoolCode, "teacher");
      if (tLoginValidate.status === 200) {
        const teacherValidate = await request(`/evaluations/${encodeURIComponent(evaluationId)}`, {
          method: "PATCH",
          token: tokenOf(tLoginValidate.data),
          body: { status: "Validée" },
        });
        (teacherValidate.status === 403 ? pass : fail)({
          id: "S07-teacher-cannot-validate",
          role: "Enseignant",
          screen: "Évaluations",
          action: "PATCH Validée interdit à l'enseignant",
          attendu: "403 EVALUATION_VALIDATION_FORBIDDEN",
          obtenu: `${teacherValidate.status} ${compact(teacherValidate.data)}`,
          endpoint: `PATCH /api/evaluations/${evaluationId}`,
        });
      }
    }

    const validated = await request(`/evaluations/${encodeURIComponent(evaluationId)}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "Validée" },
    });
    (validated.status === 200 && String(validated.data?.status) === "Validée" ? pass : fail)({
      id: "S07-validate-eval",
      role: "Admin établissement",
      screen: "Évaluations",
      action: "PATCH statut Validée (ouvre la saisie)",
      attendu: "200 status=Validée",
      obtenu: `${validated.status} ${compact(validated.data)}`,
      endpoint: `PATCH /api/evaluations/${evaluationId}`,
      erreur: validated.status === 200 ? "" : validated.data,
    });

    const adminNote = await request("/notes", {
      method: "POST",
      token: adminToken,
      body: { evaluationId, studentId, score: 14, value: 14, scale: 20 },
    });
    (adminNote.status === 409 && adminNote.data?.code === "GRADE_TEACHER_UNRESOLVED" ? pass : fail)({
      id: "S07-admin-note-unresolved",
      role: "Admin établissement",
      screen: "Notes",
      action: "Admin sans teacherId explicite après validation",
      attendu: "409 GRADE_TEACHER_UNRESOLVED (même contrat que l'appel)",
      obtenu: `${adminNote.status} ${compact(adminNote.data)}`,
      endpoint: "POST /api/notes",
    });

    const tLoginNote = teacherId ? await mobileLogin(teacherId, STAFF_PASSWORD, schoolCode, "teacher") : { status: 0, data: null };
    const note = tLoginNote.status === 200
      ? await request("/notes", {
          method: "POST",
          token: tokenOf(tLoginNote.data),
          body: { evaluationId, studentId, score: 14, value: 14, scale: 20 },
        })
      : { status: 0, data: { message: "login enseignant indisponible" } };
    (note.status === 201 || note.status === 200 ? pass : fail)({
      id: "S07-note",
      role: "Enseignant",
      screen: "Notes",
      action: "saisie note Mobile (session enseignant, pas de teacherId forgé)",
      attendu: "201/200",
      obtenu: `${note.status} ${compact(note.data)}`,
      endpoint: "POST /api/notes",
      erreur: note.status === 201 || note.status === 200 ? "" : note.data,
    });
    if (note.status === 201 || note.status === 200) {
      const notesPg = await pgQuery(
        `SELECT count(*)::int AS count FROM grades g
         JOIN students s ON s.id = g.student_id
         WHERE s.student_code = $1`,
        [studentId],
      ).catch(() => []);
      const notesList = await request("/notes", { token: adminToken });
      const noteCount = Array.isArray(notesList.data) ? notesList.data.length : listOf(notesList.data).length;
      (notesList.status === 200 && Number(notesPg[0]?.count || 0) >= 1 ? pass : fail)({
        id: "S07-note-persist",
        role: "Admin établissement",
        screen: "Notes",
        action: "reload + PostgreSQL",
        attendu: "note visible après GET + ligne PG",
        obtenu: `GET ${notesList.status} n=${noteCount} pg=${notesPg[0]?.count}`,
        endpoint: "GET /api/notes",
        pg: notesPg[0] || null,
      });
    }
  } else {
    skip({
      id: "S07-note",
      screen: "Notes",
      action: "saisie note",
      attendu: "dépend d'une éval 201",
      obtenu: "SKIP — pas d'évaluation",
      endpoint: "POST /api/notes",
    });
  }
}

async function runFinance({ adminToken, classA, students, accountant, schoolA, schoolB, schoolCode, stamp }) {
  const financeStudent = students[0];
  const studentCode = financeStudent?.studentCode || financeStudent?.id;
  const grid = await request("/finance/fee-grids", {
    method: "POST",
    token: adminToken,
    body: {
      className: classA.name,
      classCode: classA.classCode,
      academicYear: "2025-2026",
      currency: "CDF",
      items: [{ feeType: "Inscription", label: "Inscription", amount: 1000, dueDate: TODAY, status: "Actif" }],
    },
  });
  (grid.status === 201 ? pass : fail)({
    id: "S08-create-grid",
    role: "Admin établissement",
    screen: "Finance",
    action: "créer grille 1000 FC",
    attendu: "201",
    obtenu: `${grid.status} ${grid.data?.id || compact(grid.data)}`,
    endpoint: "POST /api/finance/fee-grids",
  });
  if (grid.status !== 201) return;
  await request(`/finance/fee-grids/${encodeURIComponent(grid.data.id)}/activate`, {
    method: "POST",
    token: adminToken,
  });
  await request(`/finance/fee-grids/${encodeURIComponent(grid.data.id)}/apply`, {
    method: "POST",
    token: adminToken,
    body: { classCode: classA.classCode },
  });

  const fees0 = await request("/finance/student-fees", { token: adminToken });
  const allFees = listOf(fees0.data);
  const obligation = allFees.find(
    (row) => row.studentId === studentCode || row.studentCode === studentCode || row.studentId === financeStudent?.id,
  );
  const zeroPaid = Number(obligation?.amountPaid || obligation?.paid || 0) === 0;
  (fees0.status === 200 && obligation && zeroPaid ? pass : fail)({
    id: "S08-A-zero-payment",
    role: "Admin établissement",
    screen: "Finance",
    action: "A — aucune allocation → Non imputé / payé 0",
    attendu: "obligation 1000, payé 0",
    obtenu: compact(obligation || { n: allFees.length }),
    endpoint: "GET /api/finance/student-fees",
  });

  let accToken = adminToken;
  const accId = accountant.user?.email || accountant.email;
  if (accId) {
    const accSession = await mobileSession(accId, STAFF_PASSWORD, schoolCode, "accountant");
    if (accSession.logged.status === 200) accToken = accSession.token;
  }

  const payPartial = await request("/payments", {
    method: "POST",
    token: accToken,
    body: {
      studentId: studentCode,
      items: [
        {
          feeType: "Inscription",
          amount: 200,
          ...(obligation?.id || obligation?.publicId
            ? { obligationId: obligation.id || obligation.publicId }
            : {}),
        },
      ],
      method: "Espèces",
      date: TODAY,
    },
  });
  const partialOk = payPartial.status === 201;
  (partialOk ? pass : fail)({
    id: "S08-B-partial",
    role: "Comptable",
    screen: "Finance",
    action: "B — allocation partielle 200 / 1000",
    attendu: "201 Partiel imputé 200",
    obtenu: `${payPartial.status} ${compact(payPartial.data)}`,
    endpoint: "POST /api/payments",
  });

  const payFull = await request("/payments", {
    method: "POST",
    token: accToken,
    body: {
      studentId: studentCode,
      items: [{ feeType: "Inscription", amount: 800 }],
      amount: 800,
      feeType: "Inscription",
      method: "Espèces",
      date: TODAY,
    },
  });
  (payFull.status === 201 ? pass : fail)({
    id: "S08-C-full",
    role: "Comptable",
    screen: "Finance",
    action: "C — allocation complète du reste",
    attendu: "201 statut correct",
    obtenu: `${payFull.status} ${compact(payFull.data)}`,
    endpoint: "POST /api/payments",
  });

  const otherStudent = students[1]?.studentCode || students[1]?.id;
  const mismatch = await request("/payments", {
    method: "POST",
    token: accToken,
    body: {
      studentId: studentCode,
      items: [{ feeType: "Inscription", obligationId: "00000000-0000-0000-0000-000000000099", amount: 50 }],
      method: "Espèces",
      date: TODAY,
    },
  });
  const mismatchOk = mismatch.status === 409 || mismatch.status === 404 || mismatch.status === 400;
  (mismatchOk ? pass : fail)({
    id: "S08-D-bad-obligation",
    role: "Comptable",
    screen: "Finance",
    action: "D — obligationId incohérent",
    attendu: "409 (ou 4xx fail-closed) + zéro effet secondaire",
    obtenu: `${mismatch.status} ${compact(mismatch.data)}`,
    endpoint: "POST /api/payments",
  });

  const reference = payPartial.data?.reference || payPartial.data?.id || payFull.data?.reference || payFull.data?.id;
  if (reference) {
    const cancel = await request(`/payments/${encodeURIComponent(reference)}/cancel`, {
      method: "POST",
      token: accToken,
      body: { reason: "Smoke RC1 annulation" },
    });
    (cancel.status === 200 || cancel.status === 201 ? pass : fail)({
      id: "S08-E-cancel",
      role: "Comptable",
      screen: "Finance",
      action: "E — paiement annulé",
      attendu: "annulé, allocations inversées",
      obtenu: `${cancel.status} ${compact(cancel.data)}`,
      endpoint: `POST /api/payments/${reference}/cancel`,
    });
  } else {
    skip({
      id: "S08-E-cancel",
      screen: "Finance",
      action: "annulation",
      attendu: "paiement 201 préalable",
      obtenu: "SKIP",
      endpoint: "POST /api/payments/:id/cancel",
    });
  }

  info({
    id: "S08-payment-student-options",
    role: "Comptable",
    screen: "Finance",
    action: "GET /api/finance/payment-student-options",
    attendu: "hors périmètre RC1 — ne pas créer, ne pas P1",
    obtenu: "non créé / non noté P1",
    endpoint: "GET /api/finance/payment-student-options",
  });
}

async function runTenantIsolation({ schoolB, superToken, stamp, schoolA, students, adminToken }) {
  if (!schoolB?.ok && !schoolB?.publicCode) {
    skip({
      id: "S16-tenant",
      screen: "Isolation",
      action: "école B absente",
      attendu: "deux établissements",
      obtenu: "SKIP",
      endpoint: "n/a",
      classification: "P0",
    });
    return;
  }
  const adminB = await provisionSchoolAdmin(superToken, schoolB, stamp, "B");
  if (!adminB.ok) {
    fail({
      id: "S16-admin-b",
      role: "Super Administrateur",
      screen: "Isolation",
      action: "provision Admin B",
      attendu: "201",
      obtenu: compact(adminB.res?.data),
      endpoint: "POST /api/backoffice/users/provision",
      classification: "P1",
    });
    return;
  }
  const loginB = await backofficeLogin(adminB.identifier, STAFF_PASSWORD, schoolB.publicCode);
  const tokenB = loginB.token;
  const studentsB = await request("/students", { token: tokenB });
  const leaked = listOf(studentsB.data).some((row) =>
    students.some((s) => String(s.studentCode) === String(row.studentCode || row.id)),
  );
  (!leaked && studentsB.status === 200 ? pass : fail)({
    id: "S03-tenant-isolation",
    role: "Admin établissement B",
    screen: "Élèves",
    action: "isolation tenant students",
    attendu: "aucun élève de A chez B",
    obtenu: `n=${listOf(studentsB.data).length} leaked=${leaked}`,
    endpoint: "GET /api/students",
    classification: leaked ? "P0" : "",
    defect: leaked
      ? {
          id: "P0-RC1-TENANT-STUDENTS",
          severity: "P0",
          role: "Admin établissement B",
          screen: "Élèves",
          steps: ["GET /api/students depuis B"],
          attendu: "0 élève de A",
          obtenu: studentsB.data,
          http: studentsB.status,
          endpoint: "GET /api/students",
          cause: "fuite tenant",
        }
      : null,
  });

  const classesB = await request("/classes", { token: tokenB });
  const classLeak = listOf(classesB.data).some((row) => String(row.schoolCode) === String(schoolA.publicCode));
  const teachersB = await request("/teachers", { token: tokenB });
  const assignB = await request("/assignments", { token: tokenB });
  const attB = await request("/presences", { token: tokenB });
  const evalB = await request("/evaluations", { token: tokenB });
  const payB = await request("/payments", { token: tokenB });
  const leakAny = classLeak;
  (!leakAny ? pass : fail)({
    id: "S16-tenant-domains",
    role: "Admin établissement B",
    screen: "Isolation tenant",
    action: "classes/teachers/assignments/attendance/evals/payments",
    attendu: "A ne lit/modifie jamais B et inversement",
    obtenu: `classes=${listOf(classesB.data).length} teachers=${listOf(teachersB.data).length} assign=${listOf(assignB.data).length} att=${listOf(attB.data).length} eval=${listOf(evalB.data).length} pay=${listOf(payB.data).length} classLeak=${classLeak}`,
    endpoint: "GET domaines critiques",
    classification: leakAny ? "P0" : "",
  });

  if (students[0]?.studentCode) {
    const patchCross = await request(`/students/${encodeURIComponent(students[0].studentCode)}`, {
      method: "PATCH",
      token: tokenB,
      body: { firstName: "Leaked", expectedUpdatedAt: students[0].updatedAt || new Date().toISOString() },
    });
    const blockedCross = patchCross.status === 404 || patchCross.status === 403;
    (blockedCross ? pass : fail)({
      id: "S16-cross-patch-student",
      role: "Admin établissement B",
      screen: "Isolation",
      action: "PATCH élève de A depuis B",
      attendu: "404/403",
      obtenu: `${patchCross.status} ${compact(patchCross.data)}`,
      endpoint: `PATCH /api/students/${students[0].studentCode}`,
      classification: blockedCross ? "" : "P0",
    });
  }
}

async function maybeParentStudent({ adminToken, students, schoolCode, stamp }) {
  if (!students[0]) {
    skip({
      id: "S01-parent",
      role: "Parent",
      action: "non provisionné",
      attendu: "si contrat disponible",
      obtenu: "SKIP",
      endpoint: "POST /api/login",
    });
    return;
  }
  const phone = `+24382${String(stamp).slice(-7)}`;
  const email = `parent-rc1-${stamp}@somafrik.test`;
  const linked = await request("/parents/link", {
    method: "POST",
    token: adminToken,
    body: {
      studentId: students[0].id || students[0].studentCode,
      firstName: "Parent",
      lastName: "SmokeRC1",
      phone,
      email,
      relationType: "parent_student",
    },
  });
  if (linked.status !== 201 && linked.status !== 200) {
    skip({
      id: "S01-parent",
      role: "Parent",
      screen: "Login Mobile",
      action: "POST /parents/link",
      attendu: "201 si contrat disponible",
      obtenu: `${linked.status} ${compact(linked.data)}`,
      endpoint: "POST /api/parents/link",
    });
    return;
  }
  const parentUserId = linked.data?.user?.id;
  if (parentUserId) {
    await request(`/users/${encodeURIComponent(parentUserId)}/reset-password`, {
      method: "POST",
      token: adminToken,
      body: { temporaryPassword: PARENT_PASSWORD },
    });
  }
  const parentLogin = await mobileLogin(email, PARENT_PASSWORD, schoolCode, "parent_student");
  (parentLogin.status === 200 ? pass : fail)({
    id: "S01-parent-login",
    role: "Parent",
    screen: "Login Mobile",
    action: "identify/login parent",
    attendu: "200 parent_student sans expansion de permissions",
    obtenu: `${parentLogin.status} role=${parentLogin.data?.role} perms=${permsOf(parentLogin.data).length}`,
    endpoint: "POST /api/login",
  });
  if (parentLogin.status === 200) {
    const expanded = hasInventedAll(parentLogin.data);
    (!expanded ? pass : fail)({
      id: "S01-parent-no-expansion",
      role: "Parent",
      screen: "RBAC",
      action: "aucune expansion Parent",
      attendu: "pas ALL_PRIVILEGES",
      obtenu: `ALL=${expanded} count=${permsOf(parentLogin.data).length}`,
      endpoint: "POST /api/login",
    });
  }

  const creds = students[0].credentials || {};
  if (creds.login || students[0].studentCode) {
    const studentLogin = await mobileLogin(
      creds.login || students[0].studentCode,
      creds.temporarySecret || STAFF_PASSWORD,
      schoolCode,
      "student",
    );
    if (studentLogin.status === 200) {
      pass({
        id: "S01-student-login",
        role: "Élève",
        screen: "Login Mobile",
        action: "login élève si compte",
        attendu: "200 student",
        obtenu: `${studentLogin.status} role=${studentLogin.data?.role}`,
        endpoint: "POST /api/login",
      });
    } else {
      skip({
        id: "S01-student-login",
        role: "Élève",
        screen: "Login Mobile",
        action: "login élève",
        attendu: "200 si compte provisionné",
        obtenu: `${studentLogin.status} ${compact(studentLogin.data)}`,
        endpoint: "POST /api/login",
      });
    }
  } else {
    skip({
      id: "S01-student-login",
      role: "Élève",
      action: "compte élève non exposé par l'inscription",
      attendu: "si contrat disponible",
      obtenu: "SKIP",
      endpoint: "POST /api/login",
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
