/**
 * node Mobile/config/buildProvenance.test.js — LOT 2 (provenance des binaires Android).
 */
"use strict";

const assert = require("node:assert/strict");
const { resolveLocalVersionCode, resolveMobileBuildProvenance } = require("./buildProvenance");

const SHA = "8467944526563b956bfd50370079af9e9355b533";
const noGit = () => null;

// EAS : commit fourni par le builder, versionCode distant.
assert.deepEqual(
  resolveMobileBuildProvenance({
    env: { EAS_BUILD: "true", EAS_BUILD_ID: "abc-123", EAS_BUILD_GIT_COMMIT_HASH: SHA.toUpperCase() },
    profile: "production",
    git: noGit,
  }),
  { gitSha: SHA, gitShaSource: "eas", profile: "production", channel: "eas", versionCodeSource: "eas-remote", easBuildId: "abc-123" },
);

// GitHub Actions (job APK preview) : l'arbre extrait (git local) prime sur GITHUB_SHA,
// qui vaut le commit de merge synthétique sur un événement pull_request.
const MERGE_SHA = "1111111111111111111111111111111111111111";
const ci = resolveMobileBuildProvenance({
  env: { GITHUB_ACTIONS: "true", GITHUB_SHA: MERGE_SHA, GITHUB_REF_NAME: "develop" },
  profile: "preview",
  git: (args) => (args[1] === "HEAD" ? SHA : "HEAD"),
});
assert.equal(ci.channel, "github-actions");
assert.equal(ci.gitSha, SHA);
assert.equal(ci.gitShaSource, "git");
// Sans dépôt git : repli sur GITHUB_SHA.
assert.equal(resolveMobileBuildProvenance({ env: { GITHUB_ACTIONS: "true", GITHUB_SHA: SHA }, git: noGit }).gitShaSource, "github-actions");
assert.equal(ci.gitBranch, "develop");
assert.equal(ci.versionCodeSource, "app-config");

// Build local : repli git ; HEAD détaché → branche nulle.
const local = resolveMobileBuildProvenance({
  env: {},
  profile: "preview",
  git: (args) => (args[0] === "rev-parse" && args[1] === "HEAD" ? SHA : "HEAD"),
});
assert.deepEqual([local.gitSha, local.gitShaSource, local.gitBranch, local.channel], [SHA, "git", undefined, "local"]);
// Aucun champ null (Expo les transformerait en {} dans assets/app.config).
assert.ok(Object.values(local).every((value) => value !== null && typeof value !== "object"), JSON.stringify(local));

// Aucun SHA complet : provenance inconnue, jamais approximative.
const unknown = resolveMobileBuildProvenance({ env: { GITHUB_SHA: "8467944" }, profile: "preview", git: noGit });
assert.deepEqual([unknown.gitSha, unknown.gitShaSource], [undefined, "unknown"]);
assert.ok(!("gitSha" in unknown), "SHA inconnu : champ omis, jamais approximatif");

// versionCode hors EAS : statique par défaut, surchargeable par un entier valide uniquement.
assert.equal(resolveLocalVersionCode(25, {}), 25);
assert.equal(resolveLocalVersionCode(25, { SOMAFRIK_ANDROID_VERSION_CODE: "2611180" }), 2611180);
for (const bad of ["0", "-1", "25a", "1.5", "9999999999"]) {
  assert.throws(() => resolveLocalVersionCode(25, { SOMAFRIK_ANDROID_VERSION_CODE: bad }), /invalide/, bad);
}

console.log("OK buildProvenance: EAS / GitHub Actions / local, versionCode hors EAS");
