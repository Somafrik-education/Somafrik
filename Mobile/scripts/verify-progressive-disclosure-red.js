#!/usr/bin/env node
/**
 * Preuve lots restants : plus aucun PD rouge (contrat clos).
 * PD-01 à PD-07 sont GREEN — voir progressiveDisclosureUx.test.ts.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const mobileRoot = path.join(__dirname, "..");
const EXPECTED = [];

const result = spawnSync("npx", ["--yes", "tsx", "src/lib/progressiveDisclosure.red.test.ts"], {
  cwd: mobileRoot,
  encoding: "utf8",
});

const stdout = result.stdout || "";
const stderr = result.stderr || "";
process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);

const line = `${stdout}\n${stderr}`.split("\n").find((row) => row.startsWith("PARITE_RED_REPORT "));
if (!line) {
  console.error("FAIL: pas de PARITE_RED_REPORT");
  process.exit(1);
}

const report = JSON.parse(line.slice("PARITE_RED_REPORT ".length));
const failed = [...(report.failedIds || [])].sort();
const expected = [...EXPECTED].sort();
const passed = report.passedIds || [];

if (EXPECTED.length === 0) {
  if (result.status !== 0) {
    console.error("FAIL: contrat clos mais red test EXIT ≠ 0");
    process.exit(1);
  }
  if (passed.length) {
    console.error(`FAIL: encore VERT ${passed.join(",")}`);
    process.exit(1);
  }
  if (failed.length) {
    console.error(`FAIL: encore ROUGE ${failed.join(",")}`);
    process.exit(1);
  }
  if (JSON.stringify(failed) !== JSON.stringify(expected)) {
    console.error(`FAIL: failedIds=[${failed.join(",")}] ≠ ${expected.join(",")}`);
    process.exit(1);
  }
  console.log("OK: 0 PD encore ROUGES — contrat progressive disclosure clos.");
  process.exit(0);
}

if (result.status === 0) {
  console.error("FAIL: exit 0 (attendu 1 tant que le lot n'est pas corrigé)");
  process.exit(1);
}
if (passed.length) {
  console.error(`FAIL: encore VERT ${passed.join(",")}`);
  process.exit(1);
}
if (JSON.stringify(failed) !== JSON.stringify(expected)) {
  console.error(`FAIL: failedIds=[${failed.join(",")}] ≠ ${expected.join(",")}`);
  process.exit(1);
}

console.log(`OK: exactement ${failed.length}/${EXPECTED.length} PD encore ROUGES — STOP avant lots UI restants.`);
