"use strict";

/**
 * Gate d'audit module Communication.
 * - inventaire GREEN : doit passer
 * - tests Communication déjà livrés (parité COM-01…17, UX) : doivent passer
 * - C2/C3/C4 HTTP PG si DATABASE_URL
 * - tests RED ouverts : doivent échouer (preuve). Ensemble attendu = matrix.redTests
 *   (exactement AUDIT-COM-RED-02…06 après Lot A).
 * - AUDIT-COM-RED-01 doit passer GREEN (preuve #628). Si RED-01 redevient rouge,
 *   le gate échoue (régression Lot A).
 * - Si un RED-02…06 passe, le dossier n'est plus à jour.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const MATRIX_PATH = path.join(ROOT, "docs/audits/evidence/communication-module-audit-matrix.json");
const RESULTS_PATH = path.join(ROOT, "docs/audits/evidence/communication-module-audit-test-results.json");

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
    ["AUDIT-COM-RED-02", "AUDIT-COM-RED-03", "AUDIT-COM-RED-04", "AUDIT-COM-RED-05", "AUDIT-COM-RED-06"],
    "l'ensemble RED attendu doit être exactement RED-02…06 après Lot A",
  );
  assert.ok(closedRed.includes("AUDIT-COM-RED-01"), "RED-01 doit être clos GREEN dans la matrice");
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
  results.auditRed = red.status === 0 ? "UNEXPECTED_PASS" : "FAIL_AS_EXPECTED";

  const unexpectedPass = expectedRed.filter((id) => !failedIds.includes(id));
  const extraFail = failedIds.filter((id) => !expectedRed.includes(id));
  results.redUnexpectedPass = unexpectedPass;
  results.redMissingFail = unexpectedPass;

  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.writeFileSync(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`);

  if (red.status === 0) {
    throw new Error(
      "Tous les tests RED Communication sont verts. Mettre à jour le rapport (verdicts PASS) avant de retirer le lock RED-02…06.",
    );
  }
  assert.ok(
    passedIds.includes("AUDIT-COM-RED-01"),
    "RED-01 doit passer GREEN (Lot A #628). Régression si absent des PASS.",
  );
  assert.ok(
    !failedIds.includes("AUDIT-COM-RED-01"),
    "RED-01 redevient rouge : régression du Lot A, dossier d'audit invalide.",
  );
  assert.deepEqual(
    unexpectedPass,
    [],
    `RED attendus non observés (défaut peut-être corrigé, mettre à jour l'audit) : ${unexpectedPass.join(", ")}`,
  );
  assert.deepEqual(
    extraFail,
    [],
    `RED inattendus : ${extraFail.join(", ")}`,
  );
  assert.deepEqual(failedIds, expectedRed, "l'ensemble des RED échoués doit être exactement RED-02…06");

  console.log("Audit Communication — inventaire GREEN + RED verrouillés.");
  console.log(`RED GREEN : ${passedIds.join(", ") || "(aucun)"}`);
  console.log(`RED échoués (preuve) : ${failedIds.join(", ")}`);
}

main();
