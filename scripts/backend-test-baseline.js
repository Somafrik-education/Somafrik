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
 * - pg   : tous les fichiers backend/**\/*.pg.test.js, en série, sur une base
 *          PostgreSQL LOCALE (DATABASE_URL vers localhost uniquement).
 *
 * Les exceptions (scripts/backend-test-baseline.manifest.json) sont exécutées
 * et vérifiées, jamais ignorées : un échec attendu doit échouer avec la cause
 * documentée, sinon la baseline échoue. Les tests ignorés (skip) sont listés
 * avec leur fichier dans le résumé.
 *
 * Sorties : backend-test-baseline/<mode>/ (résultats JSON, couverture, résumé
 * Markdown, recopié dans $GITHUB_STEP_SUMMARY quand il existe).
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");
const REPORTER = path.join(__dirname, "backend-test-baseline-reporter.mjs");
const MANIFEST_PATH = path.join(__dirname, "backend-test-baseline.manifest.json");
const OUTPUT_ROOT = path.resolve(process.env.SOMAFRIK_TEST_BASELINE_OUT || path.join(ROOT, "backend-test-baseline"));
const C8_VERSION = "10.1.3";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const SEEDED_DB_PREFIX = "somafrik_test_baseline_seeded";

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

function assertLocalDatabaseUrl(value, name) {
  if (!value) fail(`${name} est obligatoire pour le mode pg.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} invalide.`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    fail(`${name} doit viser une base PostgreSQL locale et jetable (hôte reçu : ${url.hostname}).`);
  }
  return url;
}

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

function seededDatabaseUrl(baseUrl) {
  const url = new URL(baseUrl.toString());
  url.pathname = `/${SEEDED_DB_PREFIX}_${process.pid}`;
  return url;
}

function runSeededDatabaseEntry(entry, { baseUrl, env, outDir, coverage }) {
  const target = seededDatabaseUrl(baseUrl);
  const databaseName = target.pathname.slice(1);
  const adminUrl = new URL(baseUrl.toString());
  adminUrl.pathname = "/postgres";
  const admin = (sql) => {
    const script = `
      const { Client } = require(${JSON.stringify(require.resolve("pg", { paths: [BACKEND] }))});
      const client = new Client({ connectionString: ${JSON.stringify(adminUrl.toString())} });
      client.connect().then(() => client.query(${JSON.stringify(sql)})).then(() => client.end())
        .catch((error) => { console.error(error.message); process.exit(1); });`;
    const done = spawnSync(process.execPath, ["-e", script], { env, encoding: "utf8" });
    if (done.status !== 0) fail(`PostgreSQL (${sql}) : ${done.stderr}`);
  };
  admin(`DROP DATABASE IF EXISTS ${databaseName}`);
  admin(`CREATE DATABASE ${databaseName}`);
  const seededEnv = { ...env, DATABASE_URL: target.toString(), SOMAFRIK_DB_REQUIRED: "true" };
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
    admin(`DROP DATABASE IF EXISTS ${databaseName}`);
    fail(`Amorçage de la base dédiée impossible pour ${entry.file} : ${bootstrap.stderr}`);
  }
  const label = `seeded-${path.basename(entry.file, ".js")}`;
  const run = runNodeTest([entry.file], { outDir, label, env: seededEnv, concurrency: 1, coverage });
  admin(`DROP DATABASE IF EXISTS ${databaseName}`);
  return run.results;
}

function summarize(results) {
  const counts = { pass: 0, fail: 0, skip: 0, todo: 0 };
  for (const item of results) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

function lcovTotals(file) {
  if (!fs.existsSync(file)) return null;
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
  const command = bin ? bin : "npx";
  const fullArgs = bin ? args : ["--yes", `c8@${C8_VERSION}`, ...args];
  const done = spawnSync(command, fullArgs, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (done.status !== 0) {
    console.error("⚠ Rapport de couverture c8 impossible : couverture PG non mesurée pour cette exécution.");
    return null;
  }
  return path.join(reportDir, "lcov.info");
}

function writeSummary(outDir, mode, { results, expected, totalsFile, excluded, total }) {
  const counts = summarize(results);
  const skipped = results.filter((item) => item.status === "skip");
  const failed = results.filter((item) => item.status === "fail" && item.nesting === 0);
  const coverage = totalsFile ? lcovTotals(totalsFile) : null;
  const lines = [];
  lines.push(`## Baseline tests backend — ${mode}`);
  lines.push("");
  lines.push(`Fichiers de test du mode : ${total} (dont ${excluded.length} sous régime d'exception)`);
  lines.push("");
  lines.push("| Catégorie | Nombre |");
  lines.push("|---|---|");
  lines.push(`| PASS | ${counts.pass} |`);
  lines.push(`| FAIL | ${counts.fail} |`);
  lines.push(`| SKIP | ${counts.skip} |`);
  lines.push(`| TODO | ${counts.todo} |`);
  lines.push(`| Échecs attendus vérifiés (manifeste) | ${expected.filter((item) => item.ok).length} / ${expected.length} |`);
  lines.push("");
  lines.push(
    coverage
      ? `Couverture ${mode} : lignes ${coverage.lines}, branches ${coverage.branches} (${coverage.files} fichiers backend chargés).`
      : `Couverture ${mode} : non mesurée pour cette exécution.`,
  );
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

function main() {
  const [mode, ...flags] = process.argv.slice(2);
  const coverage = flags.includes("--coverage");
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

  const outDir = path.join(OUTPUT_ROOT, mode);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const modeFiles = mode === "unit" ? unitFiles : pgFiles;
  const excluded = manifest.filter((entry) => entry.mode === mode);
  const excludedSet = new Set(excluded.map((entry) => entry.file));
  const mainFiles = modeFiles.filter((file) => !excludedSet.has(file));
  const env = { ...process.env };
  let baseUrl = null;
  let v8Dir = null;

  if (mode === "pg") {
    baseUrl = assertLocalDatabaseUrl(env.DATABASE_URL, "DATABASE_URL");
    if (!env.SOMAFRIK_NFC_TEST_DATABASE_URL) {
      const nfc = new URL(baseUrl.toString());
      nfc.pathname = "/nfc_encoding_test";
      env.SOMAFRIK_NFC_TEST_DATABASE_URL = nfc.toString();
    }
    assertLocalDatabaseUrl(env.SOMAFRIK_NFC_TEST_DATABASE_URL, "SOMAFRIK_NFC_TEST_DATABASE_URL");
    if (coverage) {
      v8Dir = path.join(outDir, "v8");
      fs.mkdirSync(v8Dir, { recursive: true });
      env.NODE_V8_COVERAGE = v8Dir;
    }
  }

  const run = runNodeTest(mainFiles, {
    outDir,
    label: "main",
    env,
    concurrency: mode === "pg" ? 1 : undefined,
    coverage: mode === "unit" && coverage ? "node" : undefined,
  });
  if (run.signal) fail(`node --test interrompu par le signal ${run.signal}.`);
  let results = run.results;

  const expected = [];
  for (const entry of excluded) {
    if (entry.kind === "expected-failure") expected.push(runExpectedFailure(entry, env));
    if (entry.kind === "seeded-database") {
      results = results.concat(runSeededDatabaseEntry(entry, { baseUrl, env, outDir, coverage: undefined }));
    }
  }

  let totalsFile = null;
  if (coverage) {
    totalsFile = mode === "unit" ? path.join(outDir, "coverage-lcov.info") : c8Report(v8Dir, outDir);
  }
  const counts = writeSummary(outDir, mode, { results, expected, totalsFile, excluded, total: modeFiles.length });

  const expectedBroken = expected.filter((item) => !item.ok);
  if (!results.length) fail("Aucun résultat de test collecté.");
  if (counts.fail > 0 || expectedBroken.length > 0 || (run.status !== 0 && counts.fail === 0)) {
    fail(`Baseline ${mode} en échec : ${counts.fail} test(s) FAIL, ${expectedBroken.length} échec(s) attendu(s) non conforme(s).`);
  }
  console.log(`✔ Baseline ${mode} verte.`);
}

main();
