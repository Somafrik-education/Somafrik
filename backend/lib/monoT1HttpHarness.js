"use strict";

/**
 * MONO-T1 — harnais HTTP de caractérisation (code de test uniquement ; aucun
 * module de production ne l'importe).
 *
 * - Base IT jetable par fichier de test (`somafrik_mono_t1_<famille>_it`),
 *   réinitialisée (DROP SCHEMA public) avant chaque exécution, créée depuis la
 *   base `postgres` de DATABASE_URL — fournie par l'exécuteur MONO-T0, qui
 *   n'accepte qu'un cluster loopback dédié aux tests.
 * - Serveur réel `backend/server.js` (NODE_ENV=test : démo seed, workers de
 *   fond désactivés), données de démonstration du produit comme fixtures :
 *   école CD-2026-0001 peuplée, école BI-2026-0002 (administrateur seul),
 *   comptes plateforme.
 * - Arrêt effectif du serveur et fermeture des connexions (pgTestLifecycle) ;
 *   garde `exit` contre un serveur orphelin.
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Pool } = require("pg");
const { guardPgPool } = require("./pgPoolGuard");
const { hasExited, stopChildProcess } = require("./pgTestLifecycle");
const { superadminLoginPassword } = require("./superadminSeedSecret");

const ROOT = path.resolve(__dirname, "../..");
const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const TEST_APPLICATION_NAME = "somafrik_mono_t1_harness";
const DEMO_PASSWORD = "1234";

/** Comptes de démonstration utilisés par les tests (identifiant + établissement). */
const ACCOUNTS = Object.freeze({
  cdAdmin: { identifier: "admin@unikin.somafrik", school: "CD-2026-0001" },
  cdProviseur: { identifier: "proviseur@somafrik.app", school: "CD-2026-0001" },
  cdPrefet: { identifier: "prefet@somafrik.app", school: "CD-2026-0001" },
  cdSecretary: { identifier: "secretaire@somafrik.app", school: "CD-2026-0001" },
  cdParent: { identifier: "parent.dupont@example.com", school: "CD-2026-0001" },
  cdTeacher: { identifier: "patrick.ilunga@somafrik.cd", school: "CD-2026-0001" },
  biAdmin: { identifier: "admin@bujumbura.somafrik", school: "BI-2026-0002" },
  countryAdminCd: { identifier: "admin.rdc@somafrik.app", school: null },
  superAdmin: { identifier: "superadmin@somafrik.app", school: null, superadmin: true },
});

const skipWithoutDatabase = DATABASE_URL ? false : "DATABASE_URL absent (exécuter via npm run test:backend-baseline:pg)";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function assertItDatabaseName(name) {
  if (!/^somafrik_mono_t1_[a-z0-9_]+_it$/.test(name)) {
    throw new Error(`Nom de base de caractérisation refusé : « ${name} ».`);
  }
  return name;
}

async function resetDatabase(databaseName) {
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
  const url = withDatabaseName(DATABASE_URL, databaseName);
  const reset = new Pool({ connectionString: url });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }
  return url;
}

async function waitForHealth(baseUrl, child, stderrRef) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (hasExited(child)) throw new Error(`Serveur arrêté au démarrage.\n${stderrRef.value.slice(-4000)}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      /* démarrage en cours */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Serveur non prêt.\n${stderrRef.value.slice(-4000)}`);
}

/**
 * Démarre une instance de caractérisation.
 * @param {{ database: string, port: number, env?: Record<string, string> }} options
 */
