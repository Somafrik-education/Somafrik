"use strict";

/**
 * SEC-AUTH-03 — liaison JWT ↔ session serveur, parcours HTTP PostgreSQL réels.
 *
 * Comptes fictifs, base isolée, aucun jeton journalisé. Couvre :
 *  - émission : Web, Mobile, Superadmin, Admin Pays, refresh et changement de
 *    mot de passe portent tous un sessionId ;
 *  - refus : sessionId inexistant, session révoquée (logout, revoke-all),
 *    jeton expiré, signature / algorithme / charge altérés, mauvais type,
 *    autre établissement ;
 *  - refresh après révocation ;
 *  - changement de mot de passe : les autres sessions sont révoquées ;
 *  - constats (comportement actuel documenté, non modifié ici) : jeton signé
 *    sans sessionId, sessionId d'un autre utilisateur — tous deux exigent le
 *    secret JWT du serveur.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { hashSecret } = require("../services/credentialService");
const {
  assertConnectedToDisposableDatabase,
  assertDisposableLocalDatabaseUrl,
} = require("./disposableTestDatabaseGuard");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_sec_auth_03_http_it";
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_SEC_AUTH_03_HTTP_PORT ?? 19932);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";
const SECRET = "Sec-Auth-03-Fictif!";
const NEW_SECRET = "Sec-Auth-03-Nouveau-2026!";
const PIN = "573916";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function resetIsolatedDatabase() {
  // Garde : instance locale jetable uniquement, avant toute connexion.
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
    // Garde côté serveur sur la connexion qui exécute le DROP.
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
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
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

function claims(token) {
  return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
}

/** Statut sans corps : aucun jeton n'est imprimé en cas d'échec. */
function assertStatus(response, expected, label) {
  assert.equal(response.status, expected, `${label} : attendu ${expected}, reçu ${response.status}`);
}

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency, is_active)
     VALUES ('RDC', 'CD', '+243', 'CDF', TRUE)
     ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  const insertSchool = async (code, shortCode, name) =>
    (
      await pool.query(
        `INSERT INTO schools (country_id, school_code, short_code, name, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING id, login_code`,
        [country.rows[0].id, code, shortCode, name],
      )
    ).rows[0];
  const schoolA = await insertSchool("CD-2026-0931", "SAA", "Institut Auth A");
  const schoolB = await insertSchool("CD-2026-0932", "SAB", "Institut Auth B");

  const passwordHash = hashSecret(SECRET);
  const pinHash = hashSecret(PIN);
  const insertUser = async (userCode, schoolId, role, firstName, lastName) =>
    (
      await pool.query(
        `INSERT INTO users (school_id, user_code, first_name, last_name, role, status,
                            password_hash, pin_hash, must_change_password, profile_payload)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, FALSE, $8::jsonb)
         RETURNING id`,
        [schoolId, userCode, firstName, lastName, role, passwordHash, pinHash, JSON.stringify({ countryCode: "CD", countryScope: "CD" })],
      )
    ).rows[0].id;
  const grant = (userId, schoolId, roleKey) =>
    pool.query(`INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, $3, 'active')`, [
      userId,
      schoolId,
      roleKey,
    ]);

  const users = {};
  for (const [key, code] of [
    ["adminA", "ST03-ADMIN-A"],
    ["revoker", "ST03-REVOKER"],
    ["pwd", "ST03-PWD"],
    ["other", "ST03-OTHER"],
    ["peer", "ST03-PEER"],
  ]) {
    users[key] = await insertUser(code, schoolA.id, "SCHOOL_ADMIN", "Fictif", key);
    await grant(users[key], schoolA.id, "SCHOOL_ADMIN");
  }
  users.adminB = await insertUser("ST03-ADMIN-B", schoolB.id, "SCHOOL_ADMIN", "Fictif", "adminB");
  await grant(users.adminB, schoolB.id, "SCHOOL_ADMIN");
  users.superadmin = await insertUser("ST03-SUPER", null, "SUPER_ADMIN", "Fictif", "super");
  await grant(users.superadmin, null, "SUPER_ADMIN");
  users.pays = await insertUser("ST03-PAYS", null, "COUNTRY_ADMIN", "Fictif", "pays");
  await grant(users.pays, null, "COUNTRY_ADMIN");
  return { schoolA, schoolB, users };
}

async function webLogin(identifier, schoolCode, password = SECRET) {
  return request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
}

async function mobileLogin(role, identifier, schoolCode) {
  return request("/login", { method: "POST", body: { role, identifier, pin: PIN, schoolCode } });
}

const probe = (token) => request("/auth/effective-permissions", { token });
const refresh = (refreshToken) => request("/auth/refresh", { method: "POST", body: { refreshToken } });

