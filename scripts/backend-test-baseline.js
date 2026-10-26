"use strict";

/**
 * MONO-T0 — baseline complète des tests backend (node:test).
 *
 * Usage :
 *   node scripts/backend-test-baseline.js unit [--coverage]
 *   node scripts/backend-test-baseline.js pg   [--coverage]
 *   node scripts/backend-test-baseline.js inventory
 *
 * - unit : tous les fichiers backend/**\/*.test.js hors *.pg.test.js.
 * - pg   : tous les fichiers backend/**\/*.pg.test.js, en série, sur un cluster
 *          PostgreSQL DÉDIÉ AUX TESTS (voir backend-test-baseline-guards.js) :
 *          SOMAFRIK_TEST_PG_URL obligatoire, DATABASE_URL jamais lue.
 *
 * Les exceptions (scripts/backend-test-baseline.manifest.json) sont exécutées
 * et vérifiées, jamais ignorées. Avec --coverage, l'absence de rapport de
 * couverture fait échouer la baseline.
 *
 * Sorties : backend-test-baseline/<mode>/ (résultats JSON, couverture, résumé
 * Markdown, recopié dans $GITHUB_STEP_SUMMARY quand il existe).
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const guards = require("./backend-test-baseline-guards");

const ROOT = path.resolve(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const REPORTER = path.join(__dirname, "backend-test-baseline-reporter.mjs");
const MANIFEST_PATH = path.join(__dirname, "backend-test-baseline.manifest.json");
const OUTPUT_ROOT = path.resolve(process.env.SOMAFRIK_TEST_BASELINE_OUT || path.join(ROOT, "backend-test-baseline"));
const C8_VERSION = "10.1.3";

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function listBackendTests() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".test.js")) found.push(rel(full));
    }
  };
  walk(BACKEND);
  return found.sort();
}

function loadManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const entries = [
    ...(manifest.expectedFailures ?? []).map((entry) => ({ ...entry, kind: "expected-failure" })),
    ...(manifest.seededDatabase ?? []).map((entry) => ({ ...entry, kind: "seeded-database" })),
  ];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.file || !fs.existsSync(path.join(ROOT, entry.file))) {
      fail(`Manifeste : fichier introuvable « ${entry.file} ».`);
    }
    if (seen.has(entry.file)) fail(`Manifeste : fichier en double « ${entry.file} ».`);
    seen.add(entry.file);
    if (!["unit", "pg"].includes(entry.mode)) fail(`Manifeste : mode invalide pour ${entry.file}.`);
    if (entry.mode !== (entry.file.endsWith(".pg.test.js") ? "pg" : "unit")) {
      fail(`Manifeste : le mode de ${entry.file} ne correspond pas à son nom de fichier.`);
    }
    if (!String(entry.reason ?? "").trim()) fail(`Manifeste : raison manquante pour ${entry.file}.`);
    if (entry.kind === "expected-failure" && !String(entry.expectedOutput ?? "").trim()) {
      fail(`Manifeste : expectedOutput manquant pour ${entry.file}.`);
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Cluster PostgreSQL de test
// ---------------------------------------------------------------------------

function pgClient(connectionString) {
  const { Client } = require(require.resolve("pg", { paths: [BACKEND] }));
  return new Client({ connectionString });
}

/** Lit l'état du cluster et refuse tout cluster qui n'est pas dédié aux tests. */
async function verifyTestCluster(clusterUrl) {
  const client = pgClient(clusterUrl.toString());
  await client.connect();
  try {
    const current = await client.query("SELECT current_database() AS name");
    const comment = await client.query(
      "SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = current_database()",
    );
    const databases = await client.query("SELECT datname FROM pg_database ORDER BY datname");
    const version = await client.query("SHOW server_version");
    guards.assertDedicatedTestCluster({
      currentDatabase: current.rows[0]?.name,
      sentinelComment: comment.rows[0]?.comment ?? null,
      databases: databases.rows.map((row) => row.datname),
    });
    return { serverVersion: version.rows[0]?.server_version ?? "inconnue" };
  } finally {
    await client.end();
  }
}

