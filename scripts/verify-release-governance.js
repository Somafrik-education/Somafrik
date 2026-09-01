"use strict";

/**
 * Gate Lot G — release governance. Evidence only.
 * Ne merge pas main. Ne déploie pas. N'ouvre pas develop→main.
 *
 * Contrat contrôle B :
 * 1. PR gouvernance-only → PASS
 * 2. PR métier sans autorisation exacte → FAIL CLOSED
 * 3. PR métier PASS seulement si PR + (HEAD exact OU identité de contenu) +
 *    égalité stricte d'ensemble des fichiers + decision CTO_GO
 *
 * L'identité de contenu (diffSha256) est un hash SHA-256 des blobs avant/après
 * au merge-base…HEAD, pas un hash de `git diff` (indépendant du merge commit GitHub).
 * Après merge de cette PR de gouvernance, un rebase de #447 qui conserve les
 * mêmes blobs métier produit le même diffSha256 → GO conservé sans réémettre headSha.
 * Toute modification de contenu annule le GO.
 */

const assert = require("node:assert/strict");
const { execFileSync, execSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = "78228be06286b464afd9e691fb227d16be95a63a";
const EXPECTED_MAIN = "b5074565b08472217702d8ff848f5a398d08831c";
const MAIN_ONLY = [
  "6ff6110643d4cfdd349162d66b6dd590daf4c902",
  "b5074565b08472217702d8ff848f5a398d08831c",
];
const FROZEN = ["295", "297", "298", "312", "337", "354", "355"];
const MAIN_SNAPSHOT_ON_DEVELOP = "878e4ab82e2fd91a9e419dd63d2b4d2ad6eb5b6b";
const CANDIDATES_REL = "docs/audits/release-approved-candidates-2026-09-01.json";
const WORKFLOW_REL = ".github/workflows/release-governance.yml";
/**
 * Migration bootstrap one-shot #451 : le YAML n'est PAS dans l'allowlist B.
 * Seule la PR #451 (ou un checkout local sans numéro) peut le porter, et
 * uniquement si le contenu SHA-256 est exactement ce pin (ajout du manifeste
 * aux paths:). Toute autre modification du workflow → FAIL CLOSED.
 */
const BOOTSTRAP_WORKFLOW_PR = 451;
const BOOTSTRAP_WORKFLOW_SHA256 =
  "ee5886ae55848257da713f6f71740e7c78aa4ff14613129cfb44b141e1f9e321";
/** Seuls ces chemins peuvent apparaître sur origin/develop après le baseline sans revalidation métier. */
const GOVERNANCE_ONLY_PATHS = new Set([
  "scripts/verify-release-governance.js",
  "docs/audits/release-governance-goprod-2026-09-01.md",
  "docs/audits/release-checklist-goprod-2026-09-01.md",
  CANDIDATES_REL,
]);

const APPROVED_447_HEAD = "6b4370e4879d399f668463ef3e8cf3fe385e31ab";
const APPROVED_447_BASE = "1f5fc0d6594b45434a216ae461df99fd97bec86c";
const APPROVED_447_HASH = "5e704e7bd40233d1f70c6707f23d805e07c4bc8d8ae76902ab2ce7da7f1422e8";
const APPROVED_447_FILES = [
  "Mobile/app.json",
  "Mobile/assets/somafrik-android-adaptive-foreground.png",
  "Mobile/assets/somafrik-app-icon.png",
  "Mobile/package.json",
  "Mobile/scripts/generate-launcher-icons.py",
  "Mobile/scripts/verify-mobile-branding.js",
  "Mobile/scripts/verify-mobile-release-readiness.js",
  "scripts/verify-android-release-readiness.js",
];

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

function gitSha() {
  try {
    return sh("git rev-parse HEAD");
  } catch {
    return process.env.GITHUB_SHA || "unknown";
  }
}

function isAncestor(ancestor, tip = "HEAD") {
  try {
    execSync(`git merge-base --is-ancestor ${ancestor} ${tip}`, { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function commitExists(sha) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pullRequestBaseSha() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(eventPath, "utf8")).pull_request?.base?.sha || null;
  } catch {
    return null;
  }
}

function assertBaseline(sha) {
  if (isAncestor(BASELINE)) return;
  if (process.env.SOMAFRIK_RELEASE_GOV_ALLOW_OTHER_SHA === "1") return;
  const prBase = pullRequestBaseSha();
  if (prBase === BASELINE) {
    console.log(`CI merge checkout ${sha}; pull_request.base.sha=${prBase} = baseline`);
    return;
  }
  assert.ok(false, `HEAD ${sha} sans ancêtre obligatoire ${BASELINE}`);
}

function refSha(ref) {
  try {
    return sh(`git rev-parse ${ref}`);
  } catch {
    return null;
  }
}

function listChangedFiles(fromSha, toSha) {
  if (!fromSha || !toSha || fromSha === toSha) return [];
  const out = sh(`git diff --name-only ${fromSha}..${toSha}`);
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

function listChangedFilesThreeDot(baseSha, headSha) {
  if (!baseSha || !headSha || baseSha === headSha) return [];
  const out = sh(`git diff --name-only ${baseSha}...${headSha}`);
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

function extraDevelopFiles(changedFiles) {
  return [...new Set(changedFiles || [])].filter((file) => !GOVERNANCE_ONLY_PATHS.has(file));
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function workingTreeSha256(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return "ABSENT";
  return sha256Buffer(fs.readFileSync(abs));
}

function resolveWorkflowSha256(tipSha) {
  if (tipSha) {
    const fromGit = gitBlobSha256(tipSha, WORKFLOW_REL);
    if (fromGit !== "ABSENT") return fromGit;
  }
  return workingTreeSha256(WORKFLOW_REL);
}

/**
 * Exception bootstrap #451 — contenu exact du YAML, pas une allowlist permanente.
 * En CI, le numéro de PR doit être 451. En local / contrôle A (numéro absent),
 * le pin de contenu suffit (nécessaire pour npm run et le drift develop post-merge).
 */
function isBootstrapWorkflowAllowed({ tipSha, prNumber, workflowSha256 } = {}) {
  if (prNumber != null && prNumber !== BOOTSTRAP_WORKFLOW_PR) return false;
  const hash = workflowSha256 || resolveWorkflowSha256(tipSha);
  return hash === BOOTSTRAP_WORKFLOW_SHA256;
}

function extraAfterBootstrap(changedFiles, bootstrapCtx) {
  return extraDevelopFiles(changedFiles).filter((file) => {
    if (file !== WORKFLOW_REL) return true;
    return !isBootstrapWorkflowAllowed(bootstrapCtx);
  });
}

function readPullRequestEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    const pr = event.pull_request;
    if (!pr) return null;
    return {
      number: Number.isInteger(pr.number) ? pr.number : null,
      base: pr.base?.sha || null,
      head: pr.head?.sha || null,
    };
  } catch {
    return null;
  }
}

function resolvePrRange(originDevelop) {
  const fromEvent = readPullRequestEvent();
  if (fromEvent?.base && fromEvent?.head) {
    return {
      number: fromEvent.number,
      base: fromEvent.base,
      head: fromEvent.head,
      source: "pull_request",
    };
  }
  if (originDevelop) {
    return {
      number: null,
      base: originDevelop,
      head: gitSha(),
      source: "local-origin-develop",
    };
  }
  return null;
}

function assertExactAuthPath(filePath) {
  if (
    typeof filePath !== "string" ||
    !filePath ||
    filePath.includes("*") ||
    filePath.includes("?") ||
    filePath.includes("..") ||
    filePath.startsWith("/") ||
    filePath.endsWith("/")
  ) {
    throw new Error(`chemin d'autorisation invalide ou wildcard interdit: ${filePath}`);
  }
}

function loadApprovedCandidates() {
  const abs = path.join(ROOT, CANDIDATES_REL);
  if (!fs.existsSync(abs)) {
    throw new Error(`manifeste d'autorisation absent: ${CANDIDATES_REL}. FAIL CLOSED.`);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    throw new Error(`manifeste d'autorisation illisible: ${CANDIDATES_REL}. FAIL CLOSED.`);
  }
  if (!data || !Array.isArray(data.candidates)) {
    throw new Error("manifeste: candidates[] obligatoire. FAIL CLOSED.");
  }
  const seen = new Set();
  return data.candidates.map((candidate, index) => {
    if (!Number.isInteger(candidate.pr) || candidate.pr <= 0) {
      throw new Error(`candidates[${index}].pr invalide`);
    }
    if (seen.has(candidate.pr)) {
      throw new Error(`candidates: PR #${candidate.pr} dupliquée`);
    }
    seen.add(candidate.pr);
    if (!/^[0-9a-f]{40}$/.test(candidate.headSha || "")) {
      throw new Error(`candidates[${index}].headSha invalide`);
    }
    if (candidate.baseSha && !/^[0-9a-f]{40}$/.test(candidate.baseSha)) {
      throw new Error(`candidates[${index}].baseSha invalide`);
    }
    if (!/^[0-9a-f]{64}$/.test(candidate.diffSha256 || "")) {
      throw new Error(`candidates[${index}].diffSha256 invalide`);
    }
    if (!Array.isArray(candidate.files) || candidate.files.length === 0) {
      throw new Error(`candidates[${index}].files vide`);
    }
    for (const file of candidate.files) assertExactAuthPath(file);
    if (candidate.files.length !== new Set(candidate.files).size) {
      throw new Error(`candidates[${index}].files dupliqués`);
    }
    if (typeof candidate.decision !== "string" || !candidate.decision) {
      throw new Error(`candidates[${index}].decision manquante`);
    }
    return {
      pr: candidate.pr,
      headSha: candidate.headSha,
      baseSha: candidate.baseSha || null,
      files: [...candidate.files],
      diffSha256: candidate.diffSha256,
      decision: candidate.decision,
    };
  });
}

function gitBlobSha256(rev, file) {
  const spec = `${rev}:${file}`;
  try {
    execFileSync("git", ["cat-file", "-e", spec], { cwd: ROOT, stdio: "ignore" });
  } catch {
    return "ABSENT";
  }
  const buf = execFileSync("git", ["cat-file", "blob", spec], {
    cwd: ROOT,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Identité de contenu stable (anti-boucle rebase) :
 * pour chaque chemin trié : path + TAB + sha256(blob merge-base) + TAB + sha256(blob HEAD)
 * puis SHA-256 UTF-8 de ces lignes jointes par \\n (pas de newline final).
 * Indépendant du SHA de commit et du merge commit GitHub.
 */
function computeContentIdentitySha256(baseSha, headSha, files) {
  const mergeBaseSha = sh(`git merge-base ${baseSha} ${headSha}`);
  const sorted = [...new Set(files)].sort();
  const lines = sorted.map((file) => {
    const before = gitBlobSha256(mergeBaseSha, file);
    const after = gitBlobSha256(headSha, file);
    return `${file}\t${before}\t${after}`;
  });
  return crypto.createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

/**
 * Autorisation métier : PR + égalité stricte des fichiers + (HEAD exact et hash
 * OU hash seul après rebase). Le numéro de PR ne suffit jamais.
 */
function assertApprovedBusinessPr({ pr, headSha, files, diffSha256 }) {
  if (!Number.isInteger(pr) || pr <= 0) {
    throw new Error("RG-NEG-pr-number-alone-insufficient: numéro de PR invalide. FAIL CLOSED.");
  }
  if (!/^[0-9a-f]{40}$/.test(headSha || "")) {
    throw new Error("RG-NEG-pr-number-alone-insufficient: headSha invalide. FAIL CLOSED.");
  }
  const matches = loadApprovedCandidates().filter((candidate) => candidate.pr === pr);
  if (matches.length === 0) {
    throw new Error(
      `RG-NEG-unapproved-business-pr: PR #${pr} n'a aucune autorisation CTO_GO versionnée. FAIL CLOSED.`,
    );
  }
  if (matches.length !== 1) {
    throw new Error(`autorisation ambiguë pour PR #${pr} (${matches.length} entrées). FAIL CLOSED.`);
  }
  const candidate = matches[0];
  if (candidate.decision !== "CTO_GO") {
    throw new Error(`PR #${pr} décision=${candidate.decision} ≠ CTO_GO. FAIL CLOSED.`);
  }
  const expected = new Set(candidate.files);
  const actual = new Set(files);
  const extra = [...actual].filter((file) => !expected.has(file));
  const missing = [...expected].filter((file) => !actual.has(file));
  if (extra.length || missing.length) {
    const parts = [];
    if (extra.length) parts.push(`RG-NEG-approved-pr-extra-file: ${extra.join(", ")}`);
    if (missing.length) parts.push(`RG-NEG-approved-pr-missing-file: ${missing.join(", ")}`);
    throw new Error(`${parts.join(" ; ")}. FAIL CLOSED.`);
  }
  const headMatches = candidate.headSha === headSha;
  const identityMatches = candidate.diffSha256 === diffSha256;
  if (headMatches && identityMatches) return "exact-head";
  if (!headMatches && identityMatches) return "rebase-equivalent";
  if (headMatches && !identityMatches) {
    throw new Error(
      `PR #${pr} HEAD=${headSha} correspond au manifeste mais diffSha256 divergé ` +
        `(attendu ${candidate.diffSha256}, obtenu ${diffSha256}). FAIL CLOSED.`,
    );
  }
  throw new Error(
    `RG-NEG-approved-pr-head-mismatch RG-NEG-pr-number-alone-insufficient: ` +
      `PR #${pr} HEAD=${headSha} ≠ ${candidate.headSha} et ` +
      `diffSha256=${diffSha256} ≠ ${candidate.diffSha256}. ` +
      `Le numéro de PR seul ne suffit pas. FAIL CLOSED.`,
  );
}

function assertCurrentPrAllowed(prNumber, baseSha, headSha, changedFiles, bootstrapOverrides) {
  const extra = extraDevelopFiles(changedFiles);
  const extraAfter = extraAfterBootstrap(changedFiles, {
    tipSha: headSha,
    prNumber,
    ...bootstrapOverrides,
  });
  if (extraAfter.length === 0) {
    return extra.includes(WORKFLOW_REL) ? "governance-bootstrap-451" : "governance-only";
  }
  if (extraAfter.includes(WORKFLOW_REL)) {
    assert.ok(
      false,
      `RG-NEG-workflow-not-governance-only: ${WORKFLOW_REL} hors allowlist. ` +
        `Exception bootstrap uniquement PR #${BOOTSTRAP_WORKFLOW_PR} + contenu YAML exact ` +
        `(sha256=${BOOTSTRAP_WORKFLOW_SHA256}). FAIL CLOSED.`,
    );
  }
  if (prNumber == null || !Number.isInteger(prNumber)) {
    assert.ok(
      false,
      `RG-NEG-unapproved-business-pr: PR fonctionnelle sans numéro GitHub. ` +
        `Fichiers métier: ${extraAfter.join(", ")}. FAIL CLOSED.`,
    );
  }
  const identity = computeContentIdentitySha256(baseSha, headSha, changedFiles);
  assertApprovedBusinessPr({
    pr: prNumber,
    headSha,
    files: changedFiles,
    diffSha256: identity,
  });
  return "approved-candidate";
}

/**
 * Freeze strict du tip métier, avec exception gouvernance-only :
 * origin/develop === baseline → PASS
 * sinon git diff --name-only baseline..origin/develop ⊆ GOVERNANCE_ONLY_PATHS → PASS
 * tout autre fichier → FAIL (revalidation métier obligatoire)
 */
function assertDevelopFrozen(originDevelop, baseline, changedFiles, bootstrapCtx) {
  if (!originDevelop) {
    throw new Error("origin/develop absent — git fetch origin develop requis");
  }
  if (originDevelop === baseline) return;
  const extra = bootstrapCtx
    ? extraAfterBootstrap(changedFiles, bootstrapCtx)
    : extraDevelopFiles(changedFiles);
  assert.equal(
    extra.length,
    0,
    `origin/develop a avancé fonctionnellement (${originDevelop}). ` +
      `Fichiers hors gouvernance: ${extra.join(", ") || "(diff vide non listé)"}. ` +
      `STOP : rebase/revalidation (baseline ${baseline}).`,
  );
}

function assertCurrentPrGovernanceOnly(changedFiles) {
  const extra = extraDevelopFiles(changedFiles);
  assert.equal(
    extra.length,
    0,
    `PR courante a avancé fonctionnellement. ` +
      `Fichiers hors gouvernance: ${extra.join(", ") || "(diff vide non listé)"}. ` +
      `FAIL avant merge.`,
  );
}

function frozenSubjectRe(n) {
  return new RegExp(`(?:Merge pull request #${n}\\b|\\(#${n}\\))`);
}

function assertFrozenAbsentFromLog(subjects, n) {
  assert.doesNotMatch(subjects, frozenSubjectRe(n), `PR frozen #${n} citée en sujet git (merge/squash)`);
}

function runNegativeUnitTests() {
  const moved = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  const governanceOnly = [...GOVERNANCE_ONLY_PATHS];
  assert.throws(
    () => assertDevelopFrozen(moved, BASELINE, ["Mobile/app.json"]),
    /avancé fonctionnellement[\s\S]*Mobile\/app\.json/,
    "RG-NEG-business-change-forbidden",
  );
  assert.throws(
    () => assertDevelopFrozen(moved, BASELINE, [
      ...governanceOnly,
      "Mobile/package.json",
    ]),
    /Mobile\/package\.json/,
    "RG-NEG-business-change-forbidden-with-governance",
  );
  assert.throws(
    () => assertDevelopFrozen(moved, BASELINE, [
      ...governanceOnly,
      ".github/workflows/release-governance.yml",
    ]),
    /release-governance\.yml/,
    "RG-NEG-workflow-not-governance-only",
  );
  assertDevelopFrozen(moved, BASELINE, governanceOnly);
  assertDevelopFrozen(BASELINE, BASELINE, ["Mobile/app.json"]);
  assert.throws(
    () => assertCurrentPrGovernanceOnly(["Mobile/app.json"]),
    /PR courante[\s\S]*Mobile\/app\.json/,
    "RG-NEG-current-pr-business-change-forbidden",
  );
  assertCurrentPrGovernanceOnly(governanceOnly);
  assert.match("Merge pull request #297 from x", frozenSubjectRe("297"));
  assert.match("fix(seed): identités (#297)", frozenSubjectRe("297"));
  assert.doesNotMatch("fix(seed): identités (#1297)", frozenSubjectRe("297"));
  assert.doesNotMatch("docs: voir PR 297", frozenSubjectRe("297"));
  console.log("PASS RG-NEG-business-change-forbidden");
  console.log("PASS RG-POS-governance-only-merge");
  console.log("PASS RG-NEG-current-pr-business-change-forbidden");
  console.log("PASS RG-NEG-workflow-not-governance-only");
  console.log("PASS RG-NEG-frozen-squash-subject");

  assert.equal(GOVERNANCE_ONLY_PATHS.has(WORKFLOW_REL), false, "YAML hors allowlist B");
  assert.equal(
    isBootstrapWorkflowAllowed({ prNumber: 451, workflowSha256: BOOTSTRAP_WORKFLOW_SHA256 }),
    true,
    "RG-POS-workflow-bootstrap-451",
  );
  assert.equal(
    extraAfterBootstrap([...governanceOnly, WORKFLOW_REL], {
      prNumber: 451,
      workflowSha256: BOOTSTRAP_WORKFLOW_SHA256,
    }).length,
    0,
  );
  assert.equal(
    assertCurrentPrAllowed(451, BASELINE, BASELINE, [...governanceOnly, WORKFLOW_REL], {
      workflowSha256: BOOTSTRAP_WORKFLOW_SHA256,
    }),
    "governance-bootstrap-451",
    "RG-POS-workflow-bootstrap-451",
  );
  console.log("PASS RG-POS-workflow-bootstrap-451");

  assert.equal(
    isBootstrapWorkflowAllowed({ prNumber: 999, workflowSha256: BOOTSTRAP_WORKFLOW_SHA256 }),
    false,
  );
  assert.throws(
    () => assertCurrentPrAllowed(999, BASELINE, BASELINE, [...governanceOnly, WORKFLOW_REL]),
    /RG-NEG-workflow-not-governance-only/,
    "RG-NEG-workflow-bootstrap-wrong-pr",
  );
  console.log("PASS RG-NEG-workflow-bootstrap-wrong-pr");

  const wrongYamlHash = "ff".repeat(32);
  assert.equal(
    isBootstrapWorkflowAllowed({ prNumber: 451, workflowSha256: wrongYamlHash }),
    false,
  );
  assert.deepEqual(
    extraAfterBootstrap([...governanceOnly, WORKFLOW_REL], {
      prNumber: 451,
      workflowSha256: wrongYamlHash,
    }),
    [WORKFLOW_REL],
  );
  assert.throws(
    () => assertDevelopFrozen(moved, BASELINE, [...governanceOnly, WORKFLOW_REL], {
      prNumber: null,
      workflowSha256: wrongYamlHash,
    }),
    /release-governance\.yml/,
    "RG-NEG-workflow-arbitrary-change-forbidden",
  );
  assertDevelopFrozen(moved, BASELINE, [...governanceOnly, WORKFLOW_REL], {
    prNumber: null,
    workflowSha256: BOOTSTRAP_WORKFLOW_SHA256,
  });
  console.log("PASS RG-NEG-workflow-arbitrary-change-forbidden");
}

function runApprovedCandidateTests() {
  const otherHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const otherHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const candidates = loadApprovedCandidates();
  const approved447 = candidates.find((candidate) => candidate.pr === 447);
  assert.ok(approved447, "manifeste doit contenir PR #447");
  assert.equal(approved447.headSha, APPROVED_447_HEAD);
  assert.equal(approved447.diffSha256, APPROVED_447_HASH);
  assert.equal(approved447.decision, "CTO_GO");
  assert.deepEqual(approved447.files, APPROVED_447_FILES);

  assert.equal(
    assertApprovedBusinessPr({
      pr: 447,
      headSha: APPROVED_447_HEAD,
      files: APPROVED_447_FILES,
      diffSha256: APPROVED_447_HASH,
    }),
    "exact-head",
    "RG-POS-approved-current-pr",
  );
  console.log("PASS RG-POS-approved-current-pr");

  assert.equal(
    assertApprovedBusinessPr({
      pr: 447,
      headSha: otherHead,
      files: APPROVED_447_FILES,
      diffSha256: APPROVED_447_HASH,
    }),
    "rebase-equivalent",
    "RG-POS-approved-pr-rebase-equivalent",
  );
  console.log("PASS RG-POS-approved-pr-rebase-equivalent");

  assert.throws(
    () => assertApprovedBusinessPr({
      pr: 447,
      headSha: otherHead,
      files: APPROVED_447_FILES,
      diffSha256: otherHash,
    }),
    /RG-NEG-approved-pr-head-mismatch/,
    "RG-NEG-approved-pr-head-mismatch",
  );
  console.log("PASS RG-NEG-approved-pr-head-mismatch");

  assert.throws(
    () => assertApprovedBusinessPr({
      pr: 447,
      headSha: APPROVED_447_HEAD,
      files: [...APPROVED_447_FILES, "backend/server.js"],
      diffSha256: APPROVED_447_HASH,
    }),
    /RG-NEG-approved-pr-extra-file[\s\S]*backend\/server\.js/,
    "RG-NEG-approved-pr-extra-file",
  );
  console.log("PASS RG-NEG-approved-pr-extra-file");

  assert.throws(
    () => assertApprovedBusinessPr({
      pr: 447,
      headSha: APPROVED_447_HEAD,
      files: APPROVED_447_FILES.slice(0, 7),
      diffSha256: APPROVED_447_HASH,
    }),
    /RG-NEG-approved-pr-missing-file/,
    "RG-NEG-approved-pr-missing-file",
  );
  console.log("PASS RG-NEG-approved-pr-missing-file");

  assert.throws(
    () => assertApprovedBusinessPr({
      pr: 999,
      headSha: APPROVED_447_HEAD,
      files: APPROVED_447_FILES,
      diffSha256: APPROVED_447_HASH,
    }),
    /RG-NEG-unapproved-business-pr/,
    "RG-NEG-unapproved-business-pr",
  );
  console.log("PASS RG-NEG-unapproved-business-pr");

  assert.throws(
    () => assertApprovedBusinessPr({
      pr: 447,
      headSha: otherHead,
      files: APPROVED_447_FILES,
      diffSha256: otherHash,
    }),
    /RG-NEG-pr-number-alone-insufficient/,
    "RG-NEG-pr-number-alone-insufficient",
  );
  console.log("PASS RG-NEG-pr-number-alone-insufficient");

  if (commitExists(APPROVED_447_HEAD) && commitExists(APPROVED_447_BASE)) {
    const liveHash = computeContentIdentitySha256(
      APPROVED_447_BASE,
      APPROVED_447_HEAD,
      APPROVED_447_FILES,
    );
    assert.equal(liveHash, APPROVED_447_HASH, "diffSha256 live #447");
    assert.equal(
      assertCurrentPrAllowed(447, APPROVED_447_BASE, APPROVED_447_HEAD, APPROVED_447_FILES),
      "approved-candidate",
    );
    console.log("PASS RG-POS-approved-current-pr (live identity 1f5fc0d6...6b4370e4)");
  } else {
    console.log("SKIP live #447 identity (commits absents de ce clone)");
  }
}

function main() {
  if (process.env.SKIP_RELEASE_GOVERNANCE) {
    console.log("IGNORE SKIP_RELEASE_GOVERNANCE — aucun bypass env (fail-closed)");
  }

  const sha = gitSha();
  console.log(`Release governance SHA=${sha} baseline=${BASELINE}`);
  assertBaseline(sha);
  runNegativeUnitTests();
  runApprovedCandidateTests();

  const audit = fs.readFileSync(
    path.join(ROOT, "docs/audits/release-governance-goprod-2026-09-01.md"),
    "utf8",
  );
  const checklist = fs.readFileSync(
    path.join(ROOT, "docs/audits/release-checklist-goprod-2026-09-01.md"),
    "utf8",
  );
  assert.match(audit, /\*\*HOLD\*\*/);
  assert.match(audit, /pas `RELEASE_ENGINEERING_READY`/);
  assert.match(audit, new RegExp(EXPECTED_MAIN));
  assert.match(audit, new RegExp(BASELINE));
  assert.match(audit, /gouvernance-only/);
  assert.match(audit, /git diff --name-only BASELINE\.\.origin\/develop/);
  assert.match(audit, /pull_request\.base\.sha\.\.\.pull_request\.head\.sha/);
  assert.match(audit, /CTO_GO/);
  assert.match(audit, /diffSha256/);
  assert.match(audit, /rebase-equivalent/);
  assert.match(audit, /release-approved-candidates-2026-09-01\.json/);
  assert.match(audit, /bootstrap one-shot/);
  assert.match(checklist, /USER GO/);
  assert.match(checklist, /Aucun acte ci-dessous n’est exécuté/);
  assert.match(checklist, /eas submit/);
  assert.match(checklist, /candidat métier autorisé/);
  console.log("PASS RG-DOCS HOLD + checklist USER GO");

  const subjects = sh("git log --pretty=%s HEAD");
  for (const n of FROZEN) {
    assertFrozenAbsentFromLog(subjects, n);
    const prTip = refSha(`origin/pr-${n}`);
    if (prTip) {
      assert.ok(
        !isAncestor(prTip),
        `PR frozen #${n} tip ${prTip} est ancêtre de HEAD (merge/squash/cherry-pick)`,
      );
    } else {
      throw new Error(`origin/pr-${n} absent — git fetch origin pull/${n}/head requis`);
    }
  }
  console.log("PASS RG-FROZEN ancestry + sujets merge/squash (#295…#355)");

  const originMain = refSha("origin/main");
  const originDevelop = refSha("origin/develop");
  if (originMain) {
    assert.equal(
      originMain,
      EXPECTED_MAIN,
      `origin/main a bougé (${originMain}). STOP : reclasser les main-only.`,
    );
    const only = sh("git rev-list --reverse origin/develop..origin/main");
    const onlyList = only ? only.split(/\n/) : [];
    assert.deepEqual(onlyList, MAIN_ONLY, `main-only inattendu: ${only}`);
    assert.ok(isAncestor(MAIN_SNAPSHOT_ON_DEVELOP), "snapshot main 878e4ab8 doit rester ancêtre develop");
    console.log("PASS RG-MAIN-ONLY 2 commits stale (6ff61106, b5074565) ; tree #109 ⊂ develop");
  } else {
    throw new Error("origin/main absent — git fetch origin main requis");
  }

  const developChanged = listChangedFiles(BASELINE, originDevelop);
  assertDevelopFrozen(originDevelop, BASELINE, developChanged, {
    tipSha: originDevelop,
    prNumber: null,
  });
  if (originDevelop === BASELINE) {
    console.log(`PASS RG-DEVELOP-FROZEN origin/develop=${originDevelop} (égal baseline)`);
  } else {
    console.log(
      `PASS RG-DEVELOP-GOVERNANCE-ONLY origin/develop=${originDevelop} files=${developChanged.join(",") || "(none)"}`,
    );
  }

  const prRange = resolvePrRange(originDevelop);
  assert.ok(
    prRange?.base && prRange?.head,
    "impossible de résoudre pull_request.base/head (event GitHub ou origin/develop...HEAD)",
  );
  const prChanged = listChangedFilesThreeDot(prRange.base, prRange.head);
  const prMode = assertCurrentPrAllowed(prRange.number, prRange.base, prRange.head, prChanged);
  if (prMode === "governance-only") {
    console.log(
      `PASS RG-PR-GOVERNANCE-ONLY source=${prRange.source} ${prRange.base}...${prRange.head} ` +
        `files=${prChanged.join(",") || "(none)"}`,
    );
  } else if (prMode === "governance-bootstrap-451") {
    console.log(
      `PASS RG-POS-workflow-bootstrap-451 source=${prRange.source} pr=#${prRange.number} ` +
        `${prRange.base}...${prRange.head} files=${prChanged.join(",") || "(none)"}`,
    );
  } else {
    console.log(
      `PASS RG-POS-approved-current-pr source=${prRange.source} pr=#${prRange.number} ` +
        `${prRange.base}...${prRange.head} files=${prChanged.join(",") || "(none)"}`,
    );
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["verify:release-governance"], "node scripts/verify-release-governance.js");
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, "Mobile/app.json"), "utf8"));
  const mobilePkg = JSON.parse(fs.readFileSync(path.join(ROOT, "Mobile/package.json"), "utf8"));
  assert.equal(appJson.expo.version, "1.2.1");
  assert.equal(appJson.expo.android.versionCode, 13);
  if (mobilePkg.version !== appJson.expo.version) {
    console.log(`HOLD RG-VERSION-npm Mobile/package.json=${mobilePkg.version} ≠ app.json`);
  }
  console.log("PASS RG-VERSION app.json 1.2.1 / 13 (npm drift documenté)");

  const workflow = fs.readFileSync(
    path.join(ROOT, ".github/workflows/release-governance.yml"),
    "utf8",
  );
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /git fetch origin main/);
  assert.match(workflow, /pull\/\$n\/head/);
  assert.match(workflow, /Mobile\/app\.json/);
  assert.match(workflow, /Mobile\/package\.json/);
  assert.match(workflow, /release-approved-candidates-2026-09-01\.json/);
  assert.doesNotMatch(workflow, /eas submit/);
  assert.doesNotMatch(workflow, /SKIP_RELEASE_GOVERNANCE/);
  assert.equal(GOVERNANCE_ONLY_PATHS.has(WORKFLOW_REL), false);
  assert.equal(workingTreeSha256(WORKFLOW_REL), BOOTSTRAP_WORKFLOW_SHA256);
  assert.match(audit, /bootstrap one-shot/);
  console.log("PASS RG-CI workflow fetch main+develop+PR frozen ; paths manifeste + Mobile manifests");

  assert.match(audit, /Aucune PR `develop → main` ouverte/);
  console.log("PASS RG-NO-MAIN-PR (audit : forme proposée, PR non ouverte)");

  console.log("OK verify-release-governance — HOLD release ; audit versionné");
}

try {
  main();
} catch (error) {
  console.error(error.stack || error);
  process.exit(1);
}
