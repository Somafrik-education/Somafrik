/**
 * Preview APK — contrat GitHub → Expo/EAS → APK interne → API Render préprod.
 *
 * Fail-closed si le profil preview pointe vers la production, HTTP, localhost ou LAN.
 * N'invente pas de projectId Expo. Ne lance pas eas submit.
 *
 * Usage : npm run verify:mobile-preview-apk
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  ANDROID_PACKAGE,
  APP_SLUG,
  CANONICAL_API_URLS,
  DISPLAY_NAMES,
} = require("../config/releaseEnvironments");

const ROOT = path.join(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "Mobile");
const EXPO_PROJECT_ID = "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5";
const PREVIEW_API = CANONICAL_API_URLS.preview;
const FORBIDDEN_PREVIEW_NEEDLES = [
  "api.somafrik.app",
  "localhost",
  "127.0.0.1",
  "10.0.2.2",
  "192.168.",
  "http://",
];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd || MOBILE,
    env: { ...process.env, ...(options.env || {}) },
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout || result.error}`,
    );
  }
  return result;
}

function assertNoEmptyEasEnv(eas) {
  for (const [profile, config] of Object.entries(eas.build || {})) {
    const env = config.env || {};
    for (const [key, value] of Object.entries(env)) {
      assert.notEqual(
        value,
        "",
        `eas.json build.${profile}.env.${key} ne peut pas être vide (EAS CLI 22). `
          + "Omettre la clé plutôt que \"\".",
      );
    }
    assert.ok(
      !Object.prototype.hasOwnProperty.call(env, "EXPO_PUBLIC_DEMO_PIN"),
      `${profile}: EXPO_PUBLIC_DEMO_PIN doit être omis (PIN démo interdit, chaîne vide invalide).`,
    );
  }
}

function parseExpoConfigJson(stdout) {
  const text = String(stdout || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  assert.ok(start >= 0 && end > start, "expo config --json: JSON introuvable");
  return JSON.parse(text.slice(start, end + 1));
}

function scanPreviewBundle(bundle) {
  assert.ok(bundle.length > 1000, "preview: bundle vide");
  assert.ok(
    bundle.includes(PREVIEW_API) || bundle.includes("somafrik-api-preprod.onrender.com"),
    `preview: API préprod absente (${PREVIEW_API})`,
  );
  assert.ok(!bundle.includes("api.somafrik.app"), "preview: API production présente");
  assert.doesNotMatch(bundle, /http:\/\/localhost/);
  assert.doesNotMatch(bundle, /http:\/\/127\.0\.0\.1/);
  assert.doesNotMatch(bundle, /http:\/\/10\.0\.2\.2/);
  assert.doesNotMatch(bundle, /http:\/\/192\.168\./);
  assert.doesNotMatch(bundle, /["']1234["']/);
  assert.doesNotMatch(bundle, /EXPO_TOKEN/);
  console.log(`OK: bundle preview API guard (${bundle.length} octets)`);
}

/** Absence d'authentification Expo/EAS uniquement — pas une erreur projet / réseau / ACL. */
function isEasAuthMissing(output) {
  const text = String(output || "");
  return (
    /Not logged in/i.test(text)
    || /An Expo user account is required/i.test(text)
    || /log in with eas login/i.test(text)
    || /set the EXPO_TOKEN environment variable/i.test(text)
  );
}

function easProjectInfoOutput(result) {
  const errorText = result.error ? String(result.error.message || result.error) : "";
  return `${result.stdout || ""}\n${result.stderr || ""}\n${errorText}`;
}

function requireEasAuthEnabled(options = {}) {
  if (options.requireAuth === true) return true;
  if (options.requireAuth === false) return false;
  return process.env.SOMAFRIK_REQUIRE_EAS_AUTH === "1";
}

/**
 * Interprète `eas project:info`.
 * BLOCKED_EAS_AUTH uniquement si l'auth est absente (sauf SOMAFRIK_REQUIRE_EAS_AUTH=1).
 * Tout autre status !== 0 échoue.
 */
function interpretEasProjectInfo(result, options = {}) {
  const output = easProjectInfoOutput(result);
  if (/is not allowed to be empty/i.test(output) || /Invalid eas\.json/i.test(output)) {
    throw new Error(`eas.json rejeté par EAS CLI:\n${output}`);
  }
  if (isEasAuthMissing(output)) {
    if (requireEasAuthEnabled(options)) {
      throw new Error(
        "EAS_AUTH_REQUIRED (SOMAFRIK_REQUIRE_EAS_AUTH=1) : eas login / EXPO_TOKEN obligatoire.\n"
          + output,
      );
    }
    return "BLOCKED_EAS_AUTH";
  }
  if (result.error && result.status == null) {
    throw new Error(`eas project:info a échoué (${result.error.code || "spawn"}):\n${output}`);
  }
  if (result.status !== 0) {
    throw new Error(`eas project:info a échoué (status ${result.status}):\n${output}`);
  }
  if (!output.includes(EXPO_PROJECT_ID)) {
    throw new Error(
      `eas project:info: projectId attendu ${EXPO_PROJECT_ID} absent de la sortie:\n${output}`,
    );
  }
  return "OK";
}

