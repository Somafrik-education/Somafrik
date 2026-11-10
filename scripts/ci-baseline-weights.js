"use strict";

/**
 * CI-FAST-01 — recalcule scripts/backend-test-baseline.weights.json à partir
 * des résultats JSON d'une exécution pg (artefacts backend-test-baseline-pg*).
 *
 *   node scripts/ci-baseline-weights.js <main.results.json>... [--write]
 *
 * Somme, par fichier, la durée des tests de niveau 0. Sans --write : affiche.
 * Les poids n'équilibrent que les lots : ils ne retirent jamais un fichier.
 */

const fs = require("node:fs");
const path = require("node:path");

const WEIGHTS_PATH = path.join(__dirname, "backend-test-baseline.weights.json");
const ROOT = path.resolve(__dirname, "..");

function weightsFromResults(results) {
  const seconds = {};
  for (const item of results) {
    if (item.nesting !== 0 || typeof item.durationMs !== "number" || !item.file) continue;
    const file = path.relative(ROOT, item.file).split(path.sep).join("/");
    seconds[file] = Math.round(((seconds[file] ?? 0) + item.durationMs / 1000) * 10) / 10;
  }
  return seconds;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const inputs = args.filter((arg) => arg !== "--write");
  if (!inputs.length) {
    console.error("Usage : node scripts/ci-baseline-weights.js <results.json>... [--write]");
    process.exit(1);
  }
  const measured = {};
  for (const input of inputs) Object.assign(measured, weightsFromResults(JSON.parse(fs.readFileSync(input, "utf8"))));
  if (!write) {
    console.log(JSON.stringify(measured, null, 2));
  } else {
    const current = JSON.parse(fs.readFileSync(WEIGHTS_PATH, "utf8"));
    const seconds = Object.fromEntries(Object.entries({ ...current.seconds, ...measured }).sort(([a], [b]) => (a < b ? -1 : 1)));
    fs.writeFileSync(WEIGHTS_PATH, `${JSON.stringify({ ...current, seconds }, null, 2)}\n`);
    console.log(`${Object.keys(measured).length} poids mis à jour.`);
  }
}

module.exports = { weightsFromResults };