async function createRunDatabase(clusterUrl, name) {
  guards.assertRunDatabaseName(name);
  const client = pgClient(clusterUrl.toString());
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${name}`);
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
  return guards.databaseUrl(clusterUrl, name);
}

async function dropRunDatabase(clusterUrl, name) {
  guards.assertRunDatabaseName(name);
  const client = pgClient(clusterUrl.toString());
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

function runNodeTest(files, { outDir, label, env, concurrency, coverage }) {
  const jsonFile = path.join(outDir, `${label}.results.json`);
  const args = ["--test", "--test-reporter=spec", "--test-reporter-destination=stdout"];
  args.push(`--test-reporter=${REPORTER}`, `--test-reporter-destination=${jsonFile}`);
  if (concurrency) args.push(`--test-concurrency=${concurrency}`);
  if (coverage === "node") {
    args.push(
      "--experimental-test-coverage",
      "--test-coverage-include=backend/**",
      "--test-coverage-exclude=**/*.test.js",
      "--test-coverage-exclude=backend/scripts/**",
      "--test-coverage-exclude=**/node_modules/**",
      "--test-reporter=lcov",
      `--test-reporter-destination=${path.join(outDir, "coverage-lcov.info")}`,
    );
  }
  args.push(...files);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    stdio: ["ignore", "inherit", "inherit"],
    maxBuffer: 1024 * 1024 * 256,
  });
  let results = [];
  try {
    results = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  } catch {
    results = [];
  }
  return { status: result.status, signal: result.signal, results };
}

function runExpectedFailure(entry, env) {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec", entry.file], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const failed = result.status !== 0;
  const causeMatches = output.includes(entry.expectedOutput);
  return {
    file: entry.file,
    ok: failed && causeMatches,
    detail: !failed
      ? "le fichier passe désormais : mettre à jour le manifeste (statut changé)"
      : causeMatches
        ? "échec attendu, cause documentée retrouvée"
        : "échec avec une cause différente de celle documentée",
  };
}

async function runSeededDatabaseEntry(entry, { clusterUrl, env, outDir }) {
  const name = guards.runDatabaseName("seeded", `${process.pid}_${crypto.randomBytes(4).toString("hex")}`);
  const url = await createRunDatabase(clusterUrl, name);
  try {
    const seededEnv = { ...env, DATABASE_URL: url, SOMAFRIK_DB_REQUIRED: "true" };
    delete seededEnv.SOMAFRIK_SKIP_DEMO_SEED;
    const bootstrap = spawnSync(
      process.execPath,
      [
        "-e",
        `require("./db/repositoryFactory").initializeRepository({ required: true })
          .then(({ repository }) => repository.close?.())
          .catch((error) => { console.error(error.message); process.exit(1); });`,
      ],
      { cwd: BACKEND, env: seededEnv, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
    );
    if (bootstrap.status !== 0) {
      throw new Error(`Amorçage de la base de travail impossible pour ${entry.file} : ${bootstrap.stderr}`);
    }
    const label = `seeded-${path.basename(entry.file, ".js")}`;
    return runNodeTest([entry.file], { outDir, label, env: seededEnv, concurrency: 1 }).results;
  } finally {
    await dropRunDatabase(clusterUrl, name);
  }
}

// ---------------------------------------------------------------------------
// Couverture et résumé
// ---------------------------------------------------------------------------

function lcovTotals(file) {
  if (!file || !fs.existsSync(file)) return null;
  let lf = 0;
  let lh = 0;
  let brf = 0;
  let brh = 0;
  let files = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("SF:")) files += 1;
    else if (line.startsWith("LF:")) lf += Number(line.slice(3));
    else if (line.startsWith("LH:")) lh += Number(line.slice(3));
    else if (line.startsWith("BRF:")) brf += Number(line.slice(4));
    else if (line.startsWith("BRH:")) brh += Number(line.slice(4));
  }
  if (!files || !lf) return null;
  const pct = (hit, found) => (found ? `${((100 * hit) / found).toFixed(1)} %` : "n/a");
  return { files, lines: pct(lh, lf), branches: pct(brh, brf) };
}

function c8Report(v8Dir, outDir) {
  const reportDir = path.join(outDir, "coverage");
  const args = [
    "report",
    `--temp-directory=${v8Dir}`,
    `--report-dir=${reportDir}`,
    "--reporter=lcov",
    "--reporter=json-summary",
    "--include=backend/**",
    "--exclude=**/*.test.js",
    "--exclude=backend/scripts/**",
    "--exclude=**/node_modules/**",
  ];
  const bin = process.env.SOMAFRIK_C8_BIN;
  const command = bin || "npx";
  const fullArgs = bin ? args : ["--yes", `c8@${C8_VERSION}`, ...args];
  const done = spawnSync(command, fullArgs, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (done.status !== 0) {
    console.error(`✖ Générateur de couverture c8 en échec (code ${done.status ?? done.signal}).`);
    return null;
  }
  return path.join(reportDir, "lcov.info");
}

function summarize(results) {
  const counts = { pass: 0, fail: 0, skip: 0, todo: 0 };
  for (const item of results) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

function writeSummary(outDir, mode, { results, expected, coverage, coverageRequested, excluded, total, notes }) {
  const counts = summarize(results);
  const skipped = results.filter((item) => item.status === "skip");
  const failed = results.filter((item) => item.status === "fail" && item.nesting === 0);
  const lines = [];
  lines.push(`## Baseline tests backend — ${mode}`);
  lines.push("");
  lines.push(`Fichiers de test du mode : ${total} (dont ${excluded.length} sous régime d'exception)`);
  for (const note of notes) lines.push("", note);
  lines.push("");
  lines.push("| Catégorie | Nombre |");
  lines.push("|---|---|");
  lines.push(`| PASS | ${counts.pass} |`);
  lines.push(`| FAIL | ${counts.fail} |`);
  lines.push(`| SKIP | ${counts.skip} |`);
  lines.push(`| TODO | ${counts.todo} |`);
  lines.push(`| Échecs attendus vérifiés (manifeste) | ${expected.filter((item) => item.ok).length} / ${expected.length} |`);
  lines.push("");
  if (!coverageRequested) lines.push(`Couverture ${mode} : non demandée.`);
  else if (coverage) {
    lines.push(`Couverture ${mode} : lignes ${coverage.lines}, branches ${coverage.branches} (${coverage.files} fichiers backend chargés).`);
  } else lines.push(`Couverture ${mode} : **ÉCHEC — demandée mais aucun rapport exploitable** (la baseline échoue).`);
  if (mode === "pg") {
    lines.push("");
    lines.push(
      "Limite connue : backend/server.js est lancé dans des processus enfants arrêtés par signal ; sa couverture HTTP n'est pas collectée.",
    );
  }
  if (failed.length) {
    lines.push("", "### FAIL (niveau fichier ou test racine)", "");
    for (const item of failed) lines.push(`- \`${rel(item.file ?? "")}\` — ${item.name}${item.error ? ` : ${item.error.split("\n")[0]}` : ""}`);
  }
  if (expected.length) {
    lines.push("", "### Échecs attendus (manifeste)", "");
    for (const item of expected) lines.push(`- ${item.ok ? "✔" : "✖"} \`${item.file}\` — ${item.detail}`);
  }
  if (skipped.length) {
    lines.push("", "### SKIP", "");
    const byFile = new Map();
    for (const item of skipped) {
      const key = rel(item.file ?? "");
      byFile.set(key, (byFile.get(key) ?? 0) + 1);
    }
    for (const [file, count] of [...byFile].sort()) lines.push(`- \`${file}\` : ${count}`);
  }
  const markdown = `${lines.join("\n")}\n`;
  fs.writeFileSync(path.join(outDir, "summary.md"), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(`\n${markdown}`);
  return counts;
}

// ---------------------------------------------------------------------------

async function main() {
  const [mode, ...flags] = process.argv.slice(2);
  const coverageRequested = flags.includes("--coverage");
  if (!["unit", "pg", "inventory"].includes(mode)) {
    fail("Usage : node scripts/backend-test-baseline.js <unit|pg|inventory> [--coverage]");
  }
  const manifest = loadManifest();
  const all = listBackendTests();
  const pgFiles = all.filter((file) => file.endsWith(".pg.test.js"));
  const unitFiles = all.filter((file) => !file.endsWith(".pg.test.js"));

  if (mode === "inventory") {
    console.log(JSON.stringify({ total: all.length, unit: unitFiles.length, pg: pgFiles.length, exceptions: manifest }, null, 2));
    return;
  }

  const modeFiles = mode === "unit" ? unitFiles : pgFiles;
  const excluded = manifest.filter((entry) => entry.mode === mode);
  const excludedSet = new Set(excluded.map((entry) => entry.file));
  const mainFiles = modeFiles.filter((file) => !excludedSet.has(file));
  const notes = [];
  let env = { ...process.env };
  let clusterUrl = null;
  let nfcDatabase = null;

  if (mode === "pg") {
    // Validation AVANT toute connexion : URL dédiée, loopback, base sentinelle.
    try {
      clusterUrl = guards.parseTestClusterUrl(process.env[guards.TEST_PG_URL_VAR]);
    } catch (error) {
      fail(error.message);
    }
    const sanitized = guards.sanitizeDatabaseEnv(process.env);
    env = sanitized.env;
    if (sanitized.removed.length) {
      notes.push(`Variables de base retirées de l'environnement des tests : ${sanitized.removed.map((key) => `\`${key}\``).join(", ")}.`);
    }
    try {
      const { serverVersion } = await verifyTestCluster(clusterUrl);
      notes.push(`Cluster de test vérifié (base sentinelle, commentaire, bases toutes de test) — PostgreSQL ${serverVersion}.`);
    } catch (error) {
      fail(error instanceof guards.BaselineGuardError ? error.message : `Cluster de test injoignable : ${error.message}`);
    }
    // Base source des tests : maintenance `postgres` du cluster vérifié. Les tests
    // du dépôt créent leurs propres bases à partir de celle-ci et certains
    // n'acceptent pas d'autre base source (gardes ADMIN-*).
    env.DATABASE_URL = guards.databaseUrl(clusterUrl, guards.MAINTENANCE_DATABASE);
    // Base exigée par la fixture NFC : recréée à neuf, supprimée à la fin.
    nfcDatabase = guards.NFC_TEST_DATABASE;
    env.SOMAFRIK_NFC_TEST_DATABASE_URL = await createRunDatabase(clusterUrl, nfcDatabase);
    notes.push(
      `Base source des tests : \`${guards.MAINTENANCE_DATABASE}\` du cluster vérifié ; base NFC \`${guards.NFC_TEST_DATABASE}\` recréée pour l'exécution.`,
    );
  }

  const outDir = path.join(OUTPUT_ROOT, mode);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let v8Dir = null;
  if (mode === "pg" && coverageRequested) {
    v8Dir = path.join(outDir, "v8");
    fs.mkdirSync(v8Dir, { recursive: true });
    env.NODE_V8_COVERAGE = v8Dir;
  }

  let results = [];
  const expected = [];
  let mainStatus = 0;
  try {
    const run = runNodeTest(mainFiles, {
      outDir,
      label: "main",
      env,
      concurrency: mode === "pg" ? 1 : undefined,
      coverage: mode === "unit" && coverageRequested ? "node" : undefined,
    });
    if (run.signal) throw new Error(`node --test interrompu par le signal ${run.signal}.`);
    mainStatus = run.status;
    results = run.results;
    for (const entry of excluded) {
      if (entry.kind === "expected-failure") expected.push(runExpectedFailure(entry, env));
      if (entry.kind === "seeded-database") {
        results = results.concat(await runSeededDatabaseEntry(entry, { clusterUrl, env, outDir }));
      }
    }
  } finally {
    if (nfcDatabase) await dropRunDatabase(clusterUrl, nfcDatabase);
  }

  let coverage = null;
  if (coverageRequested) {
    const lcov = mode === "unit" ? path.join(outDir, "coverage-lcov.info") : c8Report(v8Dir, outDir);
    coverage = lcovTotals(lcov);
  }
  const counts = writeSummary(outDir, mode, {
    results,
    expected,
    coverage,
    coverageRequested,
    excluded,
    total: modeFiles.length,
    notes,
  });

  const problems = [];
  if (!results.length) problems.push("aucun résultat de test collecté");
  if (counts.fail > 0) problems.push(`${counts.fail} test(s) FAIL`);
  const brokenExpectations = expected.filter((item) => !item.ok).length;
  if (brokenExpectations) problems.push(`${brokenExpectations} échec(s) attendu(s) non conforme(s)`);
  if (mainStatus !== 0 && counts.fail === 0) problems.push(`node --test a terminé avec le code ${mainStatus}`);
  if (coverageRequested && !coverage) problems.push("couverture demandée mais non produite");
  if (problems.length) fail(`Baseline ${mode} en échec : ${problems.join(" ; ")}.`);
  console.log(`✔ Baseline ${mode} verte.`);
}

module.exports = { createRunDatabase, dropRunDatabase, verifyTestCluster, lcovTotals };

if (require.main === module) {
  main().catch((error) => fail(error?.stack || String(error)));
}
