"use strict";

/**
 * MONO-FIX-O9 — un abonnement suspendu bloque l'accès (serveur réel, base jetable).
 *
 * Défaut corrigé : la colonne subscriptions.status vaut « suspended » (anglais,
 * valeur acceptée par PATCH /api/backoffice/subscriptions), mais la règle
 * d'accès ne reconnaissait que « Suspendu ». Un établissement ACTIF dont
 * l'abonnement était suspendu était lu « limited » : une session déjà ouverte
 * continuait à saisir notes et présences.
 *
 * Scénario (données de démonstration, base IT jetable *_it du cluster MONO-T0) :
 *   - sessions réelles ouvertes AVANT la suspension (enseignant, administrateur) ;
 *   - suspension par l'API Superadmin avec le statut stocké « suspended » ;
 *   - variante : profil JSON resté « Actif » / accessLevel « full » (SQL) ;
 *   - statuts stockés bloquants (expiré, annulé, résilié, inconnu) et échéance
 *     dépassée de 40 jours, chacun avec une surcharge accessLevel « full » ;
 *   - statut inconnu, établissement lui-même suspendu, abonnement échu ;
 *   - contrôle : un abonnement actif garde l'accès complet (non-régression A2).
 * Chaque refus est vérifié sans écriture en base.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Pool } = require("pg");
const { guardPgPool } = require("./pgPoolGuard");
const { hasExited, stopChildProcess } = require("./pgTestLifecycle");
const { superadminLoginPassword } = require("./superadminSeedSecret");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
if (process.env.GITHUB_ACTIONS && !DATABASE_URL) {
  throw new Error("DATABASE_URL requis en GitHub Actions — ce test HTTP/PG ne doit pas être ignoré");
}
const skip = DATABASE_URL ? false : "DATABASE_URL absent (exécuter via npm run test:backend-baseline:pg)";
const ROOT = path.resolve(__dirname, "../..");
const IT_DATABASE = "somafrik_subscription_suspended_it";
const PORT = 19977;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const BLOCKED_MESSAGE = /abonnement expiré ou impayé/;

let pool = null;
let databaseUrl = null;
let child = null;
const tokens = {};
const ids = {};

function withDatabaseName(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function resetDatabase() {
  assert.match(IT_DATABASE, /^somafrik_[a-z0-9_]+_it$/, "base de test jetable uniquement");
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DATABASE]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = withDatabaseName(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: url });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }
  return url;
}

async function startServer() {
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(PORT),
    DATABASE_URL: databaseUrl,
    JWT_SECRET,
    SOMAFRIK_DB_REQUIRED: "true",
    SOMAFRIK_API_ONLY: "true",
    SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
    LOGIN_RATE_LIMIT_MAX: "100000",
  };
  delete env.SOMAFRIK_SKIP_DEMO_SEED;
  delete env.SOMAFRIK_E2E;
  child = spawn(process.execPath, ["backend/server.js"], { cwd: ROOT, env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (hasExited(child)) throw new Error(`Serveur arrêté au démarrage.\n${stderr.slice(-4000)}`);
    try {
      if ((await fetch(`${BASE_URL}/api/health`)).ok) return;
    } catch {
      /* démarrage en cours */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Serveur non prêt.\n${stderr.slice(-4000)}`);
}

async function stopServer() {
  if (child && !hasExited(child)) await stopChildProcess(child);
  child = null;
}

const killOrphan = () => {
  if (child && !hasExited(child)) child.kill("SIGKILL");
};

async function request(method, pathname, { token, body } = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, text };
}

async function loginCode(schoolCode) {
  const result = await pool.query("SELECT login_code FROM schools WHERE school_code = $1", [schoolCode]);
  assert.equal(result.rowCount, 1, `établissement ${schoolCode} présent`);
  return result.rows[0].login_code;
}

async function login(identifier, schoolCode) {
  return request("POST", "/api/backoffice/login", {
    body: { identifier, password: "1234", ...(schoolCode ? { schoolCode: await loginCode(schoolCode) } : {}) },
  });
}

async function sessionToken(identifier, schoolCode) {
  const response = await login(identifier, schoolCode);
  assert.equal(response.status, 200, `connexion ${identifier} : ${response.text.slice(0, 200)}`);
  return response.data.accessToken;
}

async function accessOf(schoolCode) {
  const response = await request("GET", `/api/backoffice/subscription-access?schoolCode=${schoolCode}`, { token: tokens.superAdmin });
  assert.equal(response.status, 200, response.text.slice(0, 200));
  return response.data;
}

async function patchSubscription(schoolCode, body) {
  const row = await pool.query(
    "SELECT sub.id FROM subscriptions sub JOIN schools sc ON sc.id = sub.school_id WHERE sc.school_code = $1",
    [schoolCode],
  );
  const response = await request("PATCH", `/api/backoffice/subscriptions/${row.rows[0].id}`, {
    token: tokens.superAdmin,
    body: { schoolCode, ...body },
  });
  assert.equal(response.status, 200, `PATCH abonnement ${schoolCode} : ${response.text.slice(0, 200)}`);
  return (
    await pool.query(
      "SELECT status, profile_payload->>'status' AS profile_status FROM subscriptions WHERE id = $1",
      [row.rows[0].id],
    )
  ).rows[0];
}

const snapshot = async (sql) => JSON.stringify((await pool.query(sql)).rows);
const writeTables = {
  evaluations: "SELECT id FROM evaluations ORDER BY id",
  grades: "SELECT id, score FROM grades ORDER BY id",
  attendance: "SELECT id, status FROM attendance ORDER BY id",
  students: "SELECT id FROM students ORDER BY id",
  enrollments: "SELECT id FROM enrollments ORDER BY id",
};
async function snapshotWrites() {
  const result = {};
  for (const [name, sql] of Object.entries(writeTables)) result[name] = await snapshot(sql);
  return result;
}

before(async () => {
  if (skip) return;
  process.once("exit", killOrphan);
  databaseUrl = await resetDatabase();
  pool = guardPgPool(new Pool({ connectionString: databaseUrl, application_name: "somafrik_o9_test" }));
  await startServer();
  // Sessions réelles ouvertes AVANT toute suspension.
  tokens.cdAdmin = await sessionToken("admin@unikin.somafrik", "CD-2026-0001");
  const beforeSuspension = await login("admin@unikin.somafrik", "CD-2026-0001");
  assert.equal(beforeSuspension.status, 200);
  tokens.cdAdminRefresh = beforeSuspension.data.refreshToken;
  tokens.cdTeacher = await sessionToken("patrick.ilunga@somafrik.cd", "CD-2026-0001");
  const superadmin = await request("POST", "/api/backoffice/login", {
    body: { identifier: "superadmin@somafrik.app", password: superadminLoginPassword() },
  });
  assert.equal(superadmin.status, 200, superadmin.text.slice(0, 200));
  tokens.superAdmin = superadmin.data.accessToken;
  const type = await request("POST", "/api/evaluation-types", { token: tokens.cdAdmin, body: { code: "devoir", name: "Devoir" } });
  assert.equal(type.status, 201, `précondition : type d'évaluation (${type.text.slice(0, 200)})`);
  ids.classId = (await pool.query("SELECT id FROM classes WHERE class_code = 'CLS-2026-000035'")).rows[0].id;
  ids.studentCode = (
    await pool.query(
      `SELECT s.student_code FROM students s JOIN enrollments e ON e.student_id = s.id
       JOIN classes c ON c.id = e.class_id
       WHERE c.class_code = 'CLS-2026-000035' AND lower(e.status) IN ('active', 'enrolled') AND s.status = 'active'
       ORDER BY s.student_code LIMIT 1`,
    )
  ).rows[0].student_code;
  assert.equal((await accessOf("CD-2026-0001")).level, "full", "précondition : CD actif avant suspension");
});

