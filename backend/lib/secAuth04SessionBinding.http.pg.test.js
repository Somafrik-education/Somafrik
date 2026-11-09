"use strict";

/**
 * SEC-AUTH-04 — liaison obligatoire JWT ↔ session ↔ utilisateur (PostgreSQL, HTTP réel).
 *
 * Comptes fictifs uniquement. Aucun jeton ni secret journalisé.
 *
 * Sécurité du banc : il crée une base au nom unique (`somafrik_sec_auth_04_<aléa>`)
 * sur une instance locale (hôte loopback, hors production / Render), puis supprime
 * uniquement cette base à la fin. Aucune base existante n'est vidée ni supprimée.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { hashSecret } = require("../services/credentialService");
const { guardPgPool } = require("./pgPoolGuard");
const { hasExited, stopChildProcess, waitForNoDatabaseSessions } = require("./pgTestLifecycle");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_SEC_AUTH_04_HTTP_PORT ?? 19944);
// Secret propre au banc, généré à l'exécution (aucun littéral committé).
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const SECRET = `Sec-Auth-04-${crypto.randomBytes(6).toString("hex")}!`;
const PIN = String(100000 + crypto.randomInt(800000));
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

/** Instance locale uniquement ; ne renvoie jamais l'URL (secrets). */
function assertLocalTestInstance(databaseUrl, env = process.env) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("SEC-AUTH-04 : DATABASE_URL illisible");
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) throw new Error("SEC-AUTH-04 : instance PostgreSQL non locale refusée");
  for (const key of ["host", "hostaddr"]) {
    const override = String(parsed.searchParams.get(key) ?? "").toLowerCase();
    if (override && !LOOPBACK_HOSTS.has(override)) throw new Error(`SEC-AUTH-04 : paramètre ${key} non local refusé`);
  }
  if (String(env.NODE_ENV ?? "").toLowerCase() === "production" || String(env.RENDER ?? "") !== "") {
    throw new Error("SEC-AUTH-04 : environnement de production refusé");
  }
}

async function createDisposableDatabase() {
  assertLocalTestInstance(DATABASE_URL);
  const name = `somafrik_sec_auth_04_${crypto.randomBytes(6).toString("hex")}`;
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  return { name, url: withDatabaseName(DATABASE_URL, name) };
}

