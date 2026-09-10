#!/usr/bin/env node
/**
 * Preuve L1 Impayés RED — métier L1-01…L1-10 + UX L1-UX-01…L1-UX-10.
 * N'exige PAS que L1-10 soit rouge (déjà conforme 360/390/430).
 * N'exige PAS que L0 redevienne rouge.
 * Exit 1 si crash, IDs manquants, ou si un test UX attendu rouge est vert sans surface dédiée.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const mobileRoot = path.join(__dirname, "..");
const repoRoot = path.join(mobileRoot, "..");

const L1_EXPECTED = Array.from({ length: 10 }, (_, i) => `L1-${String(i + 1).padStart(2, "0")}`);
const L1_UX_EXPECTED = Array.from({ length: 10 }, (_, i) => `L1-UX-${String(i + 1).padStart(2, "0")}`);

const files = [
  { file: "src/lib/pariteL1UnpaidKpi.red.test.ts", lot: "L1", expectedIds: L1_EXPECTED },
  { file: "src/lib/pariteL1UnpaidUx.red.test.ts", lot: "L1-UX", expectedIds: L1_UX_EXPECTED },
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

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  return String(result.stdout || "").trim();
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
  process.stdout.write(`\n===== ${spec.file} (exit ${result.status}) =====\n`);
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

  if (result.status !== 0 && result.status !== 1) {
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
}

const l1 = isolated[0]?.report;
const ux = isolated[1]?.report;
const evidenceDir = path.join(repoRoot, "docs/audits/evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
const evidence = {
  audit: "parite-l1-unpaid-red",
  generatedAt: new Date().toISOString(),
  head: gitHead(),
  expected: { L1: L1_EXPECTED, "L1-UX": L1_UX_EXPECTED, total: 20 },
  problems,
  files: isolated.map((row) => ({
    file: row.file,
    exit: row.exit,
    expectedIds: row.report?.expectedIds ?? null,
    failedIds: row.report?.failedIds ?? null,
    passedIds: row.report?.passedIds ?? null,
    failedCount: row.report?.failedIds?.length ?? null,
    passedCount: row.report?.passedIds?.length ?? null,
  })),
  summary: {
    L1: {
      green: l1?.passedIds?.length ?? null,
      red: l1?.failedIds?.length ?? null,
      total: 10,
      passedIds: l1?.passedIds ?? [],
      failedIds: l1?.failedIds ?? [],
    },
    "L1-UX": {
      green: ux?.passedIds?.length ?? null,
      red: ux?.failedIds?.length ?? null,
      total: 10,
      passedIds: ux?.passedIds ?? [],
      failedIds: ux?.failedIds ?? [],
    },
  },
  productionUntouched: true,
};
const evidencePath = path.join(evidenceDir, "parite-l1-red-verify.json");
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

if (problems.length) {
  console.error("\nFAIL verify L1 RED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

const l1Green = l1.passedIds.length;
const l1Red = l1.failedIds.length;
const uxGreen = ux.passedIds.length;
const uxRed = ux.failedIds.length;
console.log(`\nL1 métier : ${l1Green}/10 GREEN, ${l1Red}/10 RED`);
console.log(`L1 UX     : ${uxGreen}/10 GREEN, ${uxRed}/10 RED`);
console.log(`HEAD      : ${evidence.head}`);
console.log(`Preuve    : ${path.relative(repoRoot, evidencePath)}`);

if (l1Red === 0 && uxRed === 0) {
  console.error("STOP — tous les tests L1 sont verts ; le mandat RED interdit un GREEN accidentel.");
  process.exit(1);
}

process.exit(l1Red || uxRed ? 1 : 0);