after(async () => {
  await stopServer();
  process.removeListener("exit", killOrphan);
  if (pool && !pool.ended) await pool.end();
});

async function attemptProtectedWrites() {
  const before = await snapshotWrites();
  const attempts = [
    [
      "évaluation (write_notes)",
      "/api/evaluations",
      tokens.cdTeacher,
      { classId: ids.classId, subject: "Sciences", period: "Trimestre 1", title: "O9", maxScore: 20, evaluationType: "devoir" },
    ],
    [
      "présence (write_presence)",
      "/api/presences",
      tokens.cdTeacher,
      {
        classCode: "CLS-2026-000035",
        items: [{ studentId: ids.studentCode, date: "2026-10-21", status: "Absent", classCode: "CLS-2026-000035" }],
      },
    ],
  ];
  const results = [];
  for (const [label, pathname, token, body] of attempts) {
    const response = await request("POST", pathname, { token, body });
    results.push({ label, status: response.status, message: response.data?.message });
  }
  return { results, unchanged: JSON.stringify(await snapshotWrites()) === JSON.stringify(before) };
}

function assertAllRefused({ results, unchanged }, label) {
  for (const result of results) {
    assert.equal(result.status, 403, `${label} — ${result.label} : HTTP ${result.status}`);
    assert.match(String(result.message), BLOCKED_MESSAGE, `${label} — ${result.label} : refus d'abonnement`);
  }
  assert.ok(unchanged, `${label} : aucune écriture (notes, présences, élèves, inscriptions)`);
}

