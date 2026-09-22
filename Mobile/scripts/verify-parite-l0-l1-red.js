#!/usr/bin/env node
/**
 * Preuve Lots 0-1 encore ROUGES — 22 identifiants exacts.
 * Exit 0 seulement si L0-01…L0-12 et L1-01…L1-10 sont TOUS en FAIL.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const mobileRoot = path.join(__dirname, "..");
const repoRoot = path.join(mobileRoot, "..");

const L0_EXPECTED = Array.from({ length: 12 }, (_, i) => `L0-${String(i + 1).padStart(2, "0")}`);
const L1_EXPECTED = Array.from({ length: 10 }, (_, i) => `L1-${String(i + 1).padStart(2, "0")}`);

const files = [
  { file: "src/lib/pariteL0Hygiene.red.test.ts", lot: "L0", expectedIds: L0_EXPECTED },
  { file: "src/lib/pariteL1UnpaidKpi.red.test.ts", lot: "L1", expectedIds: L1_EXPECTED },
];

function parseReport(stdout, stderr) {
  const text = `${stdout || ""}\n${stderr || ""}`;
  const lines = text.split("\n").filter((line) => line.startsWith("PARITE_RED_REPORT "));
  if (!lines.length) return null;
  return JSON.parse(lines[lines.length - 1].slice("PARITE_RED_REPORT ".length));
}

function sameIds(actual, expected) {
  return JSON.stringify([...(actual || [])].sort()) === JSON.stringify([...expected].sort());
}

const isolated = [];
const problems = [];

for (const spec of files) {
  const result = spawnSync("npx", ["--yes", "tsx", spec.file], {
    cwd: mobileRoot,
    encoding: "utf8",
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  process.stdout.write(`\n===== ISOLÉ ${spec.file} (exit ${result.status}) =====\n`);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const report = parseReport(stdout, stderr);
  isolated.push({
    file: spec.file,
    exit: result.status,
    report,
    stdout,
    stderr,
  });

  if (result.status === 0) {
    problems.push(`${spec.lot}: exit 0 (attendu 1 tant que le lot n'est pas corrigé)`);
    continue;
  }
  if (result.status !== 1) {
    problems.push(`${spec.lot}: crash exit=${result.status}`);
    continue;
  }
  if (!report) {
    problems.push(`${spec.lot}: pas de PARITE_RED_REPORT`);
    continue;
  }
  if (report.lot !== spec.lot) {
    problems.push(`${spec.lot}: lot JSON=${report.lot}`);
  }
  if (!sameIds(report.expectedIds, spec.expectedIds)) {
    problems.push(`${spec.lot}: expectedIds JSON ≠ ${spec.expectedIds.join(",")}`);
  }
  if ((report.passedIds || []).length) {
    problems.push(`${spec.lot}: encore VERT ${report.passedIds.join(",")}`);
  }
  if (!sameIds(report.failedIds, spec.expectedIds)) {
    problems.push(
      `${spec.lot}: failedIds=[${(report.failedIds || []).join(",")}] ≠ ${spec.expectedIds.join(",")} (count ${
        (report.failedIds || []).length
      }/${spec.expectedIds.length})`,
    );
  }
}

const evidenceDir = path.join(repoRoot, "docs/audits/evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
const evidence = {
  generatedAt: new Date().toISOString(),
  expected: { L0: L0_EXPECTED, L1: L1_EXPECTED, total: 22 },
  problems,
  files: isolated.map((row) => ({
    file: row.file,
    exit: row.exit,
    failedIds: row.report?.failedIds ?? null,
    passedIds: row.report?.passedIds ?? null,
    failedCount: row.report?.failedIds?.length ?? null,
  })),
};
const evidencePath = path.join(evidenceDir, "parite-l0-l1-red-verify.json");
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

if (problems.length) {
  console.error("\nFAIL verify 22/22:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const l0 = isolated[0].report.failedIds.length;
const l1 = isolated[1].report.failedIds.length;
console.log(`\nOK: exactement ${l0}/12 L0 + ${l1}/10 L1 = 22/22 ROUGES — STOP avant implémentation.`);
console.log(`Preuve machine : ${path.relative(repoRoot, evidencePath)}`);
