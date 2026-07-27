/**
 * Rejeu POST-MERGE develop — FIX V2.1 IDENTITY
 *
 *   node scripts/verify-pre-e1-v2-identity-post-merge-develop.js
 *
 * Prérequis : develop contient le merge #99 (head validé 0b1131ec).
 * Ne réécrit PAS les preuves historiques V1 / HOTFIX-02B.
 * Produit : docs/audits/evidence/pre-e1-v2-identity-fix-post-merge-develop-results.json
 *           + artefacts *-post-merge-develop-*
 *
 * Clôture technique V2.1 : NON déclarée ici — soumise à décision CTO.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const EVIDENCE_DIR = path.join(ROOT, "docs", "audits", "evidence");
const OUT_FILE = path.join(
  EVIDENCE_DIR,
  "pre-e1-v2-identity-fix-post-merge-develop-results.json",
);

const HISTORICAL_EVIDENCE = [
  "pre-e1-v1-rerun-hotfix-pre-e1-02-results.json",
  "pre-e1-hotfix-02b-results.json",
  "notes-authz-trace-02b.jsonl",
];

const results = {
  audit: "PRE-E1",
  phase: "V2.1-FIX-POST-MERGE",
  subject: "PRE-E1-IDENTITY-LIFECYCLE-FIX",
  developMergeCommit: null,
  validatedHead: "0b1131ec23103e1fa8be4f3f47467812f76bded8",
  generatedAt: new Date().toISOString(),
  nature: "post-merge-replay-on-develop",
  closure: "NOT_DECLARED — pending CTO decision",
  gates: [],
  historicalIntegrity: [],
  ok: true,
};

function record(bucket, id, title, pass, detail = null) {
  const row = {
    id,
    title,
    status: pass ? "PASS" : "FAIL",
    detail: detail == null ? null : String(detail),
  };
  bucket.push(row);
  if (!pass) results.ok = false;
  console.log(`  ${pass ? "✓" : "✗"} [${id}] ${title}${detail ? ` — ${detail}` : ""}`);
  return row;
}

function sha(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

function run(cmd, args, env = {}) {
  const proc = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: cmd === "npm",
  });
  return {
    ok: proc.status === 0,
    status: proc.status,
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
  };
}

function restoreHistorical() {
  return (
    spawnSync(
      "git",
      ["checkout", "HEAD", "--", ...HISTORICAL_EVIDENCE.map((f) => `docs/audits/evidence/${f}`)],
      { cwd: ROOT, encoding: "utf8" },
    ).status === 0
  );
}

function relocate(fromName, toName) {
  const from = path.join(EVIDENCE_DIR, fromName);
  const to = path.join(EVIDENCE_DIR, toName);
  if (!fs.existsSync(from)) return false;
  fs.renameSync(from, to);
  return true;
}

function main() {
  console.log("=== FIX V2.1 IDENTITY — rejeu POST-MERGE develop ===\n");

  const head = run("git", ["rev-parse", "HEAD"]);
  results.developMergeCommit = String(head.stdout).trim();
  const ancestor = run("git", ["merge-base", "--is-ancestor", results.validatedHead, "HEAD"]);
  record(
    results.gates,
    "POST-MERGE-01",
    "develop contient le head validé 0b1131ec",
    ancestor.status === 0,
    `HEAD=${results.developMergeCommit}`,
  );

  const hashesBefore = Object.fromEntries(
    HISTORICAL_EVIDENCE.map((name) => [name, sha(`docs/audits/evidence/${name}`)]),
  );

  console.log("Units");
  const units = run(process.execPath, ["backend/services/userTeacherSyncService.test.js"]);
  const evalUnit = run(process.execPath, ["backend/lib/evaluationAttachment.test.js"]);
  record(results.gates, "UNIT-SYNC", "userTeacherSyncService.test.js", units.ok);
  record(results.gates, "UNIT-EVAL", "evaluationAttachment.test.js", evalUnit.ok);

  console.log("\nHistorical V1 (artifact post-merge)");
  const v1 = run("npm", ["run", "verify:pre-e1-v1"], {
    SOMAFRIK_PRE_E1_EVIDENCE_FILE: "pre-e1-v1-post-merge-develop-results.json",
  });
  record(
    results.gates,
    "HIST-V1",
    "verify:pre-e1-v1 (script historique) → post-merge artifact",
    v1.ok,
    v1.ok ? "pre-e1-v1-post-merge-develop-results.json" : (v1.stderr || v1.stdout).slice(-500),
  );

  console.log("\nHistorical HOTFIX-02B (artifact post-merge)");
  let hf = run("npm", ["run", "verify:pre-e1-hotfix-02b"]);
  if (!hf.ok && /fetch failed/i.test(hf.stderr + hf.stdout)) {
    console.log("  … retry 02B after fetch failed");
    hf = run("npm", ["run", "verify:pre-e1-hotfix-02b"]);
  }
  relocate("pre-e1-hotfix-02b-results.json", "pre-e1-hotfix-02b-post-merge-develop-results.json");
  relocate("notes-authz-trace-02b.jsonl", "notes-authz-trace-02b-post-merge-develop.jsonl");
  const restored = restoreHistorical();
  record(
    results.gates,
    "HIST-02B",
    "verify:pre-e1-hotfix-02b (script historique) → post-merge artifact",
    hf.ok,
    hf.ok
      ? "pre-e1-hotfix-02b-post-merge-develop-results.json"
      : (hf.stderr || hf.stdout).slice(-500),
  );
  record(results.historicalIntegrity, "HIST-RESTORE", "Preuves historiques restaurées", restored);

  console.log("\nAdapted FIX gates (copy → post-merge names)");
  const a02b = run(process.execPath, ["scripts/verify-pre-e1-v2-identity-fix-adapted-02b.js"]);
  const aV1 = run(process.execPath, ["scripts/verify-pre-e1-v2-identity-fix-adapted-v1.js"]);
  // Copier les artefacts adapted vers des noms post-merge dédiés (sans écraser l'historique)
  for (const [src, dest] of [
    [
      "pre-e1-v2-identity-fix-adapted-02b-results.json",
      "pre-e1-v2-identity-fix-adapted-02b-post-merge-develop-results.json",
    ],
    [
      "pre-e1-v2-identity-fix-adapted-v1-results.json",
      "pre-e1-v2-identity-fix-adapted-v1-post-merge-develop-results.json",
    ],
    [
      "notes-authz-trace-v2-identity-fix-adapted-02b.jsonl",
      "notes-authz-trace-v2-identity-fix-adapted-02b-post-merge-develop.jsonl",
    ],
  ]) {
    const from = path.join(EVIDENCE_DIR, src);
    const to = path.join(EVIDENCE_DIR, dest);
    if (fs.existsSync(from)) fs.copyFileSync(from, to);
  }
  record(
    results.gates,
    "ADAPTED-02B",
    "verify adapted-02b post-merge",
    a02b.ok,
    a02b.ok
      ? "pre-e1-v2-identity-fix-adapted-02b-post-merge-develop-results.json"
      : (a02b.stderr || a02b.stdout).slice(-500),
  );
  record(
    results.gates,
    "ADAPTED-V1",
    "verify adapted-v1 post-merge",
    aV1.ok,
    aV1.ok
      ? "pre-e1-v2-identity-fix-adapted-v1-post-merge-develop-results.json"
      : (aV1.stderr || aV1.stdout).slice(-500),
  );

  console.log("\nHistorical integrity");
  for (const name of HISTORICAL_EVIDENCE) {
    const after = sha(`docs/audits/evidence/${name}`);
    const same = after && after === hashesBefore[name];
    record(
      results.historicalIntegrity,
      `HIST-INTACT-${name}`,
      `Preuve historique intacte ${name}`,
      Boolean(same),
      same ? after.slice(0, 16) : `drift before=${(hashesBefore[name] || "").slice(0, 8)}`,
    );
  }

  results.summary = {
    pass: [...results.gates, ...results.historicalIntegrity].filter((r) => r.status === "PASS")
      .length,
    fail: [...results.gates, ...results.historicalIntegrity].filter((r) => r.status === "FAIL")
      .length,
    ok: results.ok,
  };

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\nEvidence → ${path.relative(ROOT, OUT_FILE)}`);
  console.log(results.ok ? "RESULT: PASS (closure still pending CTO)" : "RESULT: FAIL");
  process.exit(results.ok ? 0 : 1);
}

main();