test("abonnement suspendu par l'API (statut stocké « suspended ») : « blocked », connexion refusée, notes et présences refusées sans écriture", { skip }, async () => {
  const stored = await patchSubscription("CD-2026-0001", { status: "suspended" });
  assert.deepEqual(stored, { status: "suspended", profile_status: "suspended" }, "état PostgreSQL après suspension");

  const access = await accessOf("CD-2026-0001");
  assert.deepEqual({ level: access.level, lifecycle: access.lifecycle }, { level: "blocked", lifecycle: "Suspendu" });

  for (const identifier of ["admin@unikin.somafrik", "patrick.ilunga@somafrik.cd"]) {
    const response = await login(identifier, "CD-2026-0001");
    assert.equal(response.status, 403, `connexion ${identifier} : HTTP ${response.status}`);
    assert.equal(response.data?.accessToken, undefined);
  }
  assertAllRefused(await attemptProtectedWrites(), "abonnement « suspended »");
});

test("O9-R1 : refresh d'une session préexistante refusé et sessions révoquées après suspension", { skip }, async () => {
  const response = await request("POST", "/api/auth/refresh", {
    body: { refreshToken: tokens.cdAdminRefresh },
  });
  assert.equal(response.status, 403, "refresh doit refuser l'abonnement suspendu");
  assert.equal(response.data?.accessToken, undefined);
  const reuse = await request("POST", "/api/auth/refresh", {
    body: { refreshToken: tokens.cdAdminRefresh },
  });
  assert.equal(reuse.status, 401, "session révoquée, aucun nouveau token");
});

test("abonnement suspendu en base, profil JSON resté « Actif » / accessLevel « full » : toujours « blocked »", { skip }, async () => {
  await pool.query(
    `UPDATE subscriptions SET status = 'suspended',
            profile_payload = '{"status":"Actif","lifecycleStatus":"Actif","paymentStatus":"À jour","accessLevel":"full"}'::jsonb
     WHERE school_id = (SELECT id FROM schools WHERE school_code = 'CD-2026-0001')`,
  );
  const access = await accessOf("CD-2026-0001");
  assert.deepEqual({ level: access.level, lifecycle: access.lifecycle }, { level: "blocked", lifecycle: "Suspendu" });
  assertAllRefused(await attemptProtectedWrites(), "profil obsolète");
});

test("statut stocké bloquant (expiré, annulé, résilié, inconnu) + profil JSON « Actif » / accessLevel « full » : « blocked », sessions ouvertes refusées sans écriture", { skip }, async () => {
  for (const stored of ["expired", "cancelled", "terminated", "en_attente_validation"]) {
    await pool.query(
      `UPDATE subscriptions SET status = $1, end_date = CURRENT_DATE + 365,
              profile_payload = '{"status":"Actif","lifecycleStatus":"Actif","paymentStatus":"À jour","accessLevel":"full"}'::jsonb
       WHERE school_id = (SELECT id FROM schools WHERE school_code = 'CD-2026-0001')`,
      [stored],
    );
    const access = await accessOf("CD-2026-0001");
    assert.equal(access.level, "blocked", `statut stocké ${stored} : niveau « ${access.level} » (${access.lifecycle})`);
    assertAllRefused(await attemptProtectedWrites(), `statut stocké ${stored}`);
  }
});

