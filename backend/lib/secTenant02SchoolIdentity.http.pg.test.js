"use strict";

/**
 * SEC-TENANT-02 / F6 — cohérence canonique schoolCode ↔ schoolId.
 *
 * HTTP réel sur PostgreSQL jetable, comptes fictifs, aucun jeton journalisé.
 * Les jetons « incohérents » sont signés avec le secret du banc (scénario
 * d'un jeton forgé ou mal émis) : un JWT valide et une session active ne
 * suffisent pas si les identifiants d'établissement se contredisent.
 *
 * SEC_TENANT_02_REPRO=1 : relevé de tous les écarts (reproduction sur la base).
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { hashSecret } = require("../services/credentialService");
const { TokenService } = require("../services/tokenService");
const {
  assertConnectedToDisposableDatabase,
  assertDisposableLocalDatabaseUrl,
} = require("./disposableTestDatabaseGuard");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_sec_tenant_02_http_it";
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_SEC_TENANT_02_HTTP_PORT ?? 19962);
// Secrets propres au banc, générés à l'exécution (aucun littéral committé).
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const SECRET = `Sec-Tenant-02-${crypto.randomBytes(6).toString("hex")}!`;
const PIN = String(100000 + crypto.randomInt(800000));

const CLASS_A = "11111111-aaaa-4aaa-8aaa-000000000002";
const CLASS_B = "11111111-bbbb-4bbb-8bbb-000000000002";
const ACTIVITY_A = "22222222-aaaa-4aaa-8aaa-000000000002";
const ACTIVITY_B = "22222222-bbbb-4bbb-8bbb-000000000002";
const UNKNOWN_SCHOOL_ID = "33333333-cccc-4ccc-8ccc-000000000002";

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

async function request(pathname, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
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

const REPRO = process.env.SEC_TENANT_02_REPRO === "1";
const defects = [];
function assertStatus(response, expected, label) {
  const ok = Array.isArray(expected) ? expected.includes(response.status) : response.status === expected;
  if (!ok && REPRO) {
    defects.push(`${label} : attendu ${expected}, reçu ${response.status}`);
    return false;
  }
  assert.ok(ok, `${label} : attendu ${expected}, reçu ${response.status} ${response.text?.slice(0, 200) ?? ""}`);
  return true;
}
function check(condition, label) {
  if (!condition && REPRO) {
    defects.push(label);
    return false;
  }
  assert.ok(condition, label);
  return true;
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
         VALUES ($1, $2, $3, $4, 'active') RETURNING id, school_code, login_code`,
        [country.rows[0].id, code, shortCode, name],
      )
    ).rows[0];
  const schoolA = await insertSchool("CD-2026-0961", "TNA", "Institut Tenant2 A");
  const schoolB = await insertSchool("CD-2026-0962", "TNB", "Institut Tenant2 B");
  // Établissement d'un autre pays : hors périmètre de l'Admin Pays CD.
  const countryCi = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency, is_active)
     VALUES ('Côte d''Ivoire', 'CI', '+225', 'XOF', TRUE)
     ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const schoolC = (
    await pool.query(
      `INSERT INTO schools (country_id, school_code, short_code, name, status)
       VALUES ($1, 'CI-2026-0963', 'TNC', 'Institut Tenant2 C', 'active') RETURNING id, school_code, login_code`,
      [countryCi.rows[0].id],
    )
  ).rows[0];

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
  users.adminA = await insertUser("ST06-ADMIN-A", schoolA.id, "SCHOOL_ADMIN");
  await grant(users.adminA, schoolA.id, "SCHOOL_ADMIN");
  users.adminB = await insertUser("ST06-ADMIN-B", schoolB.id, "SCHOOL_ADMIN");
  await grant(users.adminB, schoolB.id, "SCHOOL_ADMIN");
  users.adminB2 = await insertUser("ST06-ADMIN-B2", schoolB.id, "SCHOOL_ADMIN");
  await grant(users.adminB2, schoolB.id, "SCHOOL_ADMIN");
  // Multirôle deux établissements : rattaché à A (enseignant), administrateur dans B.
  users.dual = await insertUser("ST06-DUAL", schoolA.id, "TEACHER");
  await grant(users.dual, schoolA.id, "TEACHER");
  await grant(users.dual, schoolB.id, "SCHOOL_ADMIN");
  // Compte qui changera d'établissement après retrait de ses rôles.
  users.drifter = await insertUser("ST06-DRIFTER", schoolA.id, "SCHOOL_ADMIN");
  await grant(users.drifter, schoolA.id, "SCHOOL_ADMIN");
  users.mover = await insertUser("ST06-MOVER", schoolA.id, "SCHOOL_ADMIN");
  await grant(users.mover, schoolA.id, "SCHOOL_ADMIN");
  users.outage = await insertUser("ST06-OUTAGE", schoolB.id, "SCHOOL_ADMIN");
  await grant(users.outage, schoolB.id, "SCHOOL_ADMIN");
  // Compte legacy : rôle uniquement dans users.role, aucun enregistrement user_roles.
  users.legacy = await insertUser("ST06-LEGACY", schoolB.id, "SCHOOL_ADMIN");
  users.superadmin = await insertUser("ST06-SUPER", null, "SUPER_ADMIN");
  await grant(users.superadmin, null, "SUPER_ADMIN");
  users.pays = await insertUser("ST06-PAYS", null, "COUNTRY_ADMIN");
  await grant(users.pays, null, "COUNTRY_ADMIN");

  for (const [schoolId, classId, label] of [
    [schoolA.id, CLASS_A, "A"],
    [schoolB.id, CLASS_B, "B"],
  ]) {
    const year = (
      await pool.query(
        `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2026-2027', 'open') RETURNING id`,
        [schoolId],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [classId, schoolId, year, `T2-CLS-${label}`, `Classe Tenant2 ${label}`],
    );
  }
  for (const [id, schoolId, label] of [
    [ACTIVITY_A, schoolA.id, "A"],
    [ACTIVITY_B, schoolB.id, "B"],
  ]) {
    await pool.query(
      `INSERT INTO audit_logs (id, school_id, action, entity_type, entity_id, new_value)
       VALUES ($1, $2, 'create_class', 'class', $3, $4::jsonb)`,
      [id, schoolId, `T2-CLS-${label}`, JSON.stringify({ name: `Classe Tenant2 ${label}` })],
    );
  }
  return { schoolA, schoolB, schoolC, users };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("secTenant02SchoolIdentity.http.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const url = await resetIsolatedDatabase();
  const repo = createPostgresRepository(url);
  const pool = new Pool({ connectionString: url });
  const tokens = new TokenService({ secret: JWT_SECRET });
  let child = null;
  const passed = [];
  const ok = (label) => passed.push(label);

  try {
    await repo.init();
    const { schoolA, schoolB, schoolC, users } = await seed(pool);

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
        APP_ENV: "preproduction",
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
    const login = async (code, schoolCode) => {
      const response = await webLogin(code, schoolCode);
      assert.equal(response.status, 200, `connexion ${code} : ${response.text.slice(0, 200)}`);
      return response.data;
    };
    const refresh = (refreshToken) => request("/auth/refresh", { method: "POST", body: { refreshToken } });
    const classNames = (response) =>
      (Array.isArray(response.data) ? response.data : response.data?.items ?? []).map((row) => String(row?.name ?? row?.className ?? ""));
    const classes = (token, headers) => request("/classes", { token, headers });
    const activities = (token) => request("/dashboard/school-activities", { token });
    const activityIds = (response) => (response.data?.items ?? []).map((row) => row.id);
    const adminRoute = (token) => request("/teachers?page=1&limit=5", { token });
    const exportData = (token) => request("/data-export", { token });
    const leaksA = (response) => response.text.includes("Classe Tenant2 A") || response.text.includes(ACTIVITY_A);
    const forge = (base, overrides) => tokens.createAccessToken({ ...claims(base), ...overrides });

    const adminA = await login("ST06-ADMIN-A", schoolA.login_code);
    const adminAClaims = claims(adminA.accessToken);

    // --- TENANT2-01 : identité concordante → accès selon RBAC, son seul établissement ---
    const adminB = await login("ST06-ADMIN-B", schoolB.login_code);
    const adminBClaims = claims(adminB.accessToken);
    check(adminBClaims.schoolId === schoolB.id, "TENANT2-01 jeton B : schoolId canonique B");
    const ownClasses = await classes(adminB.accessToken);
    assertStatus(ownClasses, 200, "TENANT2-01 classes B");
    check(classNames(ownClasses).includes("Classe Tenant2 B") && !leaksA(ownClasses), "TENANT2-01 classes : B uniquement");
    const ownActivities = await activities(adminB.accessToken);
    assertStatus(ownActivities, 200, "TENANT2-01 activités B");
    check(activityIds(ownActivities).includes(ACTIVITY_B) && !leaksA(ownActivities), "TENANT2-01 activités : B uniquement");
    ok("TENANT2-01 identité concordante : accès à B uniquement");

    // --- TENANT2-02 : schoolCode A + schoolId B (et inverse) sur la session de B ---
    const codeA = forge(adminB.accessToken, { schoolCode: adminAClaims.schoolCode });
    const codeAClasses = await classes(codeA);
    if (codeAClasses.status === 200 && leaksA(codeAClasses)) defects.push("TENANT2-02 schoolCode A + schoolId B : classes de A servies");
    assertStatus(codeAClasses, 401, "TENANT2-02 schoolCode A + schoolId B (classes)");
    const idA = forge((await login("ST06-ADMIN-B", schoolB.login_code)).accessToken, { schoolId: schoolA.id });
    const idAActivities = await activities(idA);
    if (idAActivities.status === 200 && leaksA(idAActivities)) defects.push("TENANT2-02 schoolCode B + schoolId A : activités de A servies");
    assertStatus(idAActivities, 401, "TENANT2-02 schoolCode B + schoolId A (activités)");
    ok("TENANT2-02 contradiction schoolCode / schoolId → 401, aucune donnée de A");

    // --- TENANT2-03 / 04 : établissement inconnu ---
    const unknownCode = forge((await login("ST06-ADMIN-B", schoolB.login_code)).accessToken, { schoolCode: "CD-ZZZ-26-999" });
    assertStatus(await classes(unknownCode), 401, "TENANT2-03 code d'établissement inconnu");
    const unknownId = forge((await login("ST06-ADMIN-B", schoolB.login_code)).accessToken, { schoolId: UNKNOWN_SCHOOL_ID });
    assertStatus(await activities(unknownId), 401, "TENANT2-04 ID d'établissement inconnu");
    ok("TENANT2-03 / 04 établissement inconnu → 401");

    // --- TENANT2-05 : signature invalide ---
    const fresh = await login("ST06-ADMIN-B", schoolB.login_code);
    const [h, p, s] = String(fresh.accessToken).split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ ...claims(fresh.accessToken), schoolCode: adminAClaims.schoolCode, schoolId: schoolA.id })).toString("base64url");
    assertStatus(await classes(`${h}.${tamperedPayload}.${s}`), 401, "TENANT2-05 charge modifiée, signature d'origine");
    assertStatus(await classes(new TokenService({ secret: crypto.randomBytes(32).toString("hex") }).createAccessToken(claims(fresh.accessToken))), 401, "TENANT2-05 autre secret");
    ok("TENANT2-05 signature invalide → 401");

    // --- TENANT2-06 : session active, tenant entièrement d'un autre établissement ---
    const fullA = forge((await login("ST06-ADMIN-B", schoolB.login_code)).accessToken, {
      schoolCode: adminAClaims.schoolCode,
      schoolId: schoolA.id,
    });
    assertStatus(await classes(fullA), 401, "TENANT2-06 session B, identité établissement A");
    ok("TENANT2-06 session active, tenant incohérent → 401");

    // --- TENANT2-07 : refresh d'une identité devenue incohérente ---
    // a) rôles retirés puis compte déplacé vers B : le refresh ne doit plus porter A.
    const drifter = await login("ST06-DRIFTER", schoolA.login_code);
    await pool.query(`UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1`, [users.drifter]);
    await pool.query(`UPDATE users SET school_id = $2 WHERE id = $1`, [users.drifter, schoolB.id]);
    const drifterRefresh = await refresh(drifter.refreshToken);
    const drifterSchool = drifterRefresh.status === 200 ? claims(drifterRefresh.data.accessToken).schoolCode : null;
    check(
      drifterRefresh.status === 401 || ![schoolA.school_code, schoolA.login_code].includes(String(drifterSchool ?? "").toUpperCase()),
      `TENANT2-07 refresh après départ vers B : jeton encore rattaché à A (${drifterRefresh.status}, ${drifterSchool})`,
    );
    if (drifterRefresh.status === 200) {
      const device = await request("/mobile/push-devices", {
        method: "POST",
        token: drifterRefresh.data.accessToken,
        body: { expoPushToken: "ExponentPushToken[sec-tenant-02-drifter]", platform: "android", appProfile: "preview" },
      });
      const stored = await pool.query(`SELECT school_id::text AS school_id FROM mobile_push_devices WHERE user_id = $1`, [users.drifter]);
      check(
        !stored.rows.some((row) => row.school_id === schoolA.id),
        `TENANT2-07 appareil push enregistré sur l'établissement A après départ (${device.status})`,
      );
    }
    // b) changement d'établissement d'un rôle scolaire : refresh refusé (SEC-TENANT-01, conservé).
    const mover = await login("ST06-MOVER", schoolA.login_code);
    await pool.query(`UPDATE users SET school_id = $2 WHERE id = $1`, [users.mover, schoolB.id]);
    assertStatus(await refresh(mover.refreshToken), 401, "TENANT2-07 refresh d'un rôle scolaire déplacé");
    ok("TENANT2-07 refresh : aucun droit ni rattachement de l'ancien établissement");

    // --- TENANT2-08 : multirôle deux établissements (enseignant A, administrateur B) ---
    const dual = await login("ST06-DUAL", schoolA.login_code);
    const dualClaims = claims(dual.accessToken);
    check(dualClaims.schoolId === schoolA.id, "TENANT2-08 jeton rattaché à A");
    check(!(dualClaims.roleKeys ?? []).includes("SCHOOL_ADMIN"), `TENANT2-08 rôle d'administration de B dans le jeton A (${JSON.stringify(dualClaims.roleKeys)})`);
    check(dualClaims.role !== "Admin School", `TENANT2-08 libellé de rôle du jeton A : ${dualClaims.role}`);
    assertStatus(await adminRoute(dual.accessToken), 403, "TENANT2-08 route d'administration sur A avec le rôle de B");
    assertStatus(await exportData(dual.accessToken), 403, "TENANT2-08 export de A avec le rôle de B");
    const dualActivities = await activities(dual.accessToken);
    if (dualActivities.status === 200 && leaksA(dualActivities)) defects.push("TENANT2-08 activités de A servies via le rôle de B");
    assertStatus(dualActivities, 403, "TENANT2-08 activités de A avec le rôle de B");
    const dualPermissions = await request("/auth/effective-permissions", { token: dual.accessToken });
    check(
      !JSON.stringify(dualPermissions.data ?? {}).includes("SCHOOL_ADMIN"),
      "TENANT2-08 permissions effectives : rôle de B absent dans A",
    );
    assertStatus(await classes(dual.accessToken, { "X-Somafrik-School-Code": schoolB.login_code }), 403, "TENANT2-08 bascule vers B par en-tête");
    const dualRefresh = await refresh(dual.refreshToken);
    assertStatus(dualRefresh, 200, "TENANT2-08 refresh multirôle");
    if (dualRefresh.status === 200) {
      const refreshedClaims = claims(dualRefresh.data.accessToken);
      check(refreshedClaims.role !== "Admin School", `TENANT2-08 refresh : libellé ${refreshedClaims.role}`);
      assertStatus(await adminRoute(dualRefresh.data.accessToken), 403, "TENANT2-08 refresh : route d'administration sur A");
    }
    ok("TENANT2-08 multirôle : permissions de B jamais appliquées aux données de A");

    // --- TENANT2-09 : rôle retiré (SEC-AUTH-05 conservé) ---
    const adminB2 = await login("ST06-ADMIN-B2", schoolB.login_code);
    await pool.query(`UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1`, [users.adminB2]);
    assertStatus(await adminRoute(adminB2.accessToken), [401, 403], "TENANT2-09 rôle retiré");
    ok("TENANT2-09 rôle retiré : aucun ancien accès");

    // --- TENANT2-10 / 11 : comptes plateforme, aucun accès scolaire implicite ---
    const superadmin = await login("ST06-SUPER");
    const superClaims = claims(superadmin.accessToken);
    check(!superClaims.schoolId, "TENANT2-10 jeton Superadmin sans schoolId");
    const superClasses = await classes(superadmin.accessToken, { "X-Somafrik-School-Code": schoolA.login_code });
    assertStatus(superClasses, [400, 403], "TENANT2-10 Superadmin : classes de A");
    check(!leaksA(superClasses), "TENANT2-10 Superadmin : aucune donnée de A");
    const superForged = forge(superadmin.accessToken, { schoolId: schoolA.id });
    const superForgedActivities = await activities(superForged);
    check(!leaksA(superForgedActivities), "TENANT2-10 Superadmin + schoolId A : aucune donnée de A");
    assertStatus(superForgedActivities, 401, "TENANT2-10 Superadmin portant un schoolId d'établissement");
    const pays = await login("ST06-PAYS");
    const paysClaims = claims(pays.accessToken);
    check(!paysClaims.schoolId && paysClaims.schoolCode === "*", "TENANT2-11 jeton Admin Pays sans établissement");
    // Contrat existant : établissement de son pays sur en-tête explicite, vérifié serveur.
    assertStatus(await classes(pays.accessToken, { "X-Somafrik-School-Code": schoolA.login_code }), 200, "TENANT2-11 Admin Pays : établissement de son pays");
    const paysOtherCountry = await classes(pays.accessToken, { "X-Somafrik-School-Code": schoolC.login_code });
    assertStatus(paysOtherCountry, 403, "TENANT2-11 Admin Pays : établissement d'un autre pays");
    check(!paysOtherCountry.text.includes("Tenant2"), "TENANT2-11 Admin Pays : aucune donnée hors pays");
    assertStatus(await classes(pays.accessToken), [400, 403], "TENANT2-11 Admin Pays sans en-tête : aucune école implicite");
    assertStatus(await request("/backoffice/countries", { token: pays.accessToken }), 200, "TENANT2-11 Admin Pays : gestion plateforme");
    assertStatus(await activities(forge(pays.accessToken, { schoolId: schoolA.id })), 401, "TENANT2-11 Admin Pays portant un schoolId d'établissement");
    ok("TENANT2-10 / 11 comptes plateforme : aucun accès scolaire implicite");

    // --- TENANT2-12 : synchronisation Mobile ---
    const mobileB = await request("/login", {
      method: "POST",
      body: { role: "school_admin", identifier: "ST06-ADMIN-B", pin: PIN, schoolCode: schoolB.login_code },
    });
    assertStatus(mobileB, 200, "TENANT2-12 connexion Mobile B");
    const syncB = await request("/mobile-sync/l1/classes", { token: mobileB.data.accessToken });
    assertStatus(syncB, 200, "TENANT2-12 synchronisation B");
    check(!leaksA(syncB), "TENANT2-12 synchronisation B : aucune donnée de A");
    const syncForged = await request("/mobile-sync/l1/classes", {
      token: forge(mobileB.data.accessToken, { schoolCode: adminAClaims.schoolCode }),
    });
    check(!leaksA(syncForged), "TENANT2-12 synchronisation, schoolCode A forgé : aucune donnée de A");
    assertStatus(syncForged, 401, "TENANT2-12 synchronisation, schoolCode A forgé");
    ok("TENANT2-12 synchronisation Mobile : aucune fuite inter-école");

    // --- TENANT2-13 : export ---
    const exportB = await exportData((await login("ST06-ADMIN-B", schoolB.login_code)).accessToken);
    assertStatus(exportB, 200, "TENANT2-13 export B");
    check(!leaksA(exportB), "TENANT2-13 export B : aucune donnée de A");
    const exportForged = await exportData(forge((await login("ST06-ADMIN-B", schoolB.login_code)).accessToken, { schoolCode: adminAClaims.schoolCode }));
    if (exportForged.status === 200 && leaksA(exportForged)) defects.push("TENANT2-13 export de A avec schoolCode forgé");
    assertStatus(exportForged, 401, "TENANT2-13 export, schoolCode A forgé");
    ok("TENANT2-13 export : tenant vérifié");

    // --- TENANT2-14 : identité legacy (aucun user_roles) ---
    const legacy = await login("ST06-LEGACY", schoolB.login_code);
    assertStatus(await classes(legacy.accessToken), 200, "TENANT2-14 legacy concordant");
    assertStatus(await classes(forge(legacy.accessToken, { schoolCode: adminAClaims.schoolCode })), 401, "TENANT2-14 legacy, schoolCode A forgé");
    ok("TENANT2-14 legacy : compatible si vérifié, refusé sinon");

    // --- TENANT2-16 : concurrence, changement d'établissement pendant les requêtes ---
    const concA = await login("ST06-ADMIN-A", schoolA.login_code);
    const concB = await login("ST06-ADMIN-B", schoolB.login_code);
    const burst = await Promise.all(
      Array.from({ length: 6 }, (_, index) => classes(index % 2 ? concB.accessToken : concA.accessToken)),
    );
    burst.forEach((response, index) => {
      const own = index % 2 ? "Classe Tenant2 B" : "Classe Tenant2 A";
      const other = index % 2 ? "Classe Tenant2 A" : "Classe Tenant2 B";
      check(response.status === 200 && response.text.includes(own) && !response.text.includes(other), `TENANT2-16 requête ${index} : tenant confondu`);
    });
    ok("TENANT2-16 concurrence : aucune confusion de tenant");

    // --- TENANT2-15 : PostgreSQL indisponible → fail-closed ---
    const outage = await login("ST06-OUTAGE", schoolB.login_code);
    await pool.query("ALTER TABLE schools RENAME TO schools_sec_tenant_02_outage");
    let outageClasses;
    let outageRefresh;
    try {
      outageClasses = await classes(outage.accessToken);
      outageRefresh = await refresh(outage.refreshToken);
    } finally {
      await pool.query("ALTER TABLE schools_sec_tenant_02_outage RENAME TO schools");
    }
    assertStatus(outageClasses, [401, 403, 500, 503], "TENANT2-15 classes pendant l'incident");
    check(!outageClasses.text.includes("Classe Tenant2"), "TENANT2-15 aucune donnée pendant l'incident");
    check(outageRefresh.status !== 200, `TENANT2-15 refresh pendant l'incident : ${outageRefresh.status}`);
    ok("TENANT2-15 PostgreSQL indisponible : fail-closed");

    if (REPRO) {
      console.log(`SEC-TENANT-02 REPRO : ${defects.length} écart(s)`);
      for (const defect of defects) console.log(`DÉFAUT ${defect}`);
    } else {
      for (const label of passed) console.log(`PASS ${label}`);
      console.log(`secTenant02SchoolIdentity.http.pg.test.js: OK ${passed.length}/${passed.length}`);
    }
  } finally {
    await stopChild(child);
    await pool.end();
    await repo.close?.();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
