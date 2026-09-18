"use strict";

/**
 * Gate d'audit parité Web / Mobile globale.
 *
 * GREEN : doivent passer (contrats déjà alignés).
 * RED   : doivent échouer (écarts ouverts — STOP, pas de correction dans cette PR).
 *
 *   node scripts/verify-web-mobile-parity-audit.js
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const RESULTS_PATH = path.join(ROOT, "docs/audits/evidence/web-mobile-parity-audit-test-results.json");

const EXPECTED_RED_IDS = [
  "PARITY-001",
  "PARITY-001b",
  "PARITY-080",
  "PARITY-012",
  "PARITY-027",
  "PARITY-011",
  "PARITY-081",
  "PARITY-021",
  "PARITY-022",
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function parseRedIds(output, passing) {
  const ids = new Set();
  const pattern = passing
    ? /^\s*ok \d+ - (PARITY-[0-9a-zA-Z]+)/gm
    : /^\s*not ok \d+ - (PARITY-[0-9a-zA-Z]+)/gm;
  for (const match of output.matchAll(pattern)) {
    ids.add(match[1]);
  }
  for (const id of EXPECTED_RED_IDS) {
    if (passing && output.includes(`# ${id}`) && /ok \d+/.test(output)) {
      // fallback: node:test titles
    }
  }
  const titlePattern = passing
    ? new RegExp(`^ok \\d+ .+?(PARITY-[0-9a-zA-Z]+)`, "gm")
    : /not ok \d+ (?:- )?(PARITY-[0-9a-zA-Z]+)/g;
  for (const match of output.matchAll(/^(?:not )?ok \d+ - (.+)$/gm)) {
    const line = match[1];
    const idMatch = line.match(/(PARITY-[0-9a-zA-Z]+)/);
    if (!idMatch) continue;
    const isNotOk = output.includes(`not ok`) && line.includes(idMatch[1]);
    if (passing && !output.split("\n").some((row) => row.startsWith("not ok") && row.includes(idMatch[1]))) {
      ids.add(idMatch[1]);
    }
    if (!passing && output.split("\n").some((row) => row.startsWith("not ok") && row.includes(idMatch[1]))) {
      ids.add(idMatch[1]);
    }
    void isNotOk;
  }
  return [...ids].sort();
}

function extractFailedTitles(output) {
  const failed = [];
  for (const match of output.matchAll(/^not ok \d+ - (.+)$/gm)) {
    failed.push(match[1]);
  }
  const ids = [];
  for (const title of failed) {
    const id = title.match(/(PARITY-[0-9a-zA-Z]+)/);
    ids.push(id ? id[1] : title);
  }
  return [...new Set(ids)].sort();
}

function extractPassedGreen(output) {
  const passed = [];
  for (const match of output.matchAll(/^ok \d+ - (.+)$/gm)) {
    passed.push(match[1]);
  }
  return passed;
}

function main() {
  const inventory = run(process.execPath, ["scripts/web-mobile-parity-audit.inventory.js"]);
  assert.equal(inventory.status, 0, "inventaire statique a échoué");

  const green = run("npx", ["--yes", "tsx", "--test", "scripts/web-mobile-parity-audit.green.test.ts"]);
  assert.equal(green.status, 0, "les tests GREEN de caractérisation doivent passer");

  const red = run("npx", ["--yes", "tsx", "--test", "scripts/web-mobile-parity-audit.red.test.ts"]);
  const redOutput = `${red.stdout || ""}\n${red.stderr || ""}`;
  const failedIds = extractFailedTitles(redOutput);
  const missing = EXPECTED_RED_IDS.filter((id) => !failedIds.some((failed) => String(failed).includes(id)));
  const unexpectedPass = red.status === 0;

  assert.notEqual(red.status, 0, "les tests RED doivent échouer tant que les lots ne sont pas lancés");
  assert.equal(
    missing.length,
    0,
    `IDs RED attendus absents de l'échec : ${missing.join(", ")} (échecs vus : ${failedIds.join(", ")})`,
  );
  void unexpectedPass;

  const results = {
    generatedAt: new Date().toISOString(),
    inventoryExit: inventory.status,
    greenExit: green.status,
    redExit: red.status,
    greenPassed: extractPassedGreen(`${green.stdout || ""}\n${green.stderr || ""}`),
    redFailed: failedIds,
    expectedRedIds: EXPECTED_RED_IDS,
    stop: true,
    readyForbidden: true,
    mergeForbidden: true,
  };
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.writeFileSync(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`);
  process.stdout.write(`Wrote ${path.relative(ROOT, RESULTS_PATH)}\n`);
}

main();
