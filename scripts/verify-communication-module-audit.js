"use strict";

/**
 * Gate d'audit module Communication.
 * - inventaire GREEN : doit passer
 * - tests Communication déjà livrés (parité COM-01…17, UX) : doivent passer
 * - C2/C3/C4 HTTP PG si DATABASE_URL
 * - tests RED ouverts : matrix.redTests doit être vide après #637
 * - AUDIT-COM-RED-01…06 doivent tous passer GREEN
 *   (Lots A #628, B #633, C/P3 #637). Régression si l'un redevient rouge.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const MATRIX_PATH = path.join(ROOT, "docs/audits/evidence/communication-module-audit-matrix.json");
const RESULTS_PATH = path.join(ROOT, "docs/audits/evidence/communication-module-audit-test-results.json");

const ALL_RED_IDS = [
  "AUDIT-COM-RED-01",
  "AUDIT-COM-RED-02",
  "AUDIT-COM-RED-03",
  "AUDIT-COM-RED-04",
  "AUDIT-COM-RED-05",
  "AUDIT-COM-RED-06",
];

function readMatrix() {
  return JSON.parse(fs.readFileSync(MATRIX_PATH, "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function mustPass(command, args, label, options) {
  const result = run(command, args, options);
  assert.equal(result.status, 0, `${label} a échoué (exit ${result.status})`);
  return result;
}

function parseFailedTestIds(output) {
  const ids = new Set();
  const patterns = [
    /^\s*not ok \d+ - (AUDIT-COM-RED-\d+)/gm,
    /✖ (AUDIT-COM-RED-\d+)/g,
    /# (AUDIT-COM-RED-\d+)/g,
    /'(AUDIT-COM-RED-\d+)'/g,
  ];
  for (const pattern of patterns) {
    for (const match of output.matchAll(pattern)) {
      ids.add(match[1]);
    }
  }
  return [...ids].sort();
}

function parsePassedTestIds(output) {
  const ids = new Set();
  for (const match of output.matchAll(/^\s*ok \d+ - (AUDIT-COM-RED-\d+)/gm)) {
    ids.add(match[1]);
  }
  return [...ids].sort();
}

function main() {
  const matrix = readMatrix();
  const expectedRed = [...matrix.redTests].sort();
  const closedRed = (matrix.closedRedTests || []).map((row) => row.id).sort();
  assert.deepEqual(
    expectedRed,
    [],
    "aucun RED ouvert après merge #637 : matrix.redTests doit être vide",
  );
  assert.deepEqual(
    closedRed,
    ALL_RED_IDS,
    "RED-01…06 doivent être clos GREEN dans la matrice (Lots A+B+#637)",
  );
  const results = {
    auditId: matrix.auditId,
    generatedAt: new Date().toISOString(),
    inventory: "pending",
    pariteRed: "skipped",
    pariteUx: "skipped",
    communicationsC2: "skipped",
    communicationsC3: "skipped",
    communicationsC4: "skipped",
    auditRed: "pending",
    redFailedIds: [],
    redPassedIds: [],
    redUnexpectedPass: [],
    redMissingFail: [],
  };

  mustPass(process.execPath, ["--test", "scripts/communication-module-audit.inventory.test.js"], "inventaire audit Communication");
  results.inventory = "PASS";

  mustPass("npm", ["run", "test:parite-communication-red"], "parité COM-01…17");
  results.pariteRed = "PASS";

  mustPass("npx", ["--yes", "tsx", "Mobile/src/lib/pariteCommunicationUx.test.ts"], "UX Communication Mobile");
  if (fs.existsSync(path.join(ROOT, "web/node_modules"))) {
    mustPass("npm", ["--prefix", "web", "run", "test:parite-communication-ux"], "UX Communication Web");
    results.pariteUx = "PASS";
  } else {
    results.pariteUx = "PARTIAL";
    console.log("web/node_modules absent : UX Web (vitest) non exécutée ici (CI l'exécute).");
  }

  if (String(process.env.DATABASE_URL || "").trim()) {
    mustPass("npm", ["run", "verify:communications-c2"], "Communications C2");
    results.communicationsC2 = "PASS";
    mustPass("npm", ["run", "verify:communications-c3"], "Communications C3");
    results.communicationsC3 = "PASS";
    mustPass("npm", ["run", "verify:communications-c4"], "Communications C4");
    results.communicationsC4 = "PASS";
  } else {
    console.log("DATABASE_URL absent : C2/C3/C4 HTTP PostgreSQL non exécutés dans cette gate locale.");
  }

  const red = run(process.execPath, ["--test", "--test-reporter", "tap", "scripts/communication-module-audit.red.test.js"]);
  const redOutput = `${red.stdout || ""}\n${red.stderr || ""}`;
  const failedIds = parseFailedTestIds(redOutput);
  const passedIds = parsePassedTestIds(redOutput);
  results.redFailedIds = failedIds;
  results.redPassedIds = passedIds;
  results.auditRed = red.status === 0 && failedIds.length === 0 ? "GREEN" : "REGRESSION";
  results.redUnexpectedPass = [];
  results.redMissingFail = [];

  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.writeFileSync(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`);

  assert.equal(red.status, 0, "AUDIT-COM-RED-01…06 doivent tous passer GREEN après #637");
  assert.deepEqual(failedIds, [], `RED en régression : ${failedIds.join(", ")}`);
  assert.deepEqual(
    passedIds,
    ALL_RED_IDS,
    `RED GREEN attendus : ${ALL_RED_IDS.join(", ")} ; observés : ${passedIds.join(", ")}`,
  );

  console.log("Audit Communication — inventaire GREEN + RED-01…06 GREEN.");
  console.log(`RED GREEN : ${passedIds.join(", ")}`);
}

main();