async function main() {
  if (!DATABASE_URL) {
    console.log("secAuth03SessionBinding.http.pg.test.js: SKIP (DATABASE_URL absent)");
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

    // --- A1–A4 : toutes les émissions portent un sessionId lié à une session active ---
    const web = await webLogin("ST03-ADMIN-A", schoolA.login_code);
    assertStatus(web, 200, "A1 connexion Web établissement");
    const webClaims = claims(web.data.accessToken);
    assert.ok(webClaims.sessionId, "A1 sessionId dans l'access token Web");
    assert.equal(claims(web.data.refreshToken).sessionId, webClaims.sessionId, "A1 même session access/refresh");
    assert.equal(webClaims.sub, users.adminA);
    ok("A1 Web établissement : sessionId");

    const mobile = await mobileLogin("school_admin", "ST03-ADMIN-A", schoolA.login_code);
    assertStatus(mobile, 200, "A2 connexion Mobile");
    assert.ok(claims(mobile.data.accessToken).sessionId, "A2 sessionId Mobile");
    assert.notEqual(claims(mobile.data.accessToken).sessionId, webClaims.sessionId, "A2 session distincte");
    ok("A2 Mobile : sessionId distinct");

    const superWeb = await webLogin("ST03-SUPER");
    assertStatus(superWeb, 200, "A3 connexion Superadmin");
    assert.ok(claims(superWeb.data.accessToken).sessionId, "A3 sessionId Superadmin");
    ok("A3 Superadmin : sessionId");

    const paysWeb = await webLogin("ST03-PAYS");
    assertStatus(paysWeb, 200, "A4 connexion Admin Pays");
    assert.ok(claims(paysWeb.data.accessToken).sessionId, "A4 sessionId Admin Pays");
    ok("A4 Admin Pays : sessionId");

    const refreshed = await refresh(web.data.refreshToken);
    assertStatus(refreshed, 200, "A5 refresh");
    assert.equal(claims(refreshed.data.accessToken).sessionId, webClaims.sessionId, "A5 refresh conserve la session");
    assertStatus(await probe(refreshed.data.accessToken), 200, "A5 jeton rafraîchi accepté");
    ok("A5 refresh : même sessionId");

    // --- B : jetons non conformes refusés ---
    const base = {
      sub: users.adminA,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: schoolA.login_code,
      countryCode: "CD",
      mustChangePassword: false,
    };
    assertStatus(
      await probe(tokens.createAccessToken({ ...base, sessionId: crypto.randomUUID() })),
      401,
      "B1 sessionId inexistant",
    );
    ok("B1 sessionId inexistant → 401");

    const expired = tokens.sign({ ...base, sessionId: webClaims.sessionId, typ: "access" }, -60);
    assertStatus(await probe(expired), 401, "B2 jeton expiré");
    ok("B2 expiré → 401");

    const [h, p, s] = String(refreshed.data.accessToken).split(".");
    const flipped = `${h}.${p}.${s.slice(0, -2)}${s.endsWith("AA") ? "BB" : "AA"}`;
    assertStatus(await probe(flipped), 401, "B3 signature altérée");
    const otherSecret = new TokenService({ secret: "un-autre-secret-de-test-suffisamment-long-0123" });
    assertStatus(
      await probe(otherSecret.createAccessToken({ ...base, sessionId: webClaims.sessionId })),
      401,
      "B3 autre secret",
    );
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...claims(refreshed.data.accessToken), role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"] }),
    ).toString("base64url");
    assertStatus(await probe(`${h}.${forgedPayload}.${s}`), 401, "B3 charge modifiée");
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    assertStatus(await probe(`${noneHeader}.${p}.`), 401, "B3 alg none sans signature");
    ok("B3 signature / algorithme / charge altérés → 401");

    assertStatus(await probe(web.data.refreshToken), 401, "B4 refresh token utilisé comme access");
    assertStatus(await refresh(refreshed.data.accessToken), 401, "B4 access token utilisé comme refresh");
    ok("B4 mauvais type de jeton → 401");

    // Jeton de la session de A, mais établissement B : session révoquée (SEC-TENANT-01).
    const crossLogin = await webLogin("ST03-OTHER", schoolA.login_code);
    assertStatus(crossLogin, 200, "B5 connexion");
    const crossSession = claims(crossLogin.data.accessToken).sessionId;
    const crossToken = tokens.createAccessToken({ ...base, sub: users.other, schoolCode: schoolB.login_code, sessionId: crossSession });
    assertStatus(await probe(crossToken), 401, "B5 autre établissement");
    assertStatus(await probe(crossLogin.data.accessToken), 401, "B5 session révoquée par le garde");
    ok("B5 autre établissement → 401, session révoquée");

    // --- C : révocation ---
    const logout = await request("/auth/logout", { method: "POST", token: refreshed.data.accessToken });
    assertStatus(logout, 200, "C1 logout");
    assertStatus(await probe(refreshed.data.accessToken), 401, "C1 access après logout");
    assertStatus(await refresh(refreshed.data.refreshToken), 401, "C1 refresh après logout");
    assertStatus(await probe(mobile.data.accessToken), 200, "C1 l'autre session (Mobile) reste active");
    ok("C1 logout : session révoquée, refresh refusé, autres sessions intactes");

    const r1 = await webLogin("ST03-REVOKER", schoolA.login_code);
    const r2 = await mobileLogin("school_admin", "ST03-REVOKER", schoolA.login_code);
    assertStatus(r1, 200, "C2 session 1");
    assertStatus(r2, 200, "C2 session 2");
    assertStatus(await request("/auth/revoke-all", { method: "POST", token: r1.data.accessToken }), 200, "C2 revoke-all");
    for (const [label, session] of [["web", r1], ["mobile", r2]]) {
      assertStatus(await probe(session.data.accessToken), 401, `C2 access ${label} après revoke-all`);
      assertStatus(await refresh(session.data.refreshToken), 401, `C2 refresh ${label} après revoke-all`);
    }
    ok("C2 revoke-all : toutes les sessions et refresh refusés");

    // --- D : constats (comportement actuel, non modifié ; exige le secret JWT) ---
    const { sessionId: _ignored, ...withoutSession } = claims(mobile.data.accessToken);
    const sessionless = tokens.createAccessToken({ ...withoutSession, sub: users.adminA });
    const sessionlessStatus = (await probe(sessionless)).status;
    const crossUserToken = tokens.createAccessToken({ ...base, sub: users.adminA, sessionId: claims(mobile.data.accessToken).sessionId });
    // Session active d'un autre utilisateur du même établissement.
    const peerLogin = await webLogin("ST03-PEER", schoolA.login_code);
    assertStatus(peerLogin, 200, "D2 connexion pair");
    const foreignSessionToken = tokens.createAccessToken({
      ...base,
      sub: users.adminA,
      sessionId: claims(peerLogin.data.accessToken).sessionId,
    });
    const foreignStatus = (await probe(foreignSessionToken)).status;
    // Entre établissements différents, le garde SEC-TENANT-01 révoque déjà la session.
    const loginB = await webLogin("ST03-ADMIN-B", schoolB.login_code);
    const crossSchoolForeign = tokens.createAccessToken({ ...base, sub: users.adminA, sessionId: claims(loginB.data.accessToken).sessionId });
    assertStatus(await probe(crossSchoolForeign), 401, "D2 session d'un utilisateur d'un autre établissement");
    console.log(
      `[SEC-AUTH-03] CONSTAT C-03 jeton signé sans sessionId → HTTP ${sessionlessStatus} ; ` +
        `CONSTAT F3 sessionId d'un autre utilisateur du même établissement → HTTP ${foreignStatus} ; ` +
        `jeton cohérent → HTTP ${(await probe(crossUserToken)).status}`,
    );
    ok(`D1 constat C-03 (sans sessionId) : HTTP ${sessionlessStatus}`);
    ok(`D2 constat F3 (session d'un autre utilisateur, même établissement) : HTTP ${foreignStatus} ; autre établissement : 401`);

    // --- E : changement de mot de passe → autres sessions révoquées ---
    const p1 = await webLogin("ST03-PWD", schoolA.login_code);
    const p2 = await mobileLogin("school_admin", "ST03-PWD", schoolA.login_code);
    const p3 = await webLogin("ST03-PWD", schoolA.login_code);
    for (const session of [p1, p2, p3]) assertStatus(session, 200, "E connexion");
    const changed = await request("/auth/change-password", {
      method: "POST",
      token: p1.data.accessToken,
      body: { newPassword: NEW_SECRET },
    });
    assertStatus(changed, 200, "E1 changement de mot de passe");
    assert.equal(claims(changed.data.accessToken).sessionId, claims(p1.data.accessToken).sessionId, "E1 session courante conservée");
    assertStatus(await probe(changed.data.accessToken), 200, "E1 session courante toujours active");
    assertStatus(await refresh(p1.data.refreshToken), 200, "E1 refresh de la session courante");
    ok("E1 changement de mot de passe : session courante conservée");
    for (const [label, session] of [["mobile", p2], ["web 2", p3]]) {
      assertStatus(await probe(session.data.accessToken), 401, `E2 access ${label} après changement de mot de passe`);
      assertStatus(await refresh(session.data.refreshToken), 401, `E2 refresh ${label} après changement de mot de passe`);
    }
    ok("E2 changement de mot de passe : autres sessions (Web, Mobile) et leurs refresh révoqués");
    assertStatus(await webLogin("ST03-PWD", schoolA.login_code), 401, "E3 ancien mot de passe refusé");
    assertStatus(await webLogin("ST03-PWD", schoolA.login_code, NEW_SECRET), 200, "E3 nouveau mot de passe accepté");
    ok("E3 nouveau mot de passe actif, ancien refusé");

    const reasons = await pool.query(
      `SELECT revoke_reason, COUNT(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NOT NULL GROUP BY revoke_reason`,
      [users.pwd],
    );
    assert.deepEqual(reasons.rows, [{ revoke_reason: "password_change", n: 2 }], "E4 motif de révocation tracé");
    ok("E4 motif de révocation « password_change » tracé");

    for (const label of passed) console.log(`OK ${label}`);
    console.log(`secAuth03SessionBinding.http.pg.test.js: ${passed.length} contrôles OK`);
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
