#!/usr/bin/env node
"use strict";

/**
 * ID-CANONICAL-01 — scanner des identités legacy.
 *
 *   npm run verify:id-canonical           # Lot A : rapport, exit 0 si inventaire complet
 *   npm run verify:id-canonical -- --strict
 *   npm run verify:id-canonical -- --json
 *
 * Lot A : les résidus runtime sont rapportés mais ne bloquent pas.
 * Lot D : --strict (ou ID_CANONICAL_STRICT=1) échoue hors allowlist.
 */

const fs = require("node:fs");
const path = require("node:path");
const { scanRepository, formatReport } = require("./id-canonical/scan");

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    strict: args.has("--strict") || process.env.ID_CANONICAL_STRICT === "1",
    json: args.has("--json"),
    write: args.has("--write"),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = scanRepository({ strict: options.strict });
  const text = formatReport(report);

  if (options.write) {
    const outPath = process.env.ID_CANONICAL_REPORT_PATH
      || path.resolve(__dirname, "../docs/audits/id-canonical-01a-scan-report.json");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${text}\n`);
  }

  if (!report.inventory.ok) {
    process.stderr.write("verify:id-canonical: inventaire d'entités incomplet.\n");
    process.exit(1);
  }

  if (options.strict && report.summary.blocking > 0) {
    process.stderr.write(
      `verify:id-canonical: ${report.summary.blocking} résidu(s) bloquant(s) (mode strict).\n`,
    );
    process.exit(1);
  }

  process.exit(0);
}

main();
