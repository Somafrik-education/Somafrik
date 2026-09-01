"use strict";

/**
 * Gate Lot G — release governance. Evidence only.
 * Ne merge pas main. Ne déploie pas. N'ouvre pas develop→main.
 */

const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
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
/** Seuls ces chemins peuvent apparaître sur origin/develop après le baseline sans revalidation métier. */
const GOVERNANCE_ONLY_PATHS = new Set([
  "scripts/verify-release-governance.js",
  "docs/audits/release-governance-goprod-2026-09-01.md",
  "docs/audits/release-checklist-goprod-2026-09-01.md",
]);

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

function readPullRequestRange() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    const base = event.pull_request?.base?.sha || null;
    const head = event.pull_request?.head?.sha || null;
    if (base && head) return { base, head, source: "pull_request" };
  } catch {
    return null;
  }
  return null;
}

function resolvePrRange(originDevelop) {
  const fromEvent = readPullRequestRange();
  if (fromEvent) return fromEvent;
  if (originDevelop) {
    return { base: originDevelop, head: gitSha(), source: "local-origin-develop" };
  }
  return null;
}

/**
 * Freeze strict du tip métier, avec exception gouvernance-only :
 * origin/develop === baseline → PASS
 * sinon git diff --name-only baseline..origin/develop ⊆ GOVERNANCE_ONLY_PATHS → PASS
 * tout autre fichier → FAIL (revalidation métier obligatoire)
 */
function assertDevelopFrozen(originDevelop, baseline, changedFiles) {
  if (!originDevelop) {
    throw new Error("origin/develop absent — git fetch origin develop requis");
  }
  if (originDevelop === baseline) return;
  const extra = extraDevelopFiles(changedFiles);
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
  console.log("PASS RG-NEG-frozen-squash-subject");
}

function main() {
  const sha = gitSha();
  console.log(`Release governance SHA=${sha} baseline=${BASELINE}`);
  assertBaseline(sha);
  runNegativeUnitTests();

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
  assert.match(checklist, /USER GO/);
  assert.match(checklist, /Aucun acte ci-dessous n’est exécuté/);
  assert.match(checklist, /eas submit/);
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
  assertDevelopFrozen(originDevelop, BASELINE, developChanged);
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
  assertCurrentPrGovernanceOnly(prChanged);
  console.log(
    `PASS RG-PR-GOVERNANCE-ONLY source=${prRange.source} ${prRange.base}...${prRange.head} ` +
      `files=${prChanged.join(",") || "(none)"}`,
  );

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
  assert.doesNotMatch(workflow, /eas submit/);
  console.log("PASS RG-CI workflow fetch main+develop+PR frozen ; paths Mobile manifests");

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