test("échéance dépassée de 40 jours + accessLevel « full » : « blocked » (aucune surcharge permissive), sessions ouvertes refusées sans écriture", { skip }, async () => {
  await pool.query(
    `UPDATE subscriptions SET status = 'active', end_date = CURRENT_DATE - 40,
            profile_payload = '{"status":"Actif","lifecycleStatus":"Actif","paymentStatus":"À jour","accessLevel":"full"}'::jsonb
     WHERE school_id = (SELECT id FROM schools WHERE school_code = 'CD-2026-0001')`,
  );
  const access = await accessOf("CD-2026-0001");
  assert.equal(access.level, "blocked", `échéance J+40 : niveau « ${access.level} »`);
  assert.ok(access.daysLate >= 39, `retard lu : ${access.daysLate} jour(s)`);
  assertAllRefused(await attemptProtectedWrites(), "échéance J+40 avec surcharge full");
});

test("statut d'abonnement inconnu : aucun accès par défaut (« blocked », connexion refusée)", { skip }, async () => {
  const stored = await patchSubscription("SCH-DEMO-0012", { status: "en_attente_validation" });
  assert.equal(stored.status, "en_attente_validation");
  const access = await accessOf("SCH-DEMO-0012");
  assert.deepEqual({ level: access.level, lifecycle: access.lifecycle }, { level: "blocked", lifecycle: "Inconnu" });
  const response = await login("user-11@somafrik.demo", "SCH-DEMO-0012");
  assert.equal(response.status, 403, `connexion SCH-DEMO-0012 : HTTP ${response.status} ${response.text.slice(0, 160)}`);
  assert.equal(response.data?.accessToken, undefined);
});

test("établissement suspendu (abonnement actif) : « blocked », connexion refusée", { skip }, async () => {
  const suspended = await request("PATCH", "/api/backoffice/establishments/BI-2026-0002/suspend", { token: tokens.superAdmin });
  assert.equal(suspended.status, 200, `suspension BI : ${suspended.text.slice(0, 200)}`);
  const stored = await pool.query("SELECT status FROM schools WHERE school_code = 'BI-2026-0002'");
  assert.equal(stored.rows[0].status, "suspended", "état PostgreSQL de l'établissement");
  const subscription = await pool.query(
    "SELECT sub.status FROM subscriptions sub JOIN schools sc ON sc.id = sub.school_id WHERE sc.school_code = 'BI-2026-0002'",
  );
  assert.equal(subscription.rows[0].status, "active", "abonnement de BI resté actif");
  const access = await accessOf("BI-2026-0002");
  assert.equal(access.level, "blocked");
  const response = await login("admin@bujumbura.somafrik", "BI-2026-0002");
  assert.equal(response.status, 403, `connexion BI : HTTP ${response.status}`);
  assert.equal(response.data?.accessToken, undefined);
});

test("abonnement échu (fixture réelle, fin 2026-05-31) : « blocked », connexion refusée", { skip }, async () => {
  const access = await accessOf("SCH-DEMO-0017");
  assert.equal(access.level, "blocked");
  const response = await login("user-16@somafrik.demo", "SCH-DEMO-0017");
  assert.equal(response.status, 403);
  assert.match(String(response.data?.message), BLOCKED_MESSAGE);
});

test("contrôle : un abonnement actif (fin ISO 2027-08-31) garde l'accès complet — non-régression A2", { skip }, async () => {
  const end = await pool.query(
    "SELECT sub.status, sub.end_date::text AS end_date FROM subscriptions sub JOIN schools sc ON sc.id = sub.school_id WHERE sc.school_code = 'SCH-DEMO-0013'",
  );
  assert.deepEqual(end.rows[0], { status: "active", end_date: "2027-08-31" });
  const access = await accessOf("SCH-DEMO-0013");
  assert.deepEqual({ level: access.level, daysLate: access.daysLate }, { level: "full", daysLate: 0 });
  const response = await login("user-12@somafrik.demo", "SCH-DEMO-0013");
  assert.equal(response.status, 200, `connexion SCH-DEMO-0013 : HTTP ${response.status} ${response.text.slice(0, 160)}`);
});
