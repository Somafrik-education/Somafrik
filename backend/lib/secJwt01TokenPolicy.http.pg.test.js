"use strict";

/**
 * SEC-JWT-01 — politique de signature et de vérification des jetons d'accès.
 *
 * HTTP réel sur PostgreSQL jetable, comptes fictifs, aucun jeton journalisé.
 * Les jetons « hostiles » sont fabriqués avec le secret propre au banc (généré
 * à l'exécution) : ils représentent un jeton forgé ou mal émis.
 *
 * SEC_JWT_01_REPRO=1 : relevé de tous les écarts (reproduction sur la base).
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
const IT_DATABASE = "somafrik_sec_jwt_01_http_it";
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_SEC_JWT_01_HTTP_PORT ?? 19971);
// Secrets propres au banc, générés à l'exécution (aucun littéral committé).
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const SECRET = `Sec-Jwt-01-${crypto.randomBytes(6).toString("hex")}!`;
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

const b64 = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const claims = (token) => JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
const header = (token) => JSON.parse(Buffer.from(String(token).split(".")[0], "base64url").toString("utf8"));

/** Jeton signé HMAC avec un en-tête et une charge arbitraires (jeton forgé). */
function hmacToken(head, payload, { key = JWT_SECRET, digest = "sha256" } = {}) {
  const signed = `${b64(head)}.${b64(payload)}`;
  return `${signed}.${crypto.createHmac(digest, key).update(signed).digest("base64url")}`;
}

