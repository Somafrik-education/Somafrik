/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 2 — provenance des binaires Android.
 *
 * Chaque APK/AAB embarque `extra.buildProvenance` dans `assets/app.config` :
 * commit source, branche, profil, canal et origine du versionCode. Un binaire installé
 * reste ainsi identifiable sans ADB (écran Support) et vérifiable en CI
 * (scripts/verify-android-artifact-provenance.js).
 *
 * Constat d'origine (audit #1193) : les builds locaux et CI héritent tous du versionCode 25
 * statique, tandis qu'EAS utilise un compteur distant (24, 27…). « v25 » désignait plusieurs
 * binaires de commits différents.
 */
"use strict";

const { execFileSync } = require("child_process");

const FULL_SHA = /^[0-9a-f]{40}$/i;

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeSha(value) {
  const raw = clean(value);
  return FULL_SHA.test(raw) ? raw.toLowerCase() : null;
}

function readLocalGit(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/**
 * EAS (EAS_BUILD_GIT_COMMIT_HASH) → SOMAFRIK_GIT_SHA → git local (arbre réellement compilé) → GITHUB_SHA.
 * Sur un événement pull_request, GITHUB_SHA est le commit de merge synthétique, pas la tête
 * extraite par les workflows : il ne sert qu'en dernier recours.
 * Canal : `eas` sur les builders EAS, `github-actions` en CI, `local` sinon.
 */
function resolveMobileBuildProvenance({ env = process.env, profile, cwd, git = readLocalGit } = {}) {
  const isEas = clean(env.EAS_BUILD) === "true" || Boolean(clean(env.EAS_BUILD_ID));
  const candidates = [
    ["eas", () => env.EAS_BUILD_GIT_COMMIT_HASH],
    ["explicit", () => env.SOMAFRIK_GIT_SHA],
    ["git", () => git(["rev-parse", "HEAD"], cwd)],
    ["github-actions", () => env.GITHUB_SHA],
  ];
  let gitSha = null;
  let shaSource = "unknown";
  for (const [source, read] of candidates) {
    const sha = normalizeSha(read());
    if (sha) {
      gitSha = sha;
      shaSource = source;
      break;
    }
  }
  const gitBranch = clean(env.GITHUB_HEAD_REF) || clean(env.GITHUB_REF_NAME) || clean(git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)) || null;
  const channel = isEas ? "eas" : clean(env.GITHUB_ACTIONS) === "true" ? "github-actions" : "local";
  return {
    gitSha,
    gitShaSource: shaSource,
    gitBranch: gitBranch === "HEAD" ? null : gitBranch,
    profile: clean(profile) || null,
    channel,
    // EAS gère un versionCode distant ; hors EAS, la valeur statique d'app config s'applique.
    versionCodeSource: isEas ? "eas-remote" : "app-config",
    easBuildId: clean(env.EAS_BUILD_ID) || null,
  };
}

/**
 * versionCode hors EAS : SOMAFRIK_ANDROID_VERSION_CODE (entier strictement positif) permet à la CI
 * d'attribuer un numéro unique et traçable ; sinon la valeur statique est conservée (comportement existant).
 */
function resolveLocalVersionCode(staticVersionCode, env = process.env) {
  const raw = clean(env.SOMAFRIK_ANDROID_VERSION_CODE);
  if (!raw) return staticVersionCode;
  if (!/^[1-9][0-9]{0,9}$/.test(raw) || Number(raw) > 2100000000) {
    throw new Error(`SOMAFRIK_ANDROID_VERSION_CODE invalide : « ${raw} » (entier 1..2100000000 attendu).`);
  }
  return Number(raw);
}

module.exports = {
  normalizeSha,
  resolveLocalVersionCode,
  resolveMobileBuildProvenance,
};