async function startCharacterizationServer({ database, port, env = {} }) {
  const url = await resetDatabase(assertItDatabaseName(database));
  const baseUrl = `http://127.0.0.1:${port}`;
  const jwtSecret = crypto.randomBytes(32).toString("hex");
  const serverEnv = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    DATABASE_URL: url,
    JWT_SECRET: jwtSecret,
    SOMAFRIK_DB_REQUIRED: "true",
    SOMAFRIK_API_ONLY: "true",
    SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
    LOGIN_RATE_LIMIT_MAX: "100000",
    ...env,
  };
  delete serverEnv.SOMAFRIK_SKIP_DEMO_SEED;
  if (!("SOMAFRIK_E2E" in env)) delete serverEnv.SOMAFRIK_E2E;
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
  const killOrphan = () => {
    if (!hasExited(child)) child.kill("SIGKILL");
  };
  process.once("exit", killOrphan);

  const pool = guardPgPool(new Pool({ connectionString: url, application_name: TEST_APPLICATION_NAME }));
  const tokens = new Map();

  const instance = {
    baseUrl,
    pool,
    /** Secret de signature du serveur de test (jetons expirés ou forgés des scénarios A). */
    jwtSecret,
    /** Arrête le serveur (sessions comprises) en gardant le pool de vérification ouvert. */
    async stopServer() {
      await stopChildProcess(child).catch((error) => {
        console.error(`FAIL arrêt du serveur de caractérisation : ${error.message}`);
        process.exitCode = 1;
      });
      process.removeListener("exit", killOrphan);
    },
    /** Nettoyage complet, idempotent : serveur puis connexions. */
    async stop() {
      await instance.stopServer();
      if (!pool.ended) await pool.end().catch(() => {});
    },

    async request(method, pathname, { token, body, headers = {} } = {}) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
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
      return { status: response.status, data, text, headers: response.headers };
    },

    async loginCode(schoolCode) {
      const row = await pool.query("SELECT login_code FROM schools WHERE school_code = $1", [schoolCode]);
      assert.equal(row.rowCount, 1, `établissement ${schoolCode} présent`);
      return row.rows[0].login_code;
    },

    /** Session réelle (POST /api/backoffice/login), mise en cache par compte. */
    async login(accountKey) {
      if (tokens.has(accountKey)) return tokens.get(accountKey);
      const account = ACCOUNTS[accountKey];
      assert.ok(account, `compte inconnu : ${accountKey}`);
      const body = {
        identifier: account.identifier,
        password: account.superadmin ? superadminLoginPassword() : DEMO_PASSWORD,
        ...(account.school ? { schoolCode: await instance.loginCode(account.school) } : {}),
      };
      const response = await instance.request("POST", "/api/backoffice/login", { body });
      assert.equal(response.status, 200, `connexion ${accountKey} : ${response.status} ${response.text.slice(0, 200)}`);
      assert.ok(response.data?.accessToken, `jeton absent pour ${accountKey}`);
      tokens.set(accountKey, response.data.accessToken);
      return response.data.accessToken;
    },

    forgetToken(accountKey) {
      tokens.delete(accountKey);
    },

    /** Instantané JSON de lignes : base des assertions « aucune écriture ». */
    async snapshot(sql, params = []) {
      const result = await pool.query(sql, params);
      return JSON.stringify(result.rows);
    },

    async one(sql, params = []) {
      return (await pool.query(sql, params)).rows[0] ?? null;
    },

    /**
     * Fixture « abonnement actif » : retire la date de fin des abonnements de
     * démonstration. Contournement documenté de l'anomalie MONO-T1-A2
     * (schoolSubscriptionAccessService.parseFrDate lit une date ISO AAAA-MM-JJ
     * comme JJ-MM-AA : tout abonnement daté est vu « suspendu »). Sans cette
     * fixture, les écritures soumises à abonnement (notes, présences, création
     * d'élève…) seraient refusées par 403 quelle que soit l'autorisation.
     * Reproduction du défaut : monoT1.anomaly.A2-*.http.pg.test.js.
     */
    async applyActiveSubscriptionFixture() {
      await pool.query("UPDATE subscriptions SET end_date = NULL");
      const access = await instance.request("GET", "/api/backoffice/subscription-access", {
        token: await instance.login("cdAdmin"),
      });
      assert.equal(access.data?.level, "full", `fixture abonnement actif : ${access.text.slice(0, 200)}`);
    },
  };

  try {
    await waitForHealth(baseUrl, child, stderrRef);
  } catch (error) {
    await instance.stop();
    throw error;
  }
  return instance;
}

/** Statut attendu, avec le corps en message d'échec (jamais de jeton dans les corps). */
function assertStatus(response, expected, label) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert.ok(
    allowed.includes(response.status),
    `${label} : attendu ${allowed.join(" ou ")}, reçu ${response.status} ${String(response.text).slice(0, 300)}`,
  );
}

module.exports = {
  ACCOUNTS,
  TEST_APPLICATION_NAME,
  assertStatus,
  skipWithoutDatabase,
  startCharacterizationServer,
};
