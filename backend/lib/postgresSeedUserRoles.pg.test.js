"use strict";

/**
 * #757 — le seed PostgreSQL écrit user_roles avant le trafic.
 * Finance live reste fail-closed : pas de repli sur les claims JWT.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { hasExited, stopChildProcess, waitForNoDatabaseSessions } = require("./pgTestLifecycle");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_SEED_USER_ROLES_IT_DATABASE ?? "somafrik_seed_user_roles_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_SEED_USER_ROLES_HTTP_PORT ?? 19874);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";
// Sessions du test lui-même : exclues du contrôle « plus aucune session serveur ».
const TEST_APPLICATION_NAME = "somafrik_seed_user_roles_test";

const FINANCE_READS = [
  "/payments",
  "/finance/fee-grids",
  "/finance/student-fees",
  "/backoffice/finance/unpaid",
  "/finance/payment-student-options",
];

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
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

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
}

async function startServer(isolatedUrl) {
  const serverEnv = {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(HTTP_PORT),
    DATABASE_URL: isolatedUrl,
    JWT_SECRET,
    SOMAFRIK_DB_REQUIRED: "true",
    SOMAFRIK_API_ONLY: "true",
  };
  delete serverEnv.SOMAFRIK_SKIP_DEMO_SEED;
  const child = spawn(process.execPath, ["backend/server.js"], {
    cwd: ROOT,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderrRef = { value: "" };
  child.stderr.on("data", (chunk) => {
    stderrRef.value += String(chunk);
  });
  child.stdout.on("data", () => {});
  try {
    await waitForHealth(child, stderrRef);
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }
  return child;
}

/**
 * Arrête le serveur et attend que PostgreSQL ait fermé toutes ses sessions sur
 * la base isolée. Sans cela, la DDL du second boot entre en concurrence avec le
 * travail de fond du serveur encore vivant (deadlock 40P01).
 */
async function stopServerAndReleaseDatabase(child, pool) {
  await stopChildProcess(child);
  const remaining = await waitForNoDatabaseSessions(pool, IT_DATABASE, {
    ignoreApplicationName: TEST_APPLICATION_NAME,
  });
  assert.equal(remaining, 0, `sessions serveur encore ouvertes sur ${IT_DATABASE} après l'arrêt du serveur`);
}

function enableDemoSeed() {
  delete process.env.SOMAFRIK_SKIP_DEMO_SEED;
  if (process.env.NODE_ENV === "production") {
    process.env.NODE_ENV = "test";
  }
}

