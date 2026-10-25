"use strict";

/**
 * SEC-AUTH-05 — révocation immédiate des rôles et permissions obsolètes.
 *
 * HTTP réel sur PostgreSQL jetable, comptes fictifs, aucun jeton journalisé.
 * Chaque scénario part d'un jeton émis AVANT le changement de rôle : le droit
 * retiré ne doit plus être utilisable, ni par la route, ni par un refresh.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { hashSecret } = require("../services/credentialService");
const {
  assertConnectedToDisposableDatabase,
  assertDisposableLocalDatabaseUrl,
} = require("./disposableTestDatabaseGuard");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_sec_auth_05_http_it";
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_SEC_AUTH_05_HTTP_PORT ?? 19955);
// Secrets propres au banc, générés à l'exécution (aucun littéral committé).
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const SECRET = `Sec-Auth-05-${crypto.randomBytes(6).toString("hex")}!`;
const PIN = String(100000 + crypto.randomInt(800000));

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function resetIsolatedDatabase() {
  assertDisposableLocalDatabaseUrl(DATABASE_URL);
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DATABASE]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = withDatabaseName(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: url, max: 1 });
  try {
    await assertConnectedToDisposableDatabase(reset, IT_DATABASE);
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }
  return url;
}

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    try {
      if ((await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const claims = (token) => JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));

// SEC_AUTH_05_REPRO=1 : relevé de tous les écarts (reproduction sur la base), sans arrêt.
const REPRO = process.env.SEC_AUTH_05_REPRO === "1";
const defects = [];
function assertStatus(response, expected, label) {
  const ok = Array.isArray(expected) ? expected.includes(response.status) : response.status === expected;
  if (!ok && REPRO) {
    defects.push(`${label} : attendu ${expected}, reçu ${response.status}`);
    return;
  }
  assert.ok(ok, `${label} : attendu ${expected}, reçu ${response.status}`);
}
function check(condition, label) {
  if (!condition && REPRO) {
    defects.push(label);
    return;
  }
  assert.ok(condition, label);
}

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency, is_active)
     VALUES ('RDC', 'CD', '+243', 'CDF', TRUE)
     ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const insertSchool = async (code, shortCode, name) =>
    (
      await pool.query(
        `INSERT INTO schools (country_id, school_code, short_code, name, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING id, login_code`,
        [country.rows[0].id, code, shortCode, name],
      )
    ).rows[0];
  const schoolA = await insertSchool("CD-2026-0951", "SCA", "Institut Auth5 A");
  const schoolB = await insertSchool("CD-2026-0952", "SCB", "Institut Auth5 B");

  const passwordHash = hashSecret(SECRET);
  const pinHash = hashSecret(PIN);
  const insertUser = async (code, schoolId, role) =>
    (
      await pool.query(
        `INSERT INTO users (school_id, user_code, first_name, last_name, role, status,
                            password_hash, pin_hash, must_change_password, profile_payload)
         VALUES ($1, $2, 'Fictif', $7, $3, 'active', $4, $5, FALSE, $6::jsonb) RETURNING id`,
        [schoolId, code, role, passwordHash, pinHash, JSON.stringify({ countryCode: "CD", countryScope: "CD" }), code],
      )
    ).rows[0].id;
  const grant = (userId, schoolId, roleKey) =>
    pool.query(`INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, $3, 'active')`, [
      userId,
      schoolId,
      roleKey,
    ]);

  const users = {};
  for (const key of ["lastRole", "refresher", "demoted", "regrant", "inactive", "concurrent", "target", "keeper"]) {
    users[key] = await insertUser(`ST05-${key.toUpperCase()}`, schoolA.id, "SCHOOL_ADMIN");
    await grant(users[key], schoolA.id, "SCHOOL_ADMIN");
  }
  users.multi = await insertUser("ST05-MULTI", schoolA.id, "SCHOOL_ADMIN");
  await grant(users.multi, schoolA.id, "SCHOOL_ADMIN");
  await grant(users.multi, schoolA.id, "TEACHER");
  // Compte legacy : rôle uniquement dans users.role, aucun enregistrement user_roles.
  users.legacy = await insertUser("ST05-LEGACY", schoolA.id, "SCHOOL_ADMIN");
  users.adminB = await insertUser("ST05-ADMIN-B", schoolB.id, "SCHOOL_ADMIN");
  await grant(users.adminB, schoolB.id, "SCHOOL_ADMIN");
  users.superadmin = await insertUser("ST05-SUPER", null, "SUPER_ADMIN");
  await grant(users.superadmin, null, "SUPER_ADMIN");
  users.pays = await insertUser("ST05-PAYS", null, "COUNTRY_ADMIN");
  await grant(users.pays, null, "COUNTRY_ADMIN");
  return { schoolA, schoolB, users };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("secAuth05RoleRevocation.http.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const url = await resetIsolatedDatabase();
  const repo = createPostgresRepository(url);
  const pool = new Pool({ connectionString: url });
  let child = null;
  const passed = [];
  const ok = (label) => passed.push(label);

  try {
    await repo.init();
    const { schoolA, schoolB, users } = await seed(pool);

    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(HTTP_PORT),
        DATABASE_URL: url,
        JWT_SECRET,
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        SOMAFRIK_API_ONLY: "true",
        SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrRef = { value: "" };
    child.stderr.on("data", (chunk) => {
      stderrRef.value += String(chunk);
    });
    child.stdout.on("data", () => {});
    await waitForHealth(child, stderrRef);

    const webLogin = (code, schoolCode) =>
      request("/backoffice/login", {
        method: "POST",
        body: { identifier: code, password: SECRET, ...(schoolCode ? { schoolCode } : {}) },
      });
    const mobileLogin = (role, code, schoolCode) =>
      request("/login", { method: "POST", body: { role, identifier: code, pin: PIN, schoolCode } });
    const login = async (code, schoolCode) => {
      const response = await webLogin(code, schoolCode);
      assertStatus(response, 200, `connexion ${code}`);
      return response.data;
    };
    const adminRoute = (token) => request("/teachers?page=1&limit=5", { token });
    const platformRoute = (token) => request("/backoffice/countries", { token });
    // Corps vide : 400 si la permission est accordée, 403 sinon (aucune réinitialisation).
    const resetPassword = (token) => request(`/users/${users.target}/reset-password`, { method: "POST", token, body: {} });
    const revokeRole = (userId, roleKey) =>
      pool.query(
        `UPDATE user_roles SET status = 'revoked', revoked_at = NOW()
         WHERE user_id = $1 AND status = 'active' ${roleKey ? "AND role_key = $2" : ""}`,
        roleKey ? [userId, roleKey] : [userId],
      );
    const grantRole = (userId, schoolId, roleKey) =>
      pool.query(`INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, $3, 'active')`, [
        userId,
        schoolId,
        roleKey,
      ]);

    // AUTH5-01 / 15 — rôle actif : accès conforme ; Web et Mobile légitimes.
    const keeper = await login("ST05-KEEPER", schoolA.login_code);
    assertStatus(await adminRoute(keeper.accessToken), 200, "AUTH5-01 admin actif");
    assertStatus(await resetPassword(keeper.accessToken), 400, "AUTH5-01 réinitialisation autorisée (corps refusé)");
    const keeperMobile = await mobileLogin("school_admin", "ST05-KEEPER", schoolA.login_code);
    assertStatus(keeperMobile, 200, "AUTH5-15 connexion Mobile");
    assertStatus(await adminRoute(keeperMobile.data.accessToken), 200, "AUTH5-15 jeton Mobile");
    ok("AUTH5-01 / 15 rôle actif : accès conforme, Web et Mobile");

    // AUTH5-03 — retrait du dernier rôle actif.
    const lastRole = await login("ST05-LASTROLE", schoolA.login_code);
    assertStatus(await adminRoute(lastRole.accessToken), 200, "AUTH5-03 avant retrait");
    await revokeRole(users.lastRole);
    assertStatus(await adminRoute(lastRole.accessToken), [401, 403], "AUTH5-03 route admin après retrait du dernier rôle");
    assertStatus(await resetPassword(lastRole.accessToken), [401, 403], "AUTH5-03 réinitialisation après retrait du dernier rôle");
    ok("AUTH5-03 retrait du dernier rôle : accès protégé refusé");

    // AUTH5-13 — refresh après retrait : aucun droit obsolète réémis.
    const refresher = await login("ST05-REFRESHER", schoolA.login_code);
    await revokeRole(users.refresher);
    const refreshed = await request("/auth/refresh", { method: "POST", body: { refreshToken: refresher.refreshToken } });
    if (refreshed.status === 200) {
      const fresh = claims(refreshed.data.accessToken);
      check(!(fresh.roleKeys ?? []).includes("SCHOOL_ADMIN"), "AUTH5-13 rôle retiré absent du jeton rafraîchi");
      check(!(fresh.permissions ?? []).includes("ALL_PRIVILEGES") && !(fresh.permissions ?? []).includes("Gérer utilisateurs"), "AUTH5-13 privilèges retirés absents du jeton rafraîchi");
      check(fresh.role === "Sans affectation", `AUTH5-13 libellé de rôle du jeton rafraîchi : ${fresh.role}`);
      assertStatus(await adminRoute(refreshed.data.accessToken), [401, 403], "AUTH5-13 route admin avec le jeton rafraîchi");
    } else {
      assertStatus(refreshed, 401, "AUTH5-13 refresh refusé");
    }
    ok(`AUTH5-13 refresh après retrait : aucun droit réémis (HTTP ${refreshed.status})`);

    // AUTH5-02 / 07 / 11 — rôle remplacé (SCHOOL_ADMIN → TEACHER).
    const demoted = await login("ST05-DEMOTED", schoolA.login_code);
    await revokeRole(users.demoted, "SCHOOL_ADMIN");
    await grantRole(users.demoted, schoolA.id, "TEACHER");
    assertStatus(await adminRoute(demoted.accessToken), 403, "AUTH5-02 route admin après rétrogradation");
    assertStatus(await resetPassword(demoted.accessToken), 403, "AUTH5-07 réinitialisation après rétrogradation (permission du jeton)");
    const teacherPerms = await request("/auth/effective-permissions", { token: demoted.accessToken });
    assertStatus(teacherPerms, 200, "AUTH5-11 permissions effectives");
    check(JSON.stringify(teacherPerms.data.roleKeys) === JSON.stringify(["TEACHER"]), `AUTH5-11 rôles effectifs actualisés : ${JSON.stringify(teacherPerms.data.roleKeys)}`);
    ok("AUTH5-02 / 07 / 11 rôle remplacé : anciens privilèges refusés, permissions actualisées");

    // AUTH5-05 — multirôle : retrait d'un rôle, l'autre reste utilisable.
    const multi = await login("ST05-MULTI", schoolA.login_code);
    await revokeRole(users.multi, "SCHOOL_ADMIN");
    assertStatus(await adminRoute(multi.accessToken), 403, "AUTH5-05 droit du rôle retiré");
    assertStatus(await resetPassword(multi.accessToken), 403, "AUTH5-05 réinitialisation du rôle retiré");
    const multiPerms = await request("/auth/effective-permissions", { token: multi.accessToken });
    assertStatus(multiPerms, 200, "AUTH5-05 session conservée");
    check(JSON.stringify(multiPerms.data.roleKeys) === JSON.stringify(["TEACHER"]), `AUTH5-05 rôle restant actif : ${JSON.stringify(multiPerms.data.roleKeys)}`);
    ok("AUTH5-05 multirôle : rôle retiré refusé, rôle restant conservé");

    // AUTH5-08 — réattribution : accès rétabli seulement après la nouvelle attribution.
    const regrant = await login("ST05-REGRANT", schoolA.login_code);
    await revokeRole(users.regrant);
    assertStatus(await adminRoute(regrant.accessToken), [401, 403], "AUTH5-08 après retrait");
    await grantRole(users.regrant, schoolA.id, "SCHOOL_ADMIN");
    assertStatus(await adminRoute(regrant.accessToken), 200, "AUTH5-08 après réattribution");
    ok("AUTH5-08 réattribution : accès rétabli uniquement après validation");

    // AUTH5-04 — utilisateur désactivé.
    const inactive = await login("ST05-INACTIVE", schoolA.login_code);
    await pool.query("UPDATE users SET status = 'inactive' WHERE id = $1", [users.inactive]);
    assertStatus(await adminRoute(inactive.accessToken), 401, "AUTH5-04 compte désactivé");
    assertStatus(await request("/auth/refresh", { method: "POST", body: { refreshToken: inactive.refreshToken } }), 401, "AUTH5-04 refresh");
    ok("AUTH5-04 utilisateur désactivé : accès et refresh refusés");

    // AUTH5-06 — rôle d'un autre établissement : sa session ne donne rien sur A.
    const adminB = await login("ST05-ADMIN-B", schoolB.login_code);
    const crossList = await request("/teachers?page=1&limit=50", {
      token: adminB.accessToken,
    });
    assertStatus(crossList, 200, "AUTH5-06 admin B sur son établissement");
    assert.ok(!JSON.stringify(crossList.data).includes("ST05-KEEPER"), "AUTH5-06 aucune donnée de A");
    ok("AUTH5-06 rôle d'un autre établissement : aucun accès à A");

    // AUTH5-09 / 10 — comptes plateforme : retrait du rôle plateforme.
    const superWeb = await login("ST05-SUPER");
    const paysWeb = await login("ST05-PAYS");
    assertStatus(await platformRoute(superWeb.accessToken), 200, "AUTH5-09 Superadmin actif");
    assertStatus(await platformRoute(paysWeb.accessToken), 200, "AUTH5-10 Admin Pays actif");
    assertStatus(await adminRoute(superWeb.accessToken), [403], "AUTH5-09 aucun privilège scolaire implicite");
    await revokeRole(users.superadmin);
    await revokeRole(users.pays);
    assertStatus(await platformRoute(superWeb.accessToken), [401, 403], "AUTH5-09 Superadmin après retrait");
    assertStatus(await platformRoute(paysWeb.accessToken), [401, 403], "AUTH5-10 Admin Pays après retrait");
    ok("AUTH5-09 / 10 comptes plateforme : rôle retiré refusé, aucun privilège scolaire implicite");

    // AUTH5-16 — changements simultanés : retrait et réattribution concurrents.
    const concurrent = await login("ST05-CONCURRENT", schoolA.login_code);
    await Promise.all([
      revokeRole(users.concurrent, "SCHOOL_ADMIN"),
      grantRole(users.concurrent, schoolA.id, "TEACHER"),
    ]);
    const concurrentResults = await Promise.all(Array.from({ length: 6 }, () => adminRoute(concurrent.accessToken)));
    check(concurrentResults.every((r) => r.status === 403), `AUTH5-16 : ${concurrentResults.map((r) => r.status)}`);
    ok("AUTH5-16 changements simultanés : aucun privilège périmé accepté");

    // Compte legacy sans user_roles : le repli sur le rôle de connexion est conservé.
    const legacy = await login("ST05-LEGACY", schoolA.login_code);
    const legacyAccess = await adminRoute(legacy.accessToken);
    const legacyRefresh = await request("/auth/refresh", { method: "POST", body: { refreshToken: legacy.refreshToken } });
    assertStatus(legacyRefresh, 200, "legacy refresh");
    check(
      (await adminRoute(legacyRefresh.data.accessToken)).status === legacyAccess.status,
      "legacy : même accès après refresh qu'à la connexion",
    );
    ok(`compte legacy sans user_roles : comportement inchangé (HTTP ${legacyAccess.status})`);

    // AUTH5-14 — session révoquée.
    assertStatus(await request("/auth/logout", { method: "POST", token: keeper.accessToken }), 200, "AUTH5-14 logout");
    assertStatus(await adminRoute(keeper.accessToken), 401, "AUTH5-14 session révoquée");
    ok("AUTH5-14 session révoquée : accès refusé");

    if (REPRO) {
      for (const defect of defects) console.log(`DÉFAUT ${defect}`);
      console.log(`secAuth05RoleRevocation.http.pg.test.js: REPRO ${defects.length} écart(s)`);
      if (defects.length) process.exitCode = 1;
      return;
    }
    for (const label of passed) console.log(`OK ${label}`);
    console.log(`secAuth05RoleRevocation.http.pg.test.js: ${passed.length} contrôles OK`);
  } catch (error) {
    for (const label of passed) console.log(`OK ${label}`);
    throw error;
  } finally {
    await stopChild(child);
    await pool.end().catch(() => {});
    await repo.close?.().catch?.(() => {});
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
