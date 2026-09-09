#!/usr/bin/env node
/**
 * Preuve Lots 0-1 encore ROUGES (PR #577).
 * Exit 0 = les tests rouges échouent encore (écart présent, passe audit OK).
 * Exit 1 = un fichier est devenu vert sans lot d'implémentation, ou crash d'exécution.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const mobileRoot = path.join(__dirname, "..");
const files = [
  "src/lib/pariteL0Hygiene.red.test.ts",
  "src/lib/pariteL1UnpaidKpi.red.test.ts",
];

let unexpectedGreen = [];
let crashed = [];

for (const file of files) {
  const result = spawnSync("npx", ["--yes", "tsx", file], {
    cwd: mobileRoot,
    encoding: "utf8",
  });
  process.stdout.write(`\n===== ${file} (exit ${result.status}) =====\n`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status === 0) unexpectedGreen.push(file);
  else if (result.status !== 1) crashed.push(`${file} exit=${result.status}`);
}

if (crashed.length) {
  console.error("FAIL verify: crash inattendu:", crashed.join(", "));
  process.exit(1);
}
if (unexpectedGreen.length) {
  console.error(
    "FAIL verify: tests devenus verts sans implémentation L0/L1:",
    unexpectedGreen.join(", "),
  );
  process.exit(1);
}

console.log("\nOK: L0 et L1 encore ROUGES — STOP avant implémentation (#577).");