async function countActiveRoles(pool) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM user_roles WHERE status = 'active' AND revoked_at IS NULL`,
  );
  return result.rows[0].count;
}

/** Affectations actives, identifiées ligne à ligne (comparaison stricte avant/après boot). */
async function activeRoleRows(pool) {
  const result = await pool.query(
    `SELECT id::text AS id, user_id::text AS user_id, school_id::text AS school_id, role_key
     FROM user_roles
     WHERE status = 'active' AND revoked_at IS NULL
     ORDER BY id`,
  );
  return result.rows;
}

async function login(identifier, schoolCode) {
  const response = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password: "1234", schoolCode },
  });
  assert.equal(response.status, 200, `login ${identifier}: ${response.text}`);
  assert.ok(response.data?.accessToken, `jeton absent pour ${identifier}`);
  return response.data.accessToken;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("postgresSeedUserRoles.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  enableDemoSeed();
  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: isolatedUrl });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
    await reset.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  } finally {
    await reset.end();
  }

  const pool = new Pool({ connectionString: isolatedUrl, application_name: TEST_APPLICATION_NAME });
  let child = null;
  let second = null;
  // Dernier recours si le processus de test se termine sans passer par finally :
  // aucun serveur enfant orphelin (port et sessions PostgreSQL libérés).
  const killOrphan = () => {
    if (child && !hasExited(child)) child.kill("SIGKILL");
  };
  process.once("exit", killOrphan);

  try {
    child = await startServer(isolatedUrl);

    const activeAfterSeed = await countActiveRoles(pool);
    assert.ok(activeAfterSeed > 0, "seed frais : user_roles actif non vide");
    const activeRowsAfterSeed = await activeRoleRows(pool);

    const schools = await pool.query(
      `SELECT id, school_code, login_code
       FROM schools
       WHERE school_code IN ('CD-2026-0001', 'BI-2026-0002')`,
    );
    const byCode = Object.fromEntries(schools.rows.map((row) => [row.school_code, row]));
    const schoolCd = byCode["CD-2026-0001"];
    const schoolBi = byCode["BI-2026-0002"];
    assert.ok(schoolCd?.id && schoolBi?.id, "écoles démo CD et BI présentes");

    const adminCd = await pool.query(
      `SELECT u.id, ur.school_id, ur.role_key
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active' AND ur.revoked_at IS NULL
       WHERE u.email = 'admin@unikin.somafrik'`,
    );
    assert.equal(adminCd.rowCount, 1, "school_admin CD : une seule affectation active");
    assert.equal(adminCd.rows[0].role_key, "SCHOOL_ADMIN");
    assert.equal(String(adminCd.rows[0].school_id), String(schoolCd.id));

    const adminBi = await pool.query(
      `SELECT ur.school_id, ur.role_key
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active' AND ur.revoked_at IS NULL
       WHERE u.email = 'admin@bujumbura.somafrik'`,
    );
    assert.equal(adminBi.rowCount, 1, "school_admin BI : une seule affectation active");
    assert.equal(adminBi.rows[0].role_key, "SCHOOL_ADMIN");
    assert.equal(String(adminBi.rows[0].school_id), String(schoolBi.id));
    assert.notEqual(String(adminBi.rows[0].school_id), String(schoolCd.id));

    const teacher = await pool.query(
      `SELECT ur.role_key, ur.school_id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active' AND ur.revoked_at IS NULL
       WHERE u.email = 'jean.kabeya@somafrik.cd'`,
    );
    assert.ok(teacher.rows.some((row) => row.role_key === "TEACHER"));
    assert.ok(teacher.rows.every((row) => String(row.school_id) === String(schoolCd.id)));

    const unmapped = await pool.query(
      `SELECT role, COUNT(*)::int AS count
       FROM users
       WHERE role IS NOT NULL
         AND upper(btrim(role)) NOT IN (
           'SUPER_ADMIN', 'COUNTRY_ADMIN', 'SCHOOL_ADMIN', 'PROVISEUR', 'PRINCIPAL',
           'PREFET_ETUDES', 'TEACHER', 'SECRETARY', 'ACCOUNTANT', 'PARENT', 'STUDENT', 'SUPERVISOR'
         )
       GROUP BY role`,
    );
    assert.equal(unmapped.rowCount, 0, "aucun libellé non canonique persisté dans users.role");
    const invented = await pool.query(
      `SELECT role_key, COUNT(*)::int AS count
       FROM user_roles
       WHERE upper(role_key) NOT IN (
         'SUPER_ADMIN', 'COUNTRY_ADMIN', 'SCHOOL_ADMIN', 'PROVISEUR', 'PRINCIPAL',
         'PREFET_ETUDES', 'TEACHER', 'SECRETARY', 'ACCOUNTANT', 'PARENT', 'STUDENT', 'SUPERVISOR'
       )
       GROUP BY role_key`,
    );
    assert.equal(invented.rowCount, 0, "aucun role_key inventé");

    const duplicates = await pool.query(
      `SELECT user_id, school_id, role_key, COUNT(*)::int AS count
       FROM user_roles
       WHERE status = 'active' AND revoked_at IS NULL
       GROUP BY user_id, school_id, role_key
       HAVING COUNT(*) > 1`,
    );
    assert.equal(duplicates.rowCount, 0, "aucune affectation active dupliquée");

    const cdPayments = await pool.query(
      `SELECT p.payment_code
       FROM payments p
       WHERE p.school_id = $1`,
      [schoolCd.id],
    );
    assert.ok(cdPayments.rowCount > 0, "le seed CD contient des paiements");
    const cdPaymentCodes = cdPayments.rows.map((row) => row.payment_code);

    const cdLoginCode = schoolCd.login_code || schoolCd.school_code;
    const biLoginCode = schoolBi.login_code || schoolBi.school_code;
    const adminToken = await login("admin@unikin.somafrik", cdLoginCode);
    const teacherToken = await login("jean.kabeya@somafrik.cd", cdLoginCode);
    const biToken = await login("admin@bujumbura.somafrik", biLoginCode);

    for (const pathName of FINANCE_READS) {
      const allowed = await request(pathName, { token: adminToken });
      assert.equal(allowed.status, 200, `school_admin CD ${pathName} → ${allowed.status} ${allowed.text}`);
      const denied = await request(pathName, { token: teacherToken });
      assert.equal(denied.status, 403, `enseignant ${pathName} → ${denied.status}`);
    }

    const cdList = await request("/payments", { token: adminToken });
    const biList = await request("/payments", { token: biToken });
    assert.equal(cdList.status, 200);
    assert.equal(biList.status, 200);
    for (const code of cdPaymentCodes) {
      assert.match(cdList.text, new RegExp(code));
      assert.doesNotMatch(biList.text, new RegExp(code), `fuite paiement ${code} vers l'école BI`);
    }

    const revokedByTest = await pool.query(
      `UPDATE user_roles
       SET status = 'revoked', revoked_at = NOW()
       WHERE user_id = $1 AND role_key = 'SCHOOL_ADMIN' AND status = 'active'
       RETURNING id`,
      [adminCd.rows[0].id],
    );
    for (const pathName of FINANCE_READS) {
      const revoked = await request(pathName, { token: adminToken });
      assert.equal(revoked.status, 403, `révocation live ${pathName} → ${revoked.status}`);
    }

    const activeAfterHttp = await countActiveRoles(pool);
    assert.ok(activeAfterHttp < activeAfterSeed, "la révocation retire l'affectation active");

    // Second boot du schéma user_roles sur une base libérée : serveur arrêté et
    // toutes ses sessions fermées (sinon deadlock 40P01 avec son travail de fond).
    // Il a lieu après les contrôles HTTP car server.js ne redémarre pas sur une
    // base déjà amorcée par la démo (CANONICAL_SCHOOL_COURSE_AMBIGUOUS).
    await stopServerAndReleaseDatabase(child, pool);
    child = null;
    // Retour exact à l'état post-seed : seules les lignes révoquées par ce test
    // sont réactivées. Le second boot est ainsi vérifié sur l'état du seed,
    // comme avant (la réactivation au boot d'un rôle révoqué est un constat
    // produit distinct, documenté dans docs/project/BACKEND-TEST-BASELINE.md).
    const restored = await pool.query(
      `UPDATE user_roles
       SET status = 'active', revoked_at = NULL
       WHERE id::text = ANY($1::text[]) AND status = 'revoked'`,
      [revokedByTest.rows.map((row) => String(row.id))],
    );
    assert.equal(restored.rowCount, revokedByTest.rowCount, "état post-seed restauré avant le second boot");
    assert.deepEqual(await activeRoleRows(pool), activeRowsAfterSeed, "état post-seed restauré avant le second boot");
    second = createPostgresRepository({ connectionString: isolatedUrl, application_name: TEST_APPLICATION_NAME });
    await second.ensureUserRolesCanonicalSchema();
    await second.ensureSeededUserRoles();
    await second.pool.end();
    second = null;
    const activeAfterSecondBoot = await countActiveRoles(pool);
    assert.equal(activeAfterSecondBoot, activeAfterSeed, "second passage : aucun doublon user_roles");
    assert.deepEqual(await activeRoleRows(pool), activeRowsAfterSeed, "second passage : affectations actives inchangées");
    const duplicatesAfterSecondBoot = await pool.query(
      `SELECT user_id, school_id, role_key, COUNT(*)::int AS count
       FROM user_roles
       WHERE status = 'active' AND revoked_at IS NULL
       GROUP BY user_id, school_id, role_key
       HAVING COUNT(*) > 1`,
    );
    assert.equal(duplicatesAfterSecondBoot.rowCount, 0, "second passage : aucune affectation active dupliquée");
    console.log("postgresSeedUserRoles.pg.test.js OK");
  } finally {
    // Le nettoyage continue même si l'arrêt échoue ; l'échec reste visible.
    await stopChildProcess(child).catch((error) => {
      console.error(`FAIL arrêt du serveur enfant : ${error.message}`);
      process.exitCode = 1;
    });
    if (second) await second.pool.end().catch(() => {});
    await pool.end();
    process.removeListener("exit", killOrphan);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
