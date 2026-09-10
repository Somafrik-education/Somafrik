#!/usr/bin/env node
/**
 * Preuve L1 Impayés RED — métier L1-01…L1-10 + UX L1-UX-01…L1-UX-10.
 *
 * Baseline figée (tout écart de statut = FAIL preuve) :
 *   L1 failed  = L1-01…L1-09
 *   L1 passed  = L1-10
 *   L1-UX failed = L1-UX-01…L1-UX-10
 *   L1-UX passed = ∅
 *
 * productionUntouched est calculé depuis `git diff` vs la base L0, pas écrit en dur.
 * Exit 1 tant que la phase RED reste rouge (attendu) SI problems=[] et baseline exacte.
 * Exit 1 aussi si crash, baseline inexacte, production touchée, L0 non vert, ou GREEN accidentel.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const mobileRoot = path.join(__dirname, "..");
const repoRoot = path.join(mobileRoot, "..");
const evidenceRel = "docs/audits/evidence/parite-l1-red-verify.json";
const evidencePath = path.join(repoRoot, evidenceRel);

const L0_BASE_SHA = "4a526d1a442a6f1587ea347e5a50e33de57ea34b";
const PR_BRANCH = "cursor/l1-unpaid-red-tests-8d64";

const L0_EXPECTED = Array.from({ length: 12 }, (_, i) => `L0-${String(i + 1).padStart(2, "0")}`);
const L1_EXPECTED = Array.from({ length: 10 }, (_, i) => `L1-${String(i + 1).padStart(2, "0")}`);
const L1_UX_EXPECTED = Array.from({ length: 10 }, (_, i) => `L1-UX-${String(i + 1).padStart(2, "0")}`);

const L1_FAILED_EXPECTED = L1_EXPECTED.filter((id) => id !== "L1-10");
const L1_PASSED_EXPECTED = ["L1-10"];
const L1_UX_FAILED_EXPECTED = [...L1_UX_EXPECTED];
const L1_UX_PASSED_EXPECTED = [];

const ALLOWED_PATHS = new Set([
  "Mobile/package.json",
  "Mobile/scripts/verify-parite-l1-red.js",
  "Mobile/scripts/verify-parite-l1-red.test.js",
  "Mobile/src/lib/pariteL0L1RedReport.ts",
  "Mobile/src/lib/pariteL1Unpaid.shipped.ts",
  "Mobile/src/lib/pariteL1UnpaidKpi.red.test.ts",
  "Mobile/src/lib/pariteL1UnpaidUx.red.test.ts",
  "docs/audits/evidence/parite-l1-red-verify.json",
  "docs/audits/parite-l0-l1-ux-maquette.md",
  "docs/audits/parite-web-mobile-l1-red-2026-09-10.md",
  "package.json",
]);

const FORBIDDEN_PATHS = [
  "Mobile/src/screens/HomeScreen.tsx",
  "Mobile/src/screens/PaymentsScreen.tsx",
  "Mobile/src/navigation/AppNavigator.tsx",
  "Mobile/src/services/api.ts",
];

const files = [
  { file: "src/lib/pariteL1UnpaidKpi.red.test.ts", lot: "L1", expectedIds: L1_EXPECTED },
  { file: "src/lib/pariteL1UnpaidUx.red.test.ts", lot: "L1-UX", expectedIds: L1_UX_EXPECTED },
];

function sameIds(actual, expected) {
  return JSON.stringify([...(actual || [])].sort()) === JSON.stringify([...expected].sort());
}

function mismatch(label, actual, expected) {
  return `${label}=[${(actual || []).join(",")}] ≠ [${expected.join(",")}]`;
}

function isForbiddenRuntime(file) {
  if (FORBIDDEN_PATHS.includes(file)) return true;
  const base = path.posix.basename(file.replace(/\\/g, "/"));
  return /unpaidscreen/i.test(base);
}

function evaluateProductionDiff(changedFiles, allowed = ALLOWED_PATHS) {
  const sorted = [...new Set(changedFiles)].sort();
  const unexpectedFiles = sorted.filter((file) => !allowed.has(file));
  const forbiddenHits = sorted.filter(isForbiddenRuntime);
  return {
    changedFiles: sorted,
    unexpectedFiles,
    forbiddenHits,
    productionUntouched: unexpectedFiles.length === 0 && forbiddenHits.length === 0,
  };
}

function git(args, cwd = repoRoot) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
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

function listChangedFilesVsBase(baseSha) {
  return [
    ...gitNameOnly(["diff", "--name-only", `${baseSha}...HEAD`]),
    ...gitNameOnly(["diff", "--name-only", baseSha]),
    ...gitNameOnly(["diff", "--name-only", "--cached", baseSha]),
    ...gitNameOnly(["ls-files", "--others", "--exclude-standard"]),
  ];
}

function inspectProductionDiff(baseSha = L0_BASE_SHA) {
  return {
    baseSha,
    ...evaluateProductionDiff(listChangedFilesVsBase(baseSha)),
  };
}

function parseReport(stdout, stderr) {
  const text = `${stdout || ""}\n${stderr || ""}`;
  const lines = text.split("\n").filter((line) => line.startsWith("PARITE_RED_REPORT "));
  if (!lines.length) return null;
  return JSON.parse(lines[lines.length - 1].slice("PARITE_RED_REPORT ".length));
}

function runTsx(relFile) {
  return spawnSync("npx", ["--yes", "tsx", relFile], {
    cwd: mobileRoot,
    encoding: "utf8",
  });
}

function stampHeads() {
  if (!fs.existsSync(evidencePath)) {
    console.error(`FAIL stamp: ${evidenceRel} absent`);
    process.exit(1);
  }
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  if (!evidence.testedHead) {
    console.error("FAIL stamp: testedHead manquant — relancer les tests avant de tamponner prHead");
    process.exit(1);
  }
  const head = gitHead();
  evidence.evidenceCommit = head;
  evidence.prHead = head;
  evidence.stampedAt = new Date().toISOString();
  evidence.shaNote =
    "testedHead = SHA sur lequel les tests ont tourné. evidenceCommit/prHead = SHA de ce tampon (HEAD au moment du stamp). Si un commit ultérieur n'ajoute que ce tampon, GitHub HEAD = ce SHA.";
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`stamped evidenceCommit/prHead = ${head}`);
  console.log(`testedHead                = ${evidence.testedHead}`);
  process.exit(0);
}

function main() {
  if (process.argv.includes("--stamp-heads")) {
    stampHeads();
    return;
  }

  const problems = [];
  const testedHead = gitHead();
  const productionDiff = inspectProductionDiff();
  if (!productionDiff.productionUntouched) {
    if (productionDiff.forbiddenHits.length) {
      problems.push(`production interdite: ${productionDiff.forbiddenHits.join(", ")}`);
    }
    if (productionDiff.unexpectedFiles.length) {
      problems.push(`fichiers hors allowlist RED: ${productionDiff.unexpectedFiles.join(", ")}`);
    }
  }

  const unit = spawnSync("node", ["--test", "scripts/verify-parite-l1-red.test.js"], {
    cwd: mobileRoot,
    encoding: "utf8",
  });
  process.stdout.write(`\n===== verify-parite-l1-red.test.js (exit ${unit.status}) =====\n`);
  if (unit.stdout) process.stdout.write(unit.stdout);
  if (unit.stderr) process.stderr.write(unit.stderr);
  if (unit.status !== 0) {
    problems.push(`harnais verify: exit=${unit.status}`);
  }

  const l0Result = runTsx("src/lib/pariteL0Hygiene.red.test.ts");
  process.stdout.write(`\n===== pariteL0Hygiene.red.test.ts (exit ${l0Result.status}) =====\n`);
  if (l0Result.stdout) process.stdout.write(l0Result.stdout);
  if (l0Result.stderr) process.stderr.write(l0Result.stderr);
  const l0 = parseReport(l0Result.stdout, l0Result.stderr);
  if (l0Result.status !== 0) {
    problems.push(`L0: exit=${l0Result.status} (attendu 0, 12/12 GREEN)`);
  } else if (!l0) {
    problems.push("L0: pas de PARITE_RED_REPORT");
  } else {
    if (!sameIds(l0.passedIds, L0_EXPECTED)) problems.push(mismatch("L0 passedIds", l0.passedIds, L0_EXPECTED));
    if (!sameIds(l0.failedIds, [])) problems.push(mismatch("L0 failedIds", l0.failedIds, []));
  }

  const isolated = [];
  for (const spec of files) {
    const result = runTsx(spec.file);
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

  if (l1) {
    if (!sameIds(l1.failedIds, L1_FAILED_EXPECTED)) {
      problems.push(mismatch("L1 failedIds", l1.failedIds, L1_FAILED_EXPECTED));
    }
    if (!sameIds(l1.passedIds, L1_PASSED_EXPECTED)) {
      problems.push(mismatch("L1 passedIds", l1.passedIds, L1_PASSED_EXPECTED));
    }
  }
  if (ux) {
    if (!sameIds(ux.failedIds, L1_UX_FAILED_EXPECTED)) {
      problems.push(mismatch("L1-UX failedIds", ux.failedIds, L1_UX_FAILED_EXPECTED));
    }
    if (!sameIds(ux.passedIds, L1_UX_PASSED_EXPECTED)) {
      problems.push(mismatch("L1-UX passedIds", ux.passedIds, L1_UX_PASSED_EXPECTED));
    }
  }

  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const evidence = {
    audit: "parite-l1-unpaid-red",
    generatedAt: new Date().toISOString(),
    l0BaseSha: L0_BASE_SHA,
    branch: PR_BRANCH,
    testedHead,
    prHeadAtTestTime: testedHead,
    evidenceCommit: null,
    prHead: null,
    shaNote:
      "testedHead = SHA sur lequel les tests ont tourné. evidenceCommit/prHead sont tamponnés après le commit de cette preuve (`node scripts/verify-parite-l1-red.js --stamp-heads`) et peuvent différer de testedHead si le commit suivant est evidence-only.",
    expected: {
      L1: L1_EXPECTED,
      "L1-UX": L1_UX_EXPECTED,
      L1_failed: L1_FAILED_EXPECTED,
      L1_passed: L1_PASSED_EXPECTED,
      "L1-UX_failed": L1_UX_FAILED_EXPECTED,
      "L1-UX_passed": L1_UX_PASSED_EXPECTED,
      total: 20,
    },
    problems,
    l0NonRegression: {
      green: l0?.passedIds?.length ?? null,
      red: l0?.failedIds?.length ?? null,
      passedIds: l0?.passedIds ?? [],
      failedIds: l0?.failedIds ?? [],
    },
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
        requiredPassedIds: L1_PASSED_EXPECTED,
        requiredFailedIds: L1_FAILED_EXPECTED,
      },
      "L1-UX": {
        green: ux?.passedIds?.length ?? null,
        red: ux?.failedIds?.length ?? null,
        total: 10,
        passedIds: ux?.passedIds ?? [],
        failedIds: ux?.failedIds ?? [],
        requiredPassedIds: L1_UX_PASSED_EXPECTED,
        requiredFailedIds: L1_UX_FAILED_EXPECTED,
      },
    },
    productionUntouched: productionDiff.productionUntouched,
    productionDiff: {
      baseSha: productionDiff.baseSha,
      changedFiles: productionDiff.changedFiles,
      allowedFiles: [...ALLOWED_PATHS].sort(),
      unexpectedFiles: productionDiff.unexpectedFiles,
      forbiddenHits: productionDiff.forbiddenHits,
    },
  };
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
  console.log(`\nL0        : ${l0.passedIds.length}/12 GREEN`);
  console.log(`L1 métier : ${l1Green}/10 GREEN, ${l1Red}/10 RED (exact L1-10 GREEN, L1-01…L1-09 RED)`);
  console.log(`L1 UX     : ${uxGreen}/10 GREEN, ${uxRed}/10 RED (exact 10 RED)`);
  console.log(`testedHead: ${testedHead}`);
  console.log(`productionUntouched: ${evidence.productionUntouched} (diff vs ${L0_BASE_SHA})`);
  console.log(`Preuve    : ${evidenceRel}`);

  if (l1Red === 0 && uxRed === 0) {
    console.error("STOP — tous les tests L1 sont verts ; le mandat RED interdit un GREEN accidentel.");
    process.exit(1);
  }

  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOWED_PATHS,
  FORBIDDEN_PATHS,
  L0_BASE_SHA,
  L1_EXPECTED,
  L1_FAILED_EXPECTED,
  L1_PASSED_EXPECTED,
  L1_UX_EXPECTED,
  L1_UX_FAILED_EXPECTED,
  L1_UX_PASSED_EXPECTED,
  evaluateProductionDiff,
  isForbiddenRuntime,
  sameIds,
};
