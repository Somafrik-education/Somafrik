#!/usr/bin/env node
/**
 * Preuve L1 Impayés GREEN — métier 10/10 + UX 10/10 + L0 12/12.
 * Exit 0 seulement si la baseline GREEN est exacte et qu'aucun backend/web n'est touché.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const mobileRoot = path.join(__dirname, "..");
const repoRoot = path.join(mobileRoot, "..");
const evidenceRel = "docs/audits/evidence/parite-l1-green-verify.json";
const evidencePath = path.join(repoRoot, evidenceRel);

const DEVELOP_BASE_SHA = "b0bcc27799cc43bab74c7c1f23279b8897b5a5a8";
const PR_BRANCH = "feat/577-l1-mobile-unpaid-green";

const L0_EXPECTED = Array.from({ length: 12 }, (_, i) => `L0-${String(i + 1).padStart(2, "0")}`);
const L1_EXPECTED = Array.from({ length: 10 }, (_, i) => `L1-${String(i + 1).padStart(2, "0")}`);
const L1_UX_EXPECTED = Array.from({ length: 10 }, (_, i) => `L1-UX-${String(i + 1).padStart(2, "0")}`);

function sameIds(actual, expected) {
  return JSON.stringify([...(actual || [])].sort()) === JSON.stringify([...expected].sort());
}

function mismatch(label, actual, expected) {
  return `${label}=[${(actual || []).join(",")}] ≠ [${expected.join(",")}]`;
}

function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return {
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function gitHead() {
  return git(["rev-parse", "HEAD"]).stdout;
}

function gitNameOnly(args) {
  const result = git(args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout ? result.stdout.split("\n").map((line) => line.trim()).filter(Boolean) : [];
}

function parseReport(stdout, stderr) {
  const text = `${stdout || ""}\n${stderr || ""}`;
  const lines = text.split("\n").filter((line) => line.startsWith("PARITE_RED_REPORT "));
  if (!lines.length) return null;
  return JSON.parse(lines[lines.length - 1].slice("PARITE_RED_REPORT ".length));
}

function runTsx(relFile) {
  return spawnSync("npx", ["--yes", "tsx", relFile], { cwd: mobileRoot, encoding: "utf8" });
}

function main() {
  const problems = [];
  const testedHead = gitHead();
  const changedFiles = [
    ...new Set([
      ...gitNameOnly(["diff", "--name-only", `${DEVELOP_BASE_SHA}...HEAD`]),
      ...gitNameOnly(["diff", "--name-only", DEVELOP_BASE_SHA]),
      ...gitNameOnly(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ].sort();
  const backendHits = changedFiles.filter((file) => file.startsWith("backend/") || file.startsWith("web/"));
  if (backendHits.length) {
    problems.push(`hors périmètre backend/web: ${backendHits.join(", ")}`);
  }

  const ledger = runTsx("src/lib/unpaidLedger.test.ts");
  process.stdout.write(`\n===== unpaidLedger.test.ts (exit ${ledger.status}) =====\n`);
  if (ledger.stdout) process.stdout.write(ledger.stdout);
  if (ledger.stderr) process.stderr.write(ledger.stderr);
  if (ledger.status !== 0) problems.push("unpaidLedger.test.ts: exit≠0");

  const isolated = [];
  const files = [
    { file: "src/lib/pariteL0Hygiene.red.test.ts", lot: "L0", expectedIds: L0_EXPECTED },
    { file: "src/lib/pariteL1UnpaidKpi.red.test.ts", lot: "L1", expectedIds: L1_EXPECTED },
    { file: "src/lib/pariteL1UnpaidUx.red.test.ts", lot: "L1-UX", expectedIds: L1_UX_EXPECTED },
  ];

  for (const spec of files) {
    const result = runTsx(spec.file);
    const stdout = result.stdout || "";
    const stderr = result.stderr || "";
    process.stdout.write(`\n===== ${spec.file} (exit ${result.status}) =====\n`);
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    const report = parseReport(stdout, stderr);
    isolated.push({ file: spec.file, exit: result.status, report });
    if (result.status !== 0) {
      problems.push(`${spec.lot}: exit=${result.status} (attendu 0)`);
    }
    if (!report) {
      problems.push(`${spec.lot}: pas de PARITE_RED_REPORT`);
      continue;
    }
    if (!sameIds(report.expectedIds, spec.expectedIds)) {
      problems.push(`${spec.lot}: expectedIds JSON ≠ ${spec.expectedIds.join(",")}`);
    }
    if (!sameIds(report.passedIds, spec.expectedIds)) {
      problems.push(mismatch(`${spec.lot} passedIds`, report.passedIds, spec.expectedIds));
    }
    if (!sameIds(report.failedIds, [])) {
      problems.push(mismatch(`${spec.lot} failedIds`, report.failedIds, []));
    }
  }

  const l0Report = isolated[0]?.report;
  const l1 = isolated[1]?.report;
  const ux = isolated[2]?.report;

  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const evidence = {
    audit: "parite-l1-unpaid-green",
    generatedAt: new Date().toISOString(),
    developBaseSha: DEVELOP_BASE_SHA,
    branch: PR_BRANCH,
    testedHead,
    prHeadAtTestTime: testedHead,
    evidenceCommit: null,
    prHead: null,
    shaNote:
      "testedHead = SHA des tests. evidenceCommit/prHead = commit de cette preuve JSON s'il est distinct.",
    problems,
    changedFiles,
    backendOrWebHits: backendHits,
    files: isolated.map((row) => ({
      file: row.file,
      exit: row.exit,
      passedIds: row.report?.passedIds ?? null,
      failedIds: row.report?.failedIds ?? null,
      passedCount: row.report?.passedIds?.length ?? null,
      failedCount: row.report?.failedIds?.length ?? null,
    })),
    summary: {
      L0: { green: l0Report?.passedIds?.length ?? null, red: l0Report?.failedIds?.length ?? null, total: 12 },
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
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  if (problems.length) {
    console.error("\nFAIL verify L1 GREEN:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(`\nL0        : ${l0Report.passedIds.length}/12 GREEN`);
  console.log(`L1 métier : ${l1.passedIds.length}/10 GREEN`);
  console.log(`L1 UX     : ${ux.passedIds.length}/10 GREEN`);
  console.log(`testedHead: ${testedHead}`);
  console.log(`Preuve    : ${evidenceRel}`);
  process.exit(0);
}

main();
