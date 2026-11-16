"use strict";

// CI-FAST-01 — sélection, découpage et agrégation des lots de la baseline backend.
// Sans base de données : node --test scripts/ci-fast-01.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const plan = require("./backend-test-baseline-plan");
const { listPgTestFiles, securityCore, selectPg } = require("./ci-pg-select");
const { verifyShards } = require("./ci-baseline-shards-verify");
const { weightsFromResults } = require("./ci-baseline-weights");

const ROOT = path.resolve(__dirname, "..");
const PG_FILES = listPgTestFiles();
const WEIGHTS = JSON.parse(fs.readFileSync(path.join(__dirname, "backend-test-baseline.weights.json"), "utf8")).seconds;
const MATRIX = "backend/lib/monoT1.rbacMatrix.http.pg.test.js";
const PR_GATES = fs.readFileSync(path.join(ROOT, ".github/workflows/pr-gates.yml"), "utf8");

test("inventaire : ci-pg-select découvre exactement les fichiers pg de la baseline", () => {
  const run = spawnSync(process.execPath, ["scripts/backend-test-baseline.js", "inventory"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(PG_FILES.length, JSON.parse(run.stdout).pg);
  assert.ok(PG_FILES.includes(MATRIX));
});

test("lots : K/N valide, refus des formes invalides", () => {
  assert.deepEqual(plan.parseShard("2/3"), { index: 2, total: 3 });
  for (const value of ["0/3", "4/3", "3", "a/b", "1/9", "", undefined, "-1/2"]) {
    assert.throws(() => plan.parseShard(value), plan.PlanError, String(value));
  }
});

test("lots : partition disjointe, union exacte, déterministe, quel que soit l'ordre d'entrée", () => {
  for (const total of [1, 2, 3, 4, 8]) {
    const shards = plan.partition(PG_FILES, total, WEIGHTS);
    assert.equal(shards.length, total);
    const flat = shards.flat();
    assert.equal(flat.length, PG_FILES.length, "aucun fichier perdu ni dupliqué");
    assert.deepEqual([...flat].sort(), PG_FILES);
    assert.deepEqual(plan.partition([...PG_FILES].reverse(), total, WEIGHTS), shards, "ordre d'entrée sans effet");
  }
  assert.throws(() => plan.partition(["a", "a"], 2), plan.PlanError);
  assert.throws(() => plan.partition(["a"], 0), plan.PlanError);
});

test("lots : la matrice RBAC (fichier le plus long) est seule dans son lot sur 3 lots", () => {
  const shards = plan.partition(PG_FILES, 3, WEIGHTS);
  const matrixShard = shards.find((files) => files.includes(MATRIX));
  assert.deepEqual(matrixShard, [MATRIX]);
  const loads = shards.map((files) => files.reduce((sum, file) => sum + plan.weightOf(WEIGHTS, file), 0));
  assert.ok(Math.max(...loads) <= plan.weightOf(WEIGHTS, MATRIX) + 1, `lots équilibrés sous la matrice : ${loads}`);
});

test("lots : un fichier sans poids mesuré reste planifié (poids par défaut)", () => {
  const shards = plan.partition(["backend/x.pg.test.js", ...PG_FILES], 3, WEIGHTS);
  assert.ok(shards.flat().includes("backend/x.pg.test.js"));
  assert.equal(plan.weightOf(WEIGHTS, "backend/x.pg.test.js"), plan.DEFAULT_WEIGHT_SECONDS);
});

function withSelection(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-fast-01-"));
  const file = path.join(dir, "selection.json");
  fs.writeFileSync(file, JSON.stringify(content));
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("sélection : full = tout le mode ; ciblée validée ; vide, inconnue ou none refusées", () => {
  withSelection({ mode: "full" }, (file) => assert.deepEqual(plan.loadSelection(file, PG_FILES).files, PG_FILES));
  withSelection({ mode: "targeted", files: [MATRIX] }, (file) => assert.deepEqual(plan.loadSelection(file, PG_FILES).files, [MATRIX]));
  for (const bad of [
    { mode: "targeted", files: [] },
    { mode: "targeted" },
    { mode: "targeted", files: ["backend/lib/inexistant.pg.test.js"] },
    { mode: "targeted", files: ["scripts/fixtures/backend-test-baseline/pass.pg.test.js"] },
    { mode: "none" },
    { mode: "partial", files: [MATRIX] },
  ]) {
    withSelection(bad, (file) => assert.throws(() => plan.loadSelection(file, PG_FILES), plan.PlanError, JSON.stringify(bad)));
  }
});

test("exécuteur : --select / --shard refusés hors mode pg et options inconnues refusées (avant toute base)", () => {
  for (const args of [["unit", "--shard=1/2"], ["unit", "--select=x.json"], ["pg", "--shard=1/2", "--shard=2/2"], ["pg", "--frobnicate"]]) {
    const run = spawnSync(process.execPath, ["scripts/backend-test-baseline.js", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    assert.notEqual(run.status, 0, args.join(" "));
  }
});

test("PR simples : docs, web, mobile, workflows sans rapport ⇒ aucune baseline backend", () => {
  for (const changed of [
    ["docs/project/CI-FAST-01.md"],
    ["web/src/App.tsx", "web/package.json"],
    ["Mobile/src/screens/Home.tsx"],
    [".github/workflows/web-smoke.yml", "README.md"],
  ]) {
    const decision = selectPg(changed, PG_FILES);
    assert.equal(decision.backend, false, changed.join(","));
    assert.equal(decision.pg_mode, "none");
  }
});

test("PR transversales : code backend, paquets, dépendances, exécuteur, workflows, inventaire ⇒ baseline complète", () => {
  for (const changed of [
    ["backend/server.js"],
    ["backend/lib/reportCard/reportCardEngine.js"],
    ["backend/db/migrations/0042_x.sql"],
    ["backend/package-lock.json"],
    ["package-lock.json"],
    ["packages/shared/index.ts"],
    ["scripts/backend-test-baseline.js"],
    ["scripts/backend-test-baseline.manifest.json"],
    ["scripts/ci-pg-select.js"],
    ["scripts/mono-t1-route-inventory.js"],
    ["docs/project/MONO-T1-ROUTES.json"],
    ["docs/project/MONO-T1-RBAC-MATRIX.json"],
    [".github/workflows/pr-gates.yml"],
    [".github/workflows/backend-test-baseline.yml"],
    // Un fichier de données d'un test n'est pas un *.test.js : complet.
    ["backend/lib/reportCard/fixtures/model-01/case.json", "backend/lib/reportCard/x.test.js"],
    // Un test modifié AVEC du code : complet.
    ["backend/lib/monoT1HttpHarness.js", MATRIX],
  ]) {
    const decision = selectPg(changed, PG_FILES);
    assert.equal(decision.backend, true, changed.join(","));
    assert.equal(decision.pg_mode, "full", changed.join(","));
  }
});

test("PR de tests seuls : tests modifiés + socle sécurité / multi-tenant / RBAC, jamais moins", () => {
  const changed = ["backend/lib/communicationsC3.http.pg.test.js", "backend/lib/reportCardPublish01.test.js", "web/src/x.ts"];
  const decision = selectPg(changed, PG_FILES);
  assert.equal(decision.pg_mode, "targeted");
  assert.ok(decision.files.includes("backend/lib/communicationsC3.http.pg.test.js"));
  const core = securityCore(PG_FILES);
  for (const file of core) assert.ok(decision.files.includes(file), file);
  for (const required of [
    MATRIX,
    "backend/lib/secTenant01Attachment.http.pg.test.js",
    "backend/lib/secTenant02SchoolIdentity.http.pg.test.js",
    "backend/lib/secAuth04SessionBinding.http.pg.test.js",
    "backend/lib/secJwt01TokenPolicy.http.pg.test.js",
    "backend/lib/monoT1.authSessions.http.pg.test.js",
    "backend/lib/usersTenant.http.pg.test.js",
    "backend/lib/parentAttendanceIsolation.http.pg.test.js",
    "backend/lib/bulletinSec01.http.pg.test.js",
  ]) {
    assert.ok(decision.files.includes(required), required);
  }
  // Test unitaire seul : socle sécurité quand même.
  assert.deepEqual(selectPg(["backend/lib/x.test.js"], PG_FILES).files, core);
  // Test pg supprimé : ignoré, le socle reste.
  assert.deepEqual(selectPg(["backend/lib/supprime.pg.test.js"], PG_FILES).files, core);
  // Chemins Windows normalisés.
  assert.equal(selectPg(["backend\\server.js"], PG_FILES).pg_mode, "full");
});

test("agrégation : conforme seulement si chaque fichier sélectionné est dans exactement un lot", () => {
  const expected = PG_FILES;
  const shards = plan.partition(expected, 3, WEIGHTS);
  const selectedDigest = plan.digest(expected);
  const plans = shards.map((files, i) => ({ shard: { index: i + 1, total: 3 }, selectedDigest, files }));
  assert.deepEqual(verifyShards({ expectedFiles: expected, plans, shards: 3 }), []);

  const missing = verifyShards({ expectedFiles: expected, plans: plans.slice(0, 2), shards: 3 });
  assert.ok(missing.some((problem) => problem.includes("lot 3/3 absent")));
  assert.ok(missing.some((problem) => problem.includes("aucun lot")));

  const dup = verifyShards({ expectedFiles: expected, plans: [...plans, plans[0]], shards: 3 });
  assert.ok(dup.some((problem) => problem.includes("présent deux fois")));

  const dropped = plans.map((p) => ({ ...p, files: p.files.filter((file) => file !== MATRIX) }));
  assert.ok(verifyShards({ expectedFiles: expected, plans: dropped, shards: 3 }).some((problem) => problem.includes(MATRIX)));

  const extra = plans.map((p, i) => (i ? p : { ...p, files: [...p.files, "backend/hors.pg.test.js"] }));
  assert.ok(verifyShards({ expectedFiles: expected, plans: extra, shards: 3 }).some((problem) => problem.includes("hors sélection")));

  const otherSelection = plans.map((p) => ({ ...p, selectedDigest: plan.digest([MATRIX]) }));
  assert.ok(verifyShards({ expectedFiles: expected, plans: otherSelection, shards: 3 }).some((problem) => problem.includes("sélection différente")));

  const wrongTotal = plans.map((p) => ({ ...p, shard: { ...p.shard, total: 2 } }));
  assert.notDeepEqual(verifyShards({ expectedFiles: expected, plans: wrongTotal, shards: 3 }), []);
});

test("poids : somme des durées de niveau 0 par fichier", () => {
  const file = path.join(ROOT, MATRIX);
  assert.deepEqual(
    weightsFromResults([
      { file, nesting: 0, durationMs: 1500 },
      { file, nesting: 0, durationMs: 500 },
      { file, nesting: 1, durationMs: 99999 },
      { file: null, nesting: 0, durationMs: 1 },
    ]),
    { [MATRIX]: 2 },
  );
});

test("PR Gates : le contrôle Required agrège les jobs backend et exige un succès quand ils sont planifiés", () => {
  const required = PR_GATES.slice(PR_GATES.indexOf("\n  required:"));
  for (const job of ["backend_unit", "backend_pg", "backend_pg_verify"]) {
    assert.match(required, new RegExp(`needs: \\[[^\\]]*\\b${job}\\b`), job);
  }
  assert.match(required, /expect_success/);
  assert.match(PR_GATES, /cancel-in-progress: true/);
  assert.doesNotMatch(PR_GATES, /continue-on-error:\s*true/);
});

test("PR Gates : le job unit backend tourne sans base, comme la baseline MONO-T0", () => {
  const job = PR_GATES.slice(PR_GATES.indexOf("\n  backend_unit:"), PR_GATES.indexOf("\n  backend_pg:"));
  assert.match(job, /\n      DATABASE_URL: ""\n/);
  assert.doesNotMatch(job, /services:/);
});
