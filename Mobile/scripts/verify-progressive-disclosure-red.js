#!/usr/bin/env node
/**
 * Preuve lots restants : PD-02, PD-04, PD-06, PD-07 encore ROUGES.
 * PD-01 (Enseignants), PD-03 (Appel) et PD-05 (Finance élève) sont GREEN — voir progressiveDisclosureUx.test.ts.
 * Exit 0 seulement si tous les identifiants attendus sont en FAIL.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const mobileRoot = path.join(__dirname, "..");
const EXPECTED = ["PD-02", "PD-04", "PD-06", "PD-07"];

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