const REPRO = process.env.SEC_JWT_01_REPRO === "1";
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
  const schoolA = await insertSchool("CD-2026-0971", "JWA", "Institut Jwt A");
  const schoolB = await insertSchool("CD-2026-0972", "JWB", "Institut Jwt B");
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
  const users = {};
  for (const key of ["admin", "revoked", "inactive", "demoted"]) {
    users[key] = await insertUser(`SJ01-${key.toUpperCase()}`, schoolA.id, "SCHOOL_ADMIN");
    await pool.query(`INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, 'SCHOOL_ADMIN', 'active')`, [
      users[key],
      schoolA.id,
    ]);
  }
  return { schoolA, schoolB, users };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("secJwt01TokenPolicy.http.pg.test.js: SKIP (DATABASE_URL absent)");
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

    const login = async (code) => {
      const response = await request("/backoffice/login", {
        method: "POST",
        body: { identifier: code, password: SECRET, schoolCode: schoolA.login_code },
      });
      assert.equal(response.status, 200, `connexion ${code} : ${response.text.slice(0, 200)}`);
      return response.data;
    };
    const probe = (token) => request("/teachers?page=1&limit=5", { token });
    const now = () => Math.floor(Date.now() / 1000);

    const admin = await login("SJ01-ADMIN");
    const base = claims(admin.accessToken);
    const head = header(admin.accessToken);
    assertStatus(await probe(admin.accessToken), 200, "référence : jeton légitime");
    // Rejeu légitime : même en-tête et même charge, re-signés avec la clé du serveur.
    const resign = (overrides = {}, headOverrides = {}) => hmacToken({ ...head, ...headOverrides }, { ...base, ...overrides });
    assertStatus(await probe(resign()), 200, "référence : même charge re-signée");

    // JWT01-01 — signature invalide.
    const [h, p, s] = String(admin.accessToken).split(".");
    assertStatus(await probe(`${h}.${p}.${s.slice(0, -2)}${s.endsWith("AA") ? "BB" : "AA"}`), 401, "JWT01-01 signature altérée");
    assertStatus(await probe(hmacToken(head, base, { key: crypto.randomBytes(32).toString("hex") })), 401, "JWT01-01 autre clé");
    assertStatus(await probe(`${h}.${p}.`), 401, "JWT01-01 signature vide");
    ok("JWT01-01 signature invalide → 401");

    // JWT01-02 — alg none (avec ou sans signature).
    assertStatus(await probe(`${b64({ alg: "none", typ: "JWT" })}.${p}.`), 401, "JWT01-02 alg none sans signature");
    assertStatus(await probe(`${b64({ alg: "none", typ: "JWT" })}.${p}.${s}`), 401, "JWT01-02 alg none + signature d'origine");
    assertStatus(await probe(hmacToken({ alg: "None", typ: "JWT" }, base)), 401, "JWT01-02 alg « None »");
    ok("JWT01-02 alg none → 401");

    // JWT01-03 — algorithme inattendu.
    assertStatus(await probe(hmacToken({ alg: "HS512", typ: "JWT" }, base, { digest: "sha512" })), 401, "JWT01-03 HS512");
    assertStatus(await probe(hmacToken({ alg: "HS384", typ: "JWT" }, base, { digest: "sha384" })), 401, "JWT01-03 HS384");
    assertStatus(await probe(hmacToken({ alg: "RS256", typ: "JWT" }, base)), 401, "JWT01-03 en-tête RS256, signature HMAC");
    assertStatus(await probe(hmacToken({ typ: "JWT" }, base)), 401, "JWT01-03 alg absent");
    ok("JWT01-03 algorithme inattendu → 401");

    // JWT01-04 — confusion clé publique / secret HMAC : une clé publique (fixture de banc)
    // utilisée comme secret HMAC ne doit jamais être acceptée.
    const { publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicPem = publicKey.export({ type: "spki", format: "pem" });
    assertStatus(await probe(hmacToken({ alg: "HS256", typ: "JWT" }, base, { key: publicPem })), 401, "JWT01-04 HS256 signé avec une clé publique");
    ok("JWT01-04 confusion clé publique / HMAC → 401");

    // JWT01-05 / 06 — kid inconnu ou arbitraire : aucune clé choisie par le jeton.
    assertStatus(await probe(resign({}, { kid: "cle-inconnue-2026" })), 401, "JWT01-05 kid inconnu (signature valide)");
    for (const kid of ["../../../../etc/passwd", "' OR 1=1 --", "", 42, { k: 1 }, "x".repeat(4096)]) {
      assertStatus(await probe(resign({}, { kid })), 401, `JWT01-06 kid arbitraire ${JSON.stringify(kid).slice(0, 30)}`);
    }
    for (const field of [{ jku: "https://attaquant.example/jwks.json" }, { x5u: "https://attaquant.example/cert.pem" }, { jwk: { kty: "oct", k: b64("cle") } }]) {
      assertStatus(await probe(resign({}, field)), 401, `JWT01-06 clé fournie par le jeton (${Object.keys(field)[0]})`);
    }
    ok("JWT01-05 / 06 kid inconnu ou arbitraire, clé fournie par le jeton → 401");

    // JWT01-07 / 08 — audience et émetteur.
    assertStatus(await probe(resign({ aud: "autre-service" })), 401, "JWT01-07 audience incorrecte");
    assertStatus(await probe(resign({ aud: ["autre-service", "encore-autre"] })), 401, "JWT01-07 liste d'audiences incorrecte");
    assertStatus(await probe(resign({ iss: "autre-emetteur" })), 401, "JWT01-08 émetteur incorrect");
    const noIss = { ...base };
    delete noIss.iss;
    assertStatus(await probe(hmacToken(head, noIss)), 401, "JWT01-08 émetteur absent");
    ok("JWT01-07 / 08 audience et émetteur incorrects → 401");

    // JWT01-09 / 10 — validité temporelle.
    assertStatus(await probe(resign({ iat: now() - 3600, exp: now() - 60 })), 401, "JWT01-09 jeton expiré");
    const noExp = { ...base };
    delete noExp.exp;
    assertStatus(await probe(hmacToken(head, noExp)), 401, "JWT01-09 exp absent");
    assertStatus(await probe(resign({ exp: "9999999999" })), 401, "JWT01-09 exp non numérique");
    assertStatus(await probe(resign({ iat: now(), exp: now() + 30 * 24 * 3600 })), 401, "JWT01-09 durée de vie > 900 s");
    assertStatus(await probe(resign({ nbf: now() + 3600 })), 401, "JWT01-10 nbf futur");
    assertStatus(await probe(resign({ iat: now() + 3600, exp: now() + 3600 + 600 })), 401, "JWT01-10 iat futur");
    ok("JWT01-09 / 10 expiré, sans expiration, trop long ou pas encore valide → 401");

    // JWT01-11 — sessionId absent ou invalide (SEC-AUTH-04).
    const noSession = { ...base };
    delete noSession.sessionId;
    assertStatus(await probe(hmacToken(head, noSession)), 401, "JWT01-11 sessionId absent");
    assertStatus(await probe(resign({ sessionId: "pas-un-uuid" })), 401, "JWT01-11 sessionId malformé");
    assertStatus(await probe(resign({ sessionId: crypto.randomUUID() })), 401, "JWT01-11 sessionId inconnu");
    ok("JWT01-11 sessionId absent ou invalide → 401");

    // JWT01-12 — session révoquée (déconnexion).
    const revoked = await login("SJ01-REVOKED");
    assertStatus(await request("/auth/logout", { method: "POST", token: revoked.accessToken }), 200, "JWT01-12 déconnexion");
    assertStatus(await probe(revoked.accessToken), 401, "JWT01-12 session révoquée");
    assertStatus(await request("/auth/refresh", { method: "POST", body: { refreshToken: revoked.refreshToken } }), 401, "JWT01-12 refresh après révocation");
    ok("JWT01-12 session révoquée → 401");

    // JWT01-13 — utilisateur désactivé.
    const inactive = await login("SJ01-INACTIVE");
    await pool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [users.inactive]);
    assertStatus(await probe(inactive.accessToken), 401, "JWT01-13 utilisateur désactivé");
    ok("JWT01-13 utilisateur désactivé → 401");

    // JWT01-14 — rôle retiré : aucun privilège réintroduit (SEC-AUTH-05).
    const demoted = await login("SJ01-DEMOTED");
    await pool.query(`UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1`, [users.demoted]);
    assertStatus(await probe(demoted.accessToken), [401, 403], "JWT01-14 rôle retiré");
    const demotedRefresh = await request("/auth/refresh", { method: "POST", body: { refreshToken: demoted.refreshToken } });
    if (demotedRefresh.status === 200) assertStatus(await probe(demotedRefresh.data.accessToken), [401, 403], "JWT01-14 rôle retiré après refresh");
    ok("JWT01-14 rôle retiré : aucun privilège réintroduit");

    // JWT01-15 — établissement contradictoire (SEC-TENANT-02).
    const fresh = await login("SJ01-ADMIN");
    const freshClaims = claims(fresh.accessToken);
    assertStatus(await probe(hmacToken(header(fresh.accessToken), { ...freshClaims, schoolId: schoolB.id })), 401, "JWT01-15 schoolId d'un autre établissement");
    ok("JWT01-15 établissement contradictoire → refus");

    // JWT01-16 — jeton d'une autre finalité utilisé comme jeton d'accès.
    const other = await login("SJ01-ADMIN");
    assertStatus(await probe(other.refreshToken), 401, "JWT01-16 refresh token comme jeton d'accès");
    assertStatus(await request("/auth/refresh", { method: "POST", body: { refreshToken: other.accessToken } }), 401, "JWT01-16 jeton d'accès comme refresh token");
    const cursor = tokens.sign({ typ: "mobile_sync_cursor", schoolCode: schoolA.school_code, principalId: users.admin, scopeHash: "x" }, 300);
    assertStatus(await probe(cursor), 401, "JWT01-16 curseur de synchronisation comme jeton d'accès");
    const otherClaims = claims(other.accessToken);
    for (const typ of [undefined, "", "Access", "id", "refresh"]) {
      const payload = { ...otherClaims };
      if (typ === undefined) delete payload.typ;
      else payload.typ = typ;
      assertStatus(await probe(hmacToken(header(other.accessToken), payload)), 401, `JWT01-16 typ ${JSON.stringify(typ)}`);
    }
    ok("JWT01-16 jeton d'une autre finalité → 401");

    if (REPRO) {
      console.log(`SEC-JWT-01 REPRO : ${defects.length} écart(s)`);
      for (const defect of defects) console.log(`DÉFAUT ${defect}`);
    } else {
      for (const label of passed) console.log(`PASS ${label}`);
      console.log(`secJwt01TokenPolicy.http.pg.test.js: OK ${passed.length}/${passed.length}`);
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