function logBlockedEasAuth() {
  console.log("BLOCKED_EAS_AUTH");
  console.log("EAS_AUTH_REQUIRED — action humaine :");
  console.log("cd Mobile");
  console.log("eas login");
  console.log("eas whoami");
  console.log("eas project:info");
  console.log("eas build --platform android --profile preview");
  console.log("Privilégier EAS-managed credentials si EAS propose un keystore Preview.");
  console.log("Interdit : eas submit, upload Play, secret de signature dans Git.");
  console.log("Validation release (auth obligatoire) : SOMAFRIK_REQUIRE_EAS_AUTH=1");
}

function probeEasAuth() {
  const result = spawnSync("npx", ["eas-cli", "project:info"], {
    encoding: "utf8",
    cwd: MOBILE,
    env: process.env,
    timeout: 60_000,
  });
  const outcome = interpretEasProjectInfo(result);
  if (outcome === "BLOCKED_EAS_AUTH") {
    logBlockedEasAuth();
    return outcome;
  }
  process.stdout.write(easProjectInfoOutput(result));
  console.log("OK: eas project:info (projectId existant inchangé)");
  return outcome;
}

function main() {
  const unit = spawnSync(process.execPath, ["scripts/verify-mobile-preview-apk.test.js"], {
    encoding: "utf8",
    cwd: MOBILE,
  });
  process.stdout.write(unit.stdout || "");
  process.stderr.write(unit.stderr || "");
  if (unit.status !== 0) {
    throw new Error("verify-mobile-preview-apk.test.js failed");
  }

  assert.equal(PREVIEW_API, "https://somafrik-api-preprod.onrender.com");
  assert.equal(DISPLAY_NAMES.preview, "Somafrik");
  assert.equal(ANDROID_PACKAGE, "com.somafrik.app");
  assert.equal(APP_SLUG, "somafrik");

  const eas = JSON.parse(read(path.join(MOBILE, "eas.json")).replace(/^\uFEFF/, ""));
  const preview = eas.build.preview;
  assert.ok(preview, "eas.json profil preview manquant");
  assert.equal(preview.distribution, "internal");
  assert.equal(preview.android.buildType, "apk");
  assert.equal(preview.env.EXPO_PUBLIC_RELEASE_PROFILE, "preview");
  assert.equal(preview.env.EAS_BUILD_PROFILE, "preview");
  assert.equal(preview.env.EXPO_PUBLIC_API_URL, PREVIEW_API);
  assert.equal(preview.env.EXPO_PUBLIC_API_URL_PREVIEW, PREVIEW_API);
  assert.equal(preview.env.EXPO_PUBLIC_DEMO_MODE, "false");
  assert.notEqual(preview.env.EXPO_PUBLIC_API_URL, CANONICAL_API_URLS.production);
  assert.ok(!eas.submit, "eas submit interdit");
  assertNoEmptyEasEnv(eas);
  for (const needle of FORBIDDEN_PREVIEW_NEEDLES) {
    if (needle === "http://") {
      assert.doesNotMatch(preview.env.EXPO_PUBLIC_API_URL, /^http:\/\//i);
      continue;
    }
    assert.ok(
      !String(preview.env.EXPO_PUBLIC_API_URL).includes(needle),
      `preview API contient une cible interdite (${needle})`,
    );
  }
  console.log("OK: eas.json preview — internal APK, API préprod, pas de PIN démo, pas de submit");

  const appJson = JSON.parse(read(path.join(MOBILE, "app.json")));
  assert.equal(appJson.expo.extra.eas.projectId, EXPO_PROJECT_ID);
  assert.equal(appJson.expo.slug, APP_SLUG);
  assert.equal(appJson.expo.android.package, ANDROID_PACKAGE);
  console.log(`OK: Expo projectId existant ${EXPO_PROJECT_ID} (non inventé)`);

  const envJs = read(path.join(MOBILE, "src", "config", "env.ts"));
  assert.match(envJs, /case "preview":/);
  assert.match(envJs, /Preview QA/);
  const badge = read(path.join(MOBILE, "src", "components", "EnvironmentBadge.tsx"));
  assert.match(badge, /testID="environment-badge"/);
  const appTsx = read(path.join(MOBILE, "App.tsx"));
  assert.match(appTsx, /<EnvironmentBadge\s*\/>/);
  console.log("OK: UX Preview — nom launcher Somafrik + badge environnement visible");

  const expoConfig = run("npx", ["expo", "config", "--type", "public", "--json"], {
    env: {
      CI: "1",
      EXPO_NO_TELEMETRY: "1",
      EXPO_PUBLIC_RELEASE_PROFILE: "preview",
      EAS_BUILD_PROFILE: "preview",
      EXPO_PUBLIC_API_URL: PREVIEW_API,
      EXPO_PUBLIC_API_URL_PREVIEW: PREVIEW_API,
      EXPO_PUBLIC_DEMO_MODE: "false",
    },
  });
  const publicConfig = parseExpoConfigJson(expoConfig.stdout);
  assert.equal(publicConfig.name, "Somafrik");
  assert.equal(publicConfig.slug, APP_SLUG);
  assert.equal(publicConfig.android.package, ANDROID_PACKAGE);
  assert.equal(publicConfig.extra.apiUrl, PREVIEW_API);
  assert.equal(publicConfig.extra.releaseProfile, "preview");
  assert.equal(publicConfig.extra.demoMode, false);
  assert.equal(publicConfig.extra.httpsOnly, true);
  assert.equal(publicConfig.extra.showEnvironmentBadge, true);
  assert.equal(publicConfig.extra.eas.projectId, EXPO_PROJECT_ID);
  assert.notEqual(publicConfig.updates?.enabled, true);
  console.log("OK: expo config public preview — Somafrik / HTTPS préprod / badge");

  const pkg = JSON.parse(read(path.join(MOBILE, "package.json")));
  assert.equal(pkg.scripts["build:preview"], "eas build --platform android --profile preview");
  assert.equal(pkg.scripts["verify:mobile-preview-apk"], "node scripts/verify-mobile-preview-apk.js");

  const gitignore = read(path.join(MOBILE, ".gitignore"));
  assert.match(gitignore, /^\*\.apk$/m);
  assert.match(gitignore, /^android\/$/m);
  assert.match(gitignore, /credentials\.json/);
  assert.match(gitignore, /\*\.jks/);
  assert.match(gitignore, /\*\.keystore/);

  const docs = read(path.join(ROOT, "docs", "mobile", "PREVIEW-APK.md"));
  assert.match(docs, /eas login/);
  assert.match(docs, /eas whoami/);
  assert.match(docs, /eas project:info/);
  assert.match(docs, /eas build --platform android --profile preview/);
  assert.match(docs, /Nom affiché \| \*\*Somafrik\*\*/);
  assert.match(docs, /Badge \| \*\*Preview QA\*\*/);
  assert.doesNotMatch(docs, /lanceur doit afficher \*\*Somafrik QA\*\*/);
  assert.match(docs, /somafrik-api-preprod\.onrender\.com/);
  assert.match(docs, /ne constitue pas un service Render/);
  assert.match(docs, /BLOCKED_EAS_AUTH|eas login/);
  assert.match(docs, /SOMAFRIK_REQUIRE_EAS_AUTH/);
  assert.match(docs, /L10-APK-RC1-SMOKE/);
  const l10 = read(path.join(ROOT, "docs", "mobile", "L10-APK-RC1-SMOKE.md"));
  assert.match(l10, /NO-GO/);
  assert.match(l10, /Admin School/);
  assert.match(l10, /Enseignant/);
  assert.match(l10, /somafrik-api-preprod\.onrender\.com/);
  assert.match(l10, /GRANT/);
  assert.match(l10, /outbox/);
  assert.match(l10, /BLOCKED_EAS_AUTH/);
  console.log("OK: documentation Preview APK reproductible");
  console.log("OK: protocole L10 smoke RC1 présent");

  const ci = read(path.join(ROOT, ".github", "workflows", "ci.yml"));
  const security = read(path.join(ROOT, ".github", "workflows", "security.yml"));
  const rootPkg = read(path.join(ROOT, "package.json"));
  assert.match(ci, /name: verify:mobile-preview-apk/);
  assert.match(ci, /npm run verify:mobile-preview-apk/);
  assert.match(security, /name: verify:mobile-preview-apk/);
  assert.match(security, /npm run verify:mobile-preview-apk/);
  assert.match(rootPkg, /verify:mobile-preview-apk/);
  console.log("OK: CI + Security branchent verify:mobile-preview-apk");

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "somafrik-preview-apk-"));
  const exported = run(process.execPath, ["scripts/export-release-bundle.js", "preview"], {
    env: { SOMAFRIK_BUNDLE_OUT: outDir },
  });
  const bundlePath = (exported.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
  assert.ok(bundlePath && fs.existsSync(bundlePath), "preview: bundle introuvable");
  scanPreviewBundle(read(bundlePath));

  const { prebuildProfile } = require("./verify-native-prebuild");
  fs.rmSync(path.join(MOBILE, "android"), { recursive: true, force: true });
  prebuildProfile("preview");
  fs.rmSync(path.join(MOBILE, "android"), { recursive: true, force: true });
  console.log("OK: prebuild Android preview inspecté puis supprimé (CNG, non commité)");

  const easAuth = probeEasAuth();
  console.log(`EAS project info: ${easAuth}`);
  console.log("verify:mobile-preview-apk OK");
}

module.exports = {
  EXPO_PROJECT_ID,
  isEasAuthMissing,
  interpretEasProjectInfo,
  probeEasAuth,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