async function dropDisposableDatabase(name) {
  if (!/^somafrik_sec_auth_04_[0-9a-f]{12}$/.test(name)) return;
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    // Les pools du test sont fermés, mais PostgreSQL peut encore fermer leurs
    // sessions : attendre qu'elles disparaissent avant de supprimer la base.
    // WITH (FORCE) reste le dernier recours si une session subsiste.
    await waitForNoDatabaseSessions(admin, name);
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

async function request(pathname, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token != null ? { Authorization: `Bearer ${token}` } : {}),
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

function claims(token) {
  return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
}

/** Statut et code d'erreur, sans corps : aucun jeton n'est imprimé. */
function assertStatus(response, expected, label, code) {
  assert.equal(response.status, expected, `${label} : attendu ${expected}, reçu ${response.status}`);
  if (code) assert.equal(response.data?.code, code, `${label} : code attendu ${code}, reçu ${response.data?.code}`);
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
  const schoolA = await insertSchool("CD-2026-0941", "SBA", "Institut Auth4 A");
  const schoolB = await insertSchool("CD-2026-0942", "SBB", "Institut Auth4 B");

  const passwordHash = hashSecret(SECRET);
  const pinHash = hashSecret(PIN);
  const insertUser = async (userCode, schoolId, role) =>
    (
      await pool.query(
        `INSERT INTO users (school_id, user_code, first_name, last_name, role, status,
                            password_hash, pin_hash, must_change_password, profile_payload)
         VALUES ($1, $2, 'Fictif', $3, $4, 'active', $5, $6, FALSE, $7::jsonb)
         RETURNING id`,
        [schoolId, userCode, userCode, role, passwordHash, pinHash, JSON.stringify({ countryCode: "CD", countryScope: "CD" })],
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
    ["admin", "ST04-ADMIN"],
    ["peer", "ST04-PEER"],
    ["revoker", "ST04-REVOKER"],
    ["demoted", "ST04-DEMOTED"],
    ["mover", "ST04-MOVER"],
    ["expiring", "ST04-EXPIRING"],
  ]) {
    users[key] = await insertUser(code, schoolA.id, "SCHOOL_ADMIN");
    await grant(users[key], schoolA.id, "SCHOOL_ADMIN");
  }
  users.adminB = await insertUser("ST04-ADMIN-B", schoolB.id, "SCHOOL_ADMIN");
  await grant(users.adminB, schoolB.id, "SCHOOL_ADMIN");
  users.superadmin = await insertUser("ST04-SUPER", null, "SUPER_ADMIN");
  await grant(users.superadmin, null, "SUPER_ADMIN");
  users.pays = await insertUser("ST04-PAYS", null, "COUNTRY_ADMIN");
  await grant(users.pays, null, "COUNTRY_ADMIN");
  return { schoolA, schoolB, users };
}

const webLogin = (identifier, schoolCode) =>
  request("/backoffice/login", { method: "POST", body: { identifier, password: SECRET, ...(schoolCode ? { schoolCode } : {}) } });
const mobileLogin = (role, identifier, schoolCode) =>
  request("/login", { method: "POST", body: { role, identifier, pin: PIN, schoolCode } });
const probe = (token) => request("/auth/effective-permissions", { token });
const refresh = (refreshToken) => request("/auth/refresh", { method: "POST", body: { refreshToken } });

async function main() {
  if (!DATABASE_URL) {
    console.log("secAuth04SessionBinding.http.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const db = await createDisposableDatabase();
  const repo = createPostgresRepository(db.url);
  // Une session terminée par DROP DATABASE … WITH (FORCE) (57P01) ne doit pas
  // devenir une exception non capturée ; toute autre erreur de pool remonte.
  guardPgPool(repo.pool);
  const pool = guardPgPool(new Pool({ connectionString: db.url }));
  const tokens = new TokenService({ secret: JWT_SECRET });
  let child = null;
  // Dernier recours si le processus se termine sans passer par finally : aucun serveur orphelin.
  const killOrphan = () => {
    if (child && !hasExited(child)) child.kill("SIGKILL");
  };
  process.once("exit", killOrphan);
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
        DATABASE_URL: db.url,
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

    // --- Connexions réelles (AUTH4-11 à 14) ---
    const web = await webLogin("ST04-ADMIN", schoolA.login_code);
    assertStatus(web, 200, "AUTH4-11 connexion Web");
    assertStatus(await probe(web.data.accessToken), 200, "AUTH4-11 jeton Web accepté");
    ok("AUTH4-11 connexion Web valide → 200");

    const mobile = await mobileLogin("school_admin", "ST04-ADMIN", schoolA.login_code);
    assertStatus(mobile, 200, "AUTH4-12 connexion Mobile");
    assertStatus(await probe(mobile.data.accessToken), 200, "AUTH4-12 jeton Mobile accepté");
    ok("AUTH4-12 connexion Mobile valide → 200");

    const superWeb = await webLogin("ST04-SUPER");
    assertStatus(superWeb, 200, "AUTH4-13 connexion Superadmin");
    assertStatus(await probe(superWeb.data.accessToken), 200, "AUTH4-13 jeton Superadmin");
    assertStatus(await request("/backoffice/countries", { token: superWeb.data.accessToken }), 200, "AUTH4-13 route plateforme");
    assertStatus(await request("/backoffice/countries", { token: web.data.accessToken }), 403, "AUTH4-13 témoin : route plateforme refusée à un admin école");
    ok("AUTH4-13 Superadmin avec session valide → 200, RBAC plateforme conservé");

    const paysWeb = await webLogin("ST04-PAYS");
    assertStatus(paysWeb, 200, "AUTH4-14 connexion Admin Pays");
    assertStatus(await probe(paysWeb.data.accessToken), 200, "AUTH4-14 jeton Admin Pays");
    assertStatus(await request("/backoffice/countries", { token: paysWeb.data.accessToken }), 200, "AUTH4-14 route plateforme");
    ok("AUTH4-14 Admin Pays avec session valide → 200");

    const webClaims = claims(web.data.accessToken);
    const base = {
      sub: users.admin,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: schoolA.login_code,
      countryCode: "CD",
      mustChangePassword: false,
    };

    // --- C-03 : sessionId absent, vide, mal formé, inexistant (AUTH4-01 à 03, 22) ---
    const { sessionId: _drop, ...legacyClaims } = webClaims;
    assertStatus(await probe(tokens.createAccessToken({ ...legacyClaims })), 401, "AUTH4-01 sans sessionId", "SESSION_REQUIRED");
    ok("AUTH4-01 JWT sans sessionId → 401 SESSION_REQUIRED");
    for (const value of ["", "   "]) {
      assertStatus(await probe(tokens.createAccessToken({ ...base, sessionId: value })), 401, "AUTH4-02 sessionId vide", "SESSION_REQUIRED");
    }
    for (const value of ["abc", "../../etc", `${webClaims.sessionId}x`, 42]) {
      assertStatus(await probe(tokens.createAccessToken({ ...base, sessionId: value })), 401, "AUTH4-02 sessionId mal formé", "SESSION_REQUIRED");
    }
    ok("AUTH4-02 sessionId vide ou mal formé → 401");
    assertStatus(
      await probe(tokens.createAccessToken({ ...base, sessionId: crypto.randomUUID() })),
      401,
      "AUTH4-03 sessionId inexistant",
      "SESSION_REVOKED",
    );
    ok("AUTH4-03 sessionId inexistant → 401");
    // Ancien jeton : forme exacte des jetons d'avant l'introduction du sessionId,
    // signé par le serveur, pour chaque type de compte.
    for (const login of [web, mobile, superWeb, paysWeb]) {
      const { sessionId: _old, ...legacy } = claims(login.data.accessToken);
      assertStatus(await probe(tokens.sign({ ...legacy }, 600)), 401, "AUTH4-22 ancien jeton sans sessionId", "SESSION_REQUIRED");
    }
    ok("AUTH4-22 ancien JWT sans sessionId (école, Mobile, Superadmin, Admin Pays) → 401 contrôlé");

    // --- F3 : session d'un autre utilisateur (AUTH4-06, 07) ---
    const peer = await webLogin("ST04-PEER", schoolA.login_code);
    assertStatus(peer, 200, "AUTH4-06 connexion pair");
    const peerSession = claims(peer.data.accessToken).sessionId;
    assertStatus(
      await probe(tokens.createAccessToken({ ...base, sessionId: peerSession })),
      401,
      "AUTH4-06 session d'un autre utilisateur du même établissement",
      "SESSION_SUBJECT_MISMATCH",
    );
    assertStatus(await probe(peer.data.accessToken), 200, "AUTH4-06 la session du pair n'est pas révoquée");
    const superSession = claims(superWeb.data.accessToken).sessionId;
    assertStatus(
      await probe(tokens.createAccessToken({ ...base, sessionId: superSession })),
      401,
      "AUTH4-06 session Superadmin réutilisée par un admin école",
      "SESSION_SUBJECT_MISMATCH",
    );
    assertStatus(
      await probe(tokens.createAccessToken({ ...claims(superWeb.data.accessToken), sub: users.pays })),
      401,
      "AUTH4-06 session Superadmin réutilisée par l'Admin Pays",
      "SESSION_SUBJECT_MISMATCH",
    );
    ok("AUTH4-06 JWT.sub ≠ session.user_id → 401 (école et plateforme), session d'autrui intacte");

    const loginB = await webLogin("ST04-ADMIN-B", schoolB.login_code);
    assertStatus(loginB, 200, "AUTH4-07 connexion B");
    const sessionB = claims(loginB.data.accessToken).sessionId;
    assertStatus(
      await probe(tokens.createAccessToken({ ...base, sessionId: sessionB })),
      401,
      "AUTH4-07 session d'un autre établissement (sujet différent)",
      "SESSION_SUBJECT_MISMATCH",
    );
    ok("AUTH4-07 session d'un autre établissement → 401");

    // CONSTAT F6 (hors périmètre SEC-AUTH-04, non corrigé ; exige le secret JWT) :
    // sa propre session, schoolId canonique conservé mais schoolCode d'un autre
    // établissement. Le garde SEC-TENANT-01 s'arrête à la correspondance du schoolId.
    const mixedClaims = tokens.createAccessToken({ ...claims(loginB.data.accessToken), schoolCode: schoolA.login_code });
    console.log(`[SEC-AUTH-04] CONSTAT F6 schoolId B + schoolCode A sur session B → HTTP ${(await probe(mixedClaims)).status}`);

    // --- Jeton invalide (AUTH4-08 à 10) ---
    assertStatus(await probe(tokens.sign({ ...webClaims, typ: "access" }, -60)), 401, "AUTH4-08 JWT expiré");
    ok("AUTH4-08 JWT expiré → 401");
    const [h, p, s] = String(web.data.accessToken).split(".");
    assertStatus(await probe(`${h}.${p}.${s.slice(0, -2)}${s.endsWith("AA") ? "BB" : "AA"}`), 401, "AUTH4-09 signature altérée");
    const otherSecret = new TokenService({ secret: crypto.randomBytes(32).toString("hex") });
    assertStatus(await probe(otherSecret.createAccessToken({ ...webClaims })), 401, "AUTH4-09 autre secret");
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    assertStatus(await probe(`${noneHeader}.${p}.`), 401, "AUTH4-09 alg none");
    ok("AUTH4-09 signature invalide → 401");
    assertStatus(await probe(web.data.refreshToken), 401, "AUTH4-10 refresh token comme access");
    ok("AUTH4-10 refresh token utilisé comme access token → 401");

    // --- Session expirée (AUTH4-05) ---
    const expiring = await webLogin("ST04-EXPIRING", schoolA.login_code);
    assertStatus(expiring, 200, "AUTH4-05 connexion");
    assertStatus(await probe(expiring.data.accessToken), 200, "AUTH4-05 avant expiration");
    await pool.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE session_code = $1", [
      claims(expiring.data.accessToken).sessionId,
    ]);
    assertStatus(await probe(expiring.data.accessToken), 401, "AUTH4-05 session expirée", "SESSION_REVOKED");
    assertStatus(await refresh(expiring.data.refreshToken), 401, "AUTH4-05 refresh d'une session expirée");
    ok("AUTH4-05 session expirée (JWT encore valide) → 401");

    // --- Révocation (AUTH4-04, 17 à 19) ---
    const logout = await request("/auth/logout", { method: "POST", token: web.data.accessToken });
    assertStatus(logout, 200, "AUTH4-17 logout");
    assertStatus(await probe(web.data.accessToken), 401, "AUTH4-17 réutilisation après logout", "SESSION_REVOKED");
    ok("AUTH4-17 déconnexion puis réutilisation du JWT → 401");
    assertStatus(
      await probe(tokens.createAccessToken({ ...base, sessionId: webClaims.sessionId })),
      401,
      "AUTH4-04 session révoquée",
      "SESSION_REVOKED",
    );
    ok("AUTH4-04 JWT avec session révoquée → 401");
    assertStatus(await refresh(web.data.refreshToken), 401, "AUTH4-19 refresh après logout");
    assertStatus(await probe(mobile.data.accessToken), 200, "AUTH4-17 l'autre session (Mobile) reste active");

    const r1 = await webLogin("ST04-REVOKER", schoolA.login_code);
    const r2 = await mobileLogin("school_admin", "ST04-REVOKER", schoolA.login_code);
    assertStatus(r1, 200, "AUTH4-18 session 1");
    assertStatus(r2, 200, "AUTH4-18 session 2");
    assertStatus(await request("/auth/revoke-all", { method: "POST", token: r1.data.accessToken }), 200, "AUTH4-18 revoke-all");
    for (const [label, session] of [["Web", r1], ["Mobile", r2]]) {
      assertStatus(await probe(session.data.accessToken), 401, `AUTH4-18 access ${label} après revoke-all`);
      assertStatus(await refresh(session.data.refreshToken), 401, `AUTH4-19 refresh ${label} après revoke-all`);
    }
    ok("AUTH4-18 révocation globale puis réutilisation → 401");
    ok("AUTH4-19 refresh après logout ou revoke-all → 401");

    // --- Changement de rôle (AUTH4-20) ---
    const demoted = await webLogin("ST04-DEMOTED", schoolA.login_code);
    assertStatus(demoted, 200, "AUTH4-20 connexion");
    assertStatus(await request("/teachers?page=1&limit=5", { token: demoted.data.accessToken }), 200, "AUTH4-20 avant retrait du rôle");
    // Rétrogradation réelle : SCHOOL_ADMIN retiré, TEACHER attribué (rôles relus en base).
    await pool.query("UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1", [users.demoted]);
    await pool.query("INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, 'TEACHER', 'active')", [
      users.demoted,
      schoolA.id,
    ]);
    const afterDemotion = await request("/teachers?page=1&limit=5", { token: demoted.data.accessToken });
    assert.ok([401, 403].includes(afterDemotion.status), `AUTH4-20 après rétrogradation : reçu ${afterDemotion.status}`);
    // Élévation : jeton de sa propre session réclamant SUPER_ADMIN.
    const elevated = tokens.createAccessToken({
      ...claims(mobile.data.accessToken),
      role: "Super Administrateur Somafrik",
      roleKeys: ["SUPER_ADMIN"],
      schoolCode: "*",
      permissions: ["ALL_PRIVILEGES"],
    });
    const elevatedPlatform = await request("/backoffice/countries", { token: elevated });
    assert.ok([401, 403].includes(elevatedPlatform.status), `AUTH4-20 élévation SUPER_ADMIN : reçu ${elevatedPlatform.status}`);
    // CONSTAT F7 (RBAC, hors périmètre, non corrigé) : sans aucun rôle actif en base,
    // les rôles revendiqués par le jeton sont utilisés jusqu'à son expiration (15 min).
    await pool.query("UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1 AND status = 'active'", [
      users.demoted,
    ]);
    const noRole = await request("/teachers?page=1&limit=5", { token: demoted.data.accessToken });
    console.log(`[SEC-AUTH-04] CONSTAT F7 aucun rôle actif, jeton SCHOOL_ADMIN encore valide → HTTP ${noRole.status}`);
    ok(`AUTH4-20 changement de rôle : retrait → ${afterDemotion.status}, revendication SUPER_ADMIN → ${elevatedPlatform.status}`);

    // --- Changement d'établissement (AUTH4-21) ---
    const mover = await webLogin("ST04-MOVER", schoolA.login_code);
    assertStatus(mover, 200, "AUTH4-21 connexion");
    await pool.query("UPDATE users SET school_id = $2 WHERE id = $1", [users.mover, schoolB.id]);
    assertStatus(await probe(mover.data.accessToken), 401, "AUTH4-21 jeton de l'ancien établissement", "SESSION_SCHOOL_ATTACHMENT_MISSING");
    assertStatus(
      await request("/students", { token: mover.data.accessToken, headers: { "X-Somafrik-School-Code": schoolB.login_code } }),
      401,
      "AUTH4-21 accès au nouvel établissement avec l'ancien jeton",
    );
    ok("AUTH4-21 changement d'établissement → 401, aucun accès transversal");

    // --- Route hors requireAuth (AUTH4-23) : /api/privacy/erasure-requests ---
    // Un jeton accepté attribue la demande sans autre champ (201) ; un jeton refusé
    // est traité comme anonyme, qui exige identifiant + établissement (400).
    const live = await mobileLogin("school_admin", "ST04-PEER", schoolA.login_code);
    assertStatus(live, 200, "AUTH4-23 connexion");
    assertStatus(await request("/privacy/erasure-requests", { method: "POST", token: live.data.accessToken, body: {} }), 201, "AUTH4-23 jeton lié");
    const { sessionId: _none, ...liveLegacy } = claims(live.data.accessToken);
    for (const [label, token] of [
      ["sans sessionId", tokens.createAccessToken({ ...liveLegacy })],
      ["session d'autrui", tokens.createAccessToken({ ...claims(live.data.accessToken), sub: users.admin })],
      ["session révoquée", tokens.createAccessToken({ ...base, sessionId: webClaims.sessionId })],
    ]) {
      assertStatus(
        await request("/privacy/erasure-requests", { method: "POST", token, body: {} }),
        400,
        `AUTH4-23 ${label} traité comme anonyme`,
      );
    }
    const attributed = await pool.query("SELECT COUNT(*)::int AS n FROM privacy_requests WHERE user_id IS NOT NULL");
    assert.equal(attributed.rows[0].n, 1, "AUTH4-23 une seule demande attribuée");
    ok("AUTH4-23 route hors requireAuth : même contrôle de session (jeton refusé → anonyme)");

    for (const label of passed) console.log(`OK ${label}`);
    console.log(`secAuth04SessionBinding.http.pg.test.js: ${passed.length} contrôles OK`);
  } catch (error) {
    for (const label of passed) console.log(`OK ${label}`);
    throw error;
  } finally {
    // Le nettoyage continue même si l'arrêt échoue ; l'échec reste visible.
    await stopChildProcess(child).catch((error) => {
      console.error(`FAIL arrêt du serveur enfant : ${error.message}`);
      process.exitCode = 1;
    });
    await pool.end().catch(() => {});
    await repo.close().catch(() => {});
    await dropDisposableDatabase(db.name).catch((error) => {
      // Une base jetable non supprimée est un défaut visible, jamais silencieux.
      console.error(`FAIL suppression de la base jetable : ${error.message}`);
      process.exitCode = 1;
    });
    process.removeListener("exit", killOrphan);
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
