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
const BASELINE = "5173537d29d31d16039883552f5e2cb506060581";
const EXPECTED_MAIN = "b5074565b08472217702d8ff848f5a398d08831c";
const MAIN_ONLY = [
  "6ff6110643d4cfdd349162d66b6dd590daf4c902",
  "b5074565b08472217702d8ff848f5a398d08831c",
];
const FROZEN = ["295", "297", "298", "312", "337", "354", "355"];
const MAIN_SNAPSHOT_ON_DEVELOP = "878e4ab82e2fd91a9e419dd63d2b4d2ad6eb5b6b";

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

function hasAncestor(ancestor) {
  try {
    execSync(`git merge-base --is-ancestor ${ancestor} HEAD`, { cwd: ROOT, stdio: "ignore" });
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
  if (hasAncestor(BASELINE)) return;
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

function main() {
  const sha = gitSha();
  console.log(`Release governance SHA=${sha} baseline=${BASELINE}`);
  assertBaseline(sha);

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
  assert.match(checklist, /USER GO/);
  assert.match(checklist, /Aucun acte ci-dessous n’est exécuté/);
  assert.match(checklist, /eas submit/);
  console.log("PASS RG-DOCS HOLD + checklist USER GO");

  for (const pr of FROZEN) {
    const hits = sh(`git log --oneline --grep="pull request #${pr}" HEAD`);
    assert.equal(hits, "", `PR frozen #${pr} présente sur HEAD`);
  }
  console.log("PASS RG-FROZEN #295/#297/#298/#312/#337/#354/#355 absentes de HEAD");

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
    assert.ok(hasAncestor(MAIN_SNAPSHOT_ON_DEVELOP), "snapshot main 878e4ab8 doit rester ancêtre develop");
    console.log("PASS RG-MAIN-ONLY 2 commits stale (6ff61106, b5074565) ; tree #109 ⊂ develop");
  } else {
    console.log("HOLD RG-MAIN-ONLY origin/main absent de ce clone (fetch requis en CI)");
  }

  if (originDevelop && originDevelop !== sha && !hasAncestor(originDevelop === sha ? sha : BASELINE)) {
    console.log(`NOTE origin/develop=${originDevelop}`);
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
  assert.doesNotMatch(workflow, /eas submit/);
  console.log("PASS RG-CI workflow fetch main+develop, pas de submit");

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
