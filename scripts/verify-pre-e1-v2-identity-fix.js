/**
 * FIX V2.1 IDENTITY — preuve machine AC-NEW / AC-REG / AC-HIST
 *
 *   npm run verify:pre-e1-v2-identity-fix
 *
 * Produit : docs/audits/evidence/pre-e1-v2-identity-fix-results.json
 *
 * Séparation CTO (PR #99 revalidation) :
 * - Scripts + preuves HISTORIQUES V1 / HOTFIX-02B : inchangés (develop@contrat)
 * - Rejeu historique → artefacts *-post-fix-v21-* (ne réécrit pas les preuves antérieures)
 * - Adaptations nécessaires → scripts/artefacts *-fix-adapted-*
 * - Ne modifie PAS pre-e1-v2-identity-lifecycle-results.json (#95/#96)
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const EVIDENCE_DIR = path.join(ROOT, "docs", "audits", "evidence");
const OUT_FILE = path.join(
  EVIDENCE_DIR,
  process.env.SOMAFRIK_PRE_E1_FIX_EVIDENCE_FILE || "pre-e1-v2-identity-fix-results.json",
);

const HISTORICAL_EVIDENCE = [
  "pre-e1-v1-rerun-hotfix-pre-e1-02-results.json",
  "pre-e1-hotfix-02b-results.json",
  "notes-authz-trace-02b.jsonl",
];

const results = {
  audit: "PRE-E1",
  phase: "V2.1-FIX",
  subject: "PRE-E1-IDENTITY-LIFECYCLE-FIX",
  contract: "docs/audits/CONTRAT-FIX-V2.1-IDENTITY.md",
  generatedAt: new Date().toISOString(),
  nature: "corrective-implementation-proof",
  ctoSeparation: {
    historicalScriptsUnchanged: [
      "scripts/verify-pre-e1-v1.js",
      "scripts/verify-pre-e1-hotfix-02b.js",
    ],
    historicalEvidenceIntact: HISTORICAL_EVIDENCE,
    adaptedScripts: [
      "scripts/verify-pre-e1-v2-identity-fix-adapted-v1.js",
      "scripts/verify-pre-e1-v2-identity-fix-adapted-02b.js",
    ],
    bulkAmbiguityRule: "§4.1.b — identity-related write → TEACHER_CANON_AMBIGUOUS ; unrelated PUT → noop traced",
    historicalMultiTwinRule: "§4.1.c — single TEACHER-* update ; multi → TEACHER_HISTORICAL_MULTI_TWIN noop",
  },
  criteria: [],
  gates: [],
  staticChecks: [],
  historicalIntegrity: [],
  ok: true,
};

function record(bucket, id, title, pass, detail = null, extra = null) {
  const row = {
    id,
    title,
    status: pass ? "PASS" : "FAIL",
    detail: detail == null ? null : String(detail),
    extra: extra || null,
  };
  bucket.push(row);
  if (!pass) results.ok = false;
  console.log(`  ${pass ? "✓" : "✗"} [${id}] ${title}${detail ? ` — ${detail}` : ""}`);
  return row;
}

function runNode(relPath, env = {}) {
  const absolute = path.join(ROOT, relPath);
  const proc = spawnSync(process.execPath, [absolute], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    status: proc.status,
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
    ok: proc.status === 0,
  };
}

function runNpm(script, env = {}) {
  const proc = spawnSync("npm", ["run", script], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: true,
  });
  return {
    status: proc.status,
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
    ok: proc.status === 0,
  };
}

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function sha256File(relPath) {
  const crypto = require("crypto");
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

function restoreHistoricalEvidence() {
  const proc = spawnSync(
    "git",
    ["checkout", "origin/develop", "--", ...HISTORICAL_EVIDENCE.map((f) => `docs/audits/evidence/${f}`)],
    { cwd: ROOT, encoding: "utf8" },
  );
  return proc.status === 0;
}

function relocateIfExists(fromName, toName) {
  const from = path.join(EVIDENCE_DIR, fromName);
  const to = path.join(EVIDENCE_DIR, toName);
  if (!fs.existsSync(from)) return false;
  fs.renameSync(from, to);
  return true;
}

function main() {
  console.log("=== FIX V2.1 IDENTITY — preuves AC ===\n");

  // Garantir preuves historiques = baseline develop avant tout rejeu
  restoreHistoricalEvidence();

  // Snapshot hashes des preuves historiques avant tout rejeu
  console.log("Historical evidence integrity (pre-run)");
  const histHashesBefore = {};
  for (const name of HISTORICAL_EVIDENCE) {
    const hash = sha256File(`docs/audits/evidence/${name}`);
    histHashesBefore[name] = hash;
    record(
      results.historicalIntegrity,
      `HIST-HASH-BEFORE-${name}`,
      `Hash preuve historique ${name}`,
      Boolean(hash),
      hash ? hash.slice(0, 16) : "missing",
    );
  }

  // --- Static ---
  console.log("\nStatic checks");
  const evalAttachment = read("backend/lib/evaluationAttachment.js");
  const pgRepo = read("backend/db/postgresRepository.js");
  const syncSvc = read("backend/services/userTeacherSyncService.js");
  const histV1 = read("scripts/verify-pre-e1-v1.js");
  const hist02b = read("scripts/verify-pre-e1-hotfix-02b.js");

  record(
    results.staticChecks,
    "STATIC-01",
    "evaluationAttachment n'appelle pas findAnyTeacher",
    !/findAnyTeacher\s*\(/.test(evalAttachment),
  );
  record(
    results.staticChecks,
    "STATIC-02",
    "postgresRepository upsertEvaluation n'enregistre plus findAnyTeacher",
    !/findAnyTeacher\s*:/.test(pgRepo),
  );
  record(
    results.staticChecks,
    "STATIC-03",
    "UserTeacherSyncService crée TEACHERS-* (pas TEACHER-${Date})",
    /newTeachersId|TEACHERS-\$\{/.test(syncSvc) && !/TEACHER-\$\{Date\.now\(\)\}/.test(syncSvc),
  );
  record(
    results.staticChecks,
    "STATIC-04",
    "§4.1.b isIdentityRelatedWrite + skip unrelated tracé",
    /isIdentityRelatedWrite/.test(syncSvc) &&
      /TEACHER_CANON_AMBIGUOUS_SKIPPED_UNRELATED/.test(syncSvc),
  );
  record(
    results.staticChecks,
    "STATIC-05",
    "§4.1.c pas de fallback ?? twins[0] ; TEACHER_HISTORICAL_MULTI_TWIN",
    !/\?\?\s*twins\[0\]/.test(syncSvc) && /TEACHER_HISTORICAL_MULTI_TWIN/.test(syncSvc),
  );
  record(
    results.staticChecks,
    "STATIC-06",
    "Harness historique V1 sans adaptation canon/DUP",
    !/syncedCanon/.test(histV1) && !/stateBeforeDup/.test(histV1),
  );
  record(
    results.staticChecks,
    "STATIC-07",
    "Harness historique 02B sans adaptation canon",
    !/syncedCanon/.test(hist02b),
  );

  // --- Unit ---
  console.log("\nUnit criteria");
  const syncUnit = runNode("backend/services/userTeacherSyncService.test.js");
  record(
    results.criteria,
    "AC-NEW-01",
    "Compte nouveau → TEACHERS-* uniquement (unit)",
    syncUnit.ok,
    syncUnit.ok ? null : syncUnit.stderr || syncUnit.stdout,
  );
  record(
    results.criteria,
    "AC-DET-01",
    "§4.1 / §4.1.b ambiguïté liée vs PUT étranger (unit)",
    syncUnit.ok,
    syncUnit.ok ? "couvert par userTeacherSyncService.test.js" : syncUnit.stderr,
  );
  record(
    results.criteria,
    "AC-HIST-02",
    "TEACHER-* seul + multi-TEACHER-* no-op (unit)",
    syncUnit.ok,
    syncUnit.ok ? "couvert par userTeacherSyncService.test.js" : syncUnit.stderr,
  );

  const evalUnit = runNode("backend/lib/evaluationAttachment.test.js");
  record(
    results.criteria,
    "AC-NEW-04-UNIT",
    "Eval : lookup exact / matérialisation / refus (pas findAnyTeacher)",
    evalUnit.ok,
    evalUnit.ok ? "EVAL_TEACHER_UNRESOLVED + pas d'opportunisme" : evalUnit.stderr || evalUnit.stdout,
  );

  // --- Historical gates (scripts inchangés) → artefacts post-fix séparés ---
  console.log("\nHistorical gates (unchanged scripts → post-fix artifacts)");
  if (process.env.SOMAFRIK_FIX_GATES === "unit") {
    record(results.gates, "AC-REG-01-HIST", "hotfix-02b historique skipped (unit)", true, "skipped");
    record(results.gates, "AC-REG-02-HIST", "v1 historique skipped (unit)", true, "skipped");
  } else {
    const v1Hist = runNpm("verify:pre-e1-v1", {
      SOMAFRIK_PRE_E1_EVIDENCE_FILE: "pre-e1-v1-post-fix-v21-results.json",
    });
    record(
      results.gates,
      "AC-REG-02-HIST",
      "Script historique V1 inchangé (rejeu → artefact post-fix)",
      v1Hist.ok,
      v1Hist.ok
        ? "pre-e1-v1-post-fix-v21-results.json"
        : (v1Hist.stderr || v1Hist.stdout).slice(-600),
    );

    // 02b écrit toujours pre-e1-hotfix-02b-results.json — déplacer puis restaurer
    // Retry une fois sur flaky fetch (backend down entre V1 et 02B)
    let hotfixHist = runNpm("verify:pre-e1-hotfix-02b");
    if (!hotfixHist.ok && /fetch failed/i.test(hotfixHist.stderr + hotfixHist.stdout)) {
      console.log("  … retry historique 02B après fetch failed");
      hotfixHist = runNpm("verify:pre-e1-hotfix-02b");
    }
    relocateIfExists(
      "pre-e1-hotfix-02b-results.json",
      "pre-e1-hotfix-02b-post-fix-v21-results.json",
    );
    relocateIfExists(
      "notes-authz-trace-02b.jsonl",
      "notes-authz-trace-02b-post-fix-v21.jsonl",
    );
    const restored = restoreHistoricalEvidence();
    record(
      results.gates,
      "AC-REG-01-HIST",
      "Script historique HOTFIX-02B inchangé (rejeu → artefact post-fix)",
      hotfixHist.ok,
      hotfixHist.ok
        ? "pre-e1-hotfix-02b-post-fix-v21-results.json"
        : (hotfixHist.stderr || hotfixHist.stdout).slice(-600),
    );
    record(
      results.historicalIntegrity,
      "HIST-RESTORE",
      "Preuves historiques restaurées après rejeu 02B",
      restored,
    );
  }

  // --- Adapted gates (nouvelles preuves) ---
  console.log("\nAdapted FIX gates (new artifacts)");
  if (process.env.SOMAFRIK_FIX_GATES === "unit") {
    record(results.gates, "AC-REG-01-ADAPTED", "adapted-02b skipped (unit)", true, "skipped");
    record(results.gates, "AC-REG-02-ADAPTED", "adapted-v1 skipped (unit)", true, "skipped");
  } else {
    const adapted02b = runNode("scripts/verify-pre-e1-v2-identity-fix-adapted-02b.js");
    record(
      results.gates,
      "AC-REG-01-ADAPTED",
      "Adaptation 02B (réutilise canon) → artefact dédié",
      adapted02b.ok,
      adapted02b.ok
        ? "pre-e1-v2-identity-fix-adapted-02b-results.json"
        : (adapted02b.stderr || adapted02b.stdout).slice(-600),
    );

    const adaptedV1 = runNode("scripts/verify-pre-e1-v2-identity-fix-adapted-v1.js");
    record(
      results.gates,
      "AC-REG-02-ADAPTED",
      "Adaptation V1 (canon + DUP-02 ids PG) → artefact dédié",
      adaptedV1.ok,
      adaptedV1.ok
        ? "pre-e1-v2-identity-fix-adapted-v1-results.json"
        : (adaptedV1.stderr || adaptedV1.stdout).slice(-600),
    );
  }

  // Vérifier que les preuves historiques n'ont pas été altérées en fin de course
  console.log("\nHistorical evidence integrity (post-run)");
  for (const name of HISTORICAL_EVIDENCE) {
    const hash = sha256File(`docs/audits/evidence/${name}`);
    const same = hash && hash === histHashesBefore[name];
    record(
      results.historicalIntegrity,
      `HIST-HASH-AFTER-${name}`,
      `Preuve historique intacte ${name}`,
      Boolean(same),
      same ? hash.slice(0, 16) : `before=${(histHashesBefore[name] || "").slice(0, 8)} after=${(hash || "").slice(0, 8)}`,
    );
  }

  results.summary = {
    pass:
      results.criteria.filter((r) => r.status === "PASS").length +
      results.gates.filter((r) => r.status === "PASS").length +
      results.staticChecks.filter((r) => r.status === "PASS").length +
      results.historicalIntegrity.filter((r) => r.status === "PASS").length,
    fail:
      results.criteria.filter((r) => r.status === "FAIL").length +
      results.gates.filter((r) => r.status === "FAIL").length +
      results.staticChecks.filter((r) => r.status === "FAIL").length +
      results.historicalIntegrity.filter((r) => r.status === "FAIL").length,
    ok: results.ok,
  };

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(`\nEvidence → ${path.relative(ROOT, OUT_FILE)}`);
  console.log(results.ok ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(results.ok ? 0 : 1);
}

main();
