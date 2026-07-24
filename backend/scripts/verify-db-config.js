/**
 * S2.2 — Vérifie le durcissement de la configuration Base de Données.
 *
 * Couverture :
 *  - configuration valide → OK
 *  - variable obligatoire absente → FAIL
 *  - port invalide → FAIL
 *  - production + config incomplète → FAIL
 *  - aucun secret BD codé en dur (sources backend applicatives)
 *  - aucun fallback mémoire en production
 *  - aucun seed automatique en production
 *  - messages d'erreur sans fuite de secrets
 *  - SSL incohérent → FAIL
 *
 * Usage :
 *   npm run verify:db-config
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const BACKEND = path.join(__dirname, "..");

const {
  DbConfigError,
  parseDatabasePort,
  redactDatabaseUrl,
  sanitizeDbErrorMessage,
  resolveDatabaseConfig,
  resolveSslPolicy,
  collectDatabaseConfigViolations,
  assertDatabaseConfiguration,
  isDatabaseRequired,
  isMemoryFallbackAllowed,
} = require("../db/connectionConfig");
const { createFallbackRepository, initializeRepository } = require("../db/repositoryFactory");
const { shouldSeedDemoData, assertProductionSecurityConfiguration } = require("../lib/demoSeedPolicy");

function validDiscreteEnv(overrides = {}) {
  return {
    NODE_ENV: "development",
    DB_HOST: "db.internal",
    DB_PORT: "5432",
    DB_USER: "somafrik",
    DB_PASSWORD: "Strong-DB-Pass-2026!",
    DB_NAME: "somafrik",
    SOMAFRIK_DB_REQUIRED: "true",
    SOMAFRIK_SKIP_DEMO_SEED: "true",
    ...overrides,
  };
}

function validUrlEnv(overrides = {}) {
  return {
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://somafrik:Strong-DB-Pass-2026%21@db.internal:5432/somafrik",
    SOMAFRIK_DB_REQUIRED: "true",
    SOMAFRIK_SKIP_DEMO_SEED: "true",
    ...overrides,
  };
}

function runUnitValidationTests() {
  // Configuration valide (discrète)
  assert.doesNotThrow(() => assertDatabaseConfiguration(validDiscreteEnv()));
  const discrete = resolveDatabaseConfig(validDiscreteEnv());
  assert.strictEqual(discrete.source, "DISCRETE");
  assert.strictEqual(discrete.host, "db.internal");
  assert.strictEqual(discrete.port, 5432);
  assert.ok(!discrete.redactedConnectionString.includes("Strong-DB-Pass"));
  console.log("OK unit: configuration discrète valide");

  // Configuration valide (DATABASE_URL)
  assert.doesNotThrow(() => assertDatabaseConfiguration(validUrlEnv()));
  const fromUrl = resolveDatabaseConfig(validUrlEnv());
  assert.strictEqual(fromUrl.source, "DATABASE_URL");
  assert.ok(fromUrl.redactedConnectionString.includes("***"));
  console.log("OK unit: DATABASE_URL valide");

  // Variable obligatoire absente
  const missingPassword = collectDatabaseConfigViolations(
    validDiscreteEnv({ DB_PASSWORD: "", POSTGRES_PASSWORD: "" }),
  );
  assert.ok(
    missingPassword.some((v) => /mot de passe|DB_PASSWORD|PASSWORD/i.test(v)),
    `absence mot de passe attendue, reçu: ${missingPassword.join(" | ")}`,
  );
  console.log("OK unit: variable obligatoire absente → FAIL");

  // Ports invalides
  for (const bad of ["abc", "999999", "-1", "0", "65_536"]) {
    assert.throws(
      () => parseDatabasePort(bad, "DB_PORT"),
      (error) => error instanceof DbConfigError,
      `port ${bad} doit échouer`,
    );
  }
  const badPortViolations = collectDatabaseConfigViolations(
    validDiscreteEnv({ DB_PORT: "999999" }),
  );
  assert.ok(badPortViolations.some((v) => /DB_PORT invalide/i.test(v)));
  console.log("OK unit: ports invalides → FAIL");

  // Production + configuration incomplète
  const prodIncomplete = collectDatabaseConfigViolations({
    NODE_ENV: "production",
    SOMAFRIK_SKIP_DEMO_SEED: "true",
    SOMAFRIK_DB_REQUIRED: "true",
  });
  assert.ok(prodIncomplete.length > 0, "production incomplète doit échouer");
  console.log("OK unit: production + config incomplète → FAIL");

  // Production + localhost interdit
  const prodLocal = collectDatabaseConfigViolations(
    validDiscreteEnv({
      NODE_ENV: "production",
      DB_HOST: "localhost",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
    }),
  );
  assert.ok(prodLocal.some((v) => /localhost/i.test(v)));
  console.log("OK unit: production + localhost → FAIL");

  // Production + fallback mémoire interdit
  assert.strictEqual(
    isMemoryFallbackAllowed({ NODE_ENV: "production", SOMAFRIK_DB_REQUIRED: "false" }),
    false,
  );
  assert.strictEqual(isDatabaseRequired({ NODE_ENV: "production" }), true);
  const prodMemory = collectDatabaseConfigViolations(
    validDiscreteEnv({
      NODE_ENV: "production",
      SOMAFRIK_DB_REQUIRED: "false",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
    }),
  );
  assert.ok(prodMemory.some((v) => /SOMAFRIK_DB_REQUIRED=false/i.test(v)));
  assert.throws(
    () => createFallbackRepository({ NODE_ENV: "production" }),
    (error) => error instanceof DbConfigError,
  );
  console.log("OK unit: aucun fallback mémoire en production");

  // Aucun seed automatique en production
  assert.strictEqual(
    shouldSeedDemoData({ NODE_ENV: "production", SOMAFRIK_SKIP_DEMO_SEED: "true" }),
    false,
  );
  assert.strictEqual(
    shouldSeedDemoData({ NODE_ENV: "production", SOMAFRIK_SKIP_DEMO_SEED: "false" }),
    false,
  );
  assert.throws(
    () =>
      assertProductionSecurityConfiguration({
        NODE_ENV: "production",
        SOMAFRIK_SKIP_DEMO_SEED: "false",
      }),
    /SOMAFRIK_SKIP_DEMO_SEED/,
  );
  console.log("OK unit: aucun seed automatique en production");

  // SSL incohérent
  assert.throws(
    () =>
      resolveSslPolicy(
        { DB_SSL: "true" },
        "postgresql://u:p@h:5432/db?sslmode=disable",
      ),
    (error) => error instanceof DbConfigError && /SSL incohérente/i.test(error.message),
  );
  assert.throws(
    () =>
      resolveSslPolicy(
        { DB_SSL: "false", DB_SSLMODE: "require" },
        "",
      ),
    (error) => error instanceof DbConfigError,
  );
  assert.throws(
    () =>
      resolveSslPolicy(
        { DB_SSLMODE: "verify-full", DB_SSL_REJECT_UNAUTHORIZED: "false" },
        "",
      ),
    (error) => error instanceof DbConfigError,
  );
  const sslOk = resolveSslPolicy({ DB_SSL: "true" }, "");
  assert.strictEqual(sslOk.enabled, true);

  assert.throws(
    () => resolveSslPolicy({ DB_SSL: "tru" }, ""),
    (error) => error instanceof DbConfigError && /DB_SSL contient une valeur invalide/i.test(error.message),
  );
  assert.throws(
    () => resolveSslPolicy({ DB_SSL_REJECT_UNAUTHORIZED: "maybe" }, ""),
    (error) =>
      error instanceof DbConfigError &&
      /DB_SSL_REJECT_UNAUTHORIZED contient une valeur invalide/i.test(error.message),
  );
  console.log("OK unit: validation SSL (y compris valeurs invalides)");

  // Messages sans fuite
  const secretUrl = "postgresql://admin:SuperSecretPass@db.internal:5432/somafrik";
  const redacted = redactDatabaseUrl(secretUrl);
  assert.ok(!redacted.includes("SuperSecretPass"));
  assert.ok(!redacted.includes("admin"));
  const leaked = sanitizeDbErrorMessage(
    new Error(`connect failed for ${secretUrl} password=SuperSecretPass`),
  );
  assert.ok(!leaked.includes("SuperSecretPass"));
  assert.ok(!/postgresql:\/\/admin:/i.test(leaked));
  console.log("OK unit: messages d'erreur sans secrets");
}

function walkFiles(dir, out = []) {
  const IGNORE = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    "test-results",
  ]);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(js|ts|mjs|cjs)$/i.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function runHardcodedSecretAudit() {
  const roots = [
    path.join(BACKEND, "db"),
    path.join(BACKEND, "lib"),
    path.join(BACKEND, "scripts"),
    path.join(BACKEND, "server.js"),
  ];
  const files = [];
  for (const root of roots) {
    if (fs.statSync(root).isDirectory()) walkFiles(root, files);
    else files.push(root);
  }

  const patterns = [
    {
      name: "mot de passe BD littéral somafrik123",
      regex: /somafrik123/,
    },
    {
      name: "URI postgresql avec mot de passe embarqué",
      // postgresql://user:password@host — ignore URLs sans credentials
      regex: /postgres(?:ql)?:\/\/[^/\s"'`]+?:[^/\s"'`]+?@/i,
    },
    {
      name: "fallback POSTGRES_PASSWORD ?? secret",
      regex: /POSTGRES_PASSWORD\s*\?\?\s*["'`][^"'`]+["'`]/,
    },
    {
      name: "fallback DB_PASSWORD ?? secret",
      regex: /DB_PASSWORD\s*\?\?\s*["'`][^"'`]+["'`]/,
    },
  ];

  const hits = [];
  for (const filePath of files) {
    const relative = path.relative(ROOT, filePath);
    // Le script de vérif contient volontairement des motifs d'exemple dans des chaînes de test.
    if (relative.replace(/\\/g, "/") === "backend/scripts/verify-db-config.js") continue;
    if (relative.replace(/\\/g, "/") === "backend/scripts/verify-jwt-header.js") continue;

    const content = stripComments(readSafe(filePath));
    for (const pattern of patterns) {
      if (pattern.regex.test(content)) {
        hits.push(`${relative} → ${pattern.name}`);
      }
    }
  }

  assert.deepStrictEqual(
    hits,
    [],
    `Secrets BD codés en dur détectés:\n${hits.map((h) => `  - ${h}`).join("\n")}`,
  );
  console.log("OK static: aucun secret BD codé en dur (backend applicatif)");
}

function readSafe(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

async function runProductionInitializeGuard() {
  const previous = { ...process.env };
  try {
    // Nettoie les variables BD du process pour le scénario.
    for (const key of Object.keys(process.env)) {
      if (
        key === "DATABASE_URL" ||
        key.startsWith("DB_") ||
        key.startsWith("POSTGRES_") ||
        key === "SOMAFRIK_DB_REQUIRED" ||
        key === "SOMAFRIK_SKIP_DEMO_SEED" ||
        key === "NODE_ENV"
      ) {
        delete process.env[key];
      }
    }

    process.env.NODE_ENV = "production";
    process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
    process.env.SOMAFRIK_DB_REQUIRED = "true";

    await assert.rejects(
      () => initializeRepository({ env: process.env, logger: { warn() {} } }),
      (error) => error instanceof DbConfigError,
    );
    console.log("OK runtime: initializeRepository production incomplète → FAIL");
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
}

async function testDevelopmentMemoryModeWithoutDbConfig() {
  const env = {
    NODE_ENV: "development",
    SOMAFRIK_DB_REQUIRED: "false",
  };

  const result = await initializeRepository({
    env,
    logger: { warn() {} },
  });

  assert.strictEqual(result.engine, "memory");
  assert.strictEqual(result.usedFallback, true);
  assert.ok(result.repository, "repository mémoire attendu");
  console.log("OK runtime: development + SOMAFRIK_DB_REQUIRED=false sans DB → memory");
}

async function main() {
  runUnitValidationTests();
  runHardcodedSecretAudit();
  await runProductionInitializeGuard();
  await testDevelopmentMemoryModeWithoutDbConfig();
  console.log("verify-db-config: SUCCESS");
}

main().catch((error) => {
  console.error("verify-db-config: FAIL");
  console.error(error);
  process.exit(1);
});
