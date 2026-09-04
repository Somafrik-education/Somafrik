/**
 * LOT 7 — preuves de release readiness (Expo / EAS / Play Store), sans upload.
 *
 * Usage : npm run verify:mobile-release-readiness
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  ANDROID_PACKAGE,
  ANDROID_VERSION_CODE,
  APP_VERSION,
  CANONICAL_API_URLS,
} = require("../config/releaseEnvironments");
const { verifyMobileBranding } = require("./verify-mobile-branding");

const ROOT = path.join(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "Mobile");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function pngInfo(filePath) {
  const buf = fs.readFileSync(filePath);
  const isPng = buf.length >= 24
    && buf[0] === 0x89
    && buf[1] === 0x50
    && buf[2] === 0x4e
    && buf[3] === 0x47
    && buf[4] === 0x0d
    && buf[5] === 0x0a
    && buf[6] === 0x1a
    && buf[7] === 0x0a;
  const isJpeg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  let width = 0;
  let height = 0;
  if (isPng) {
    width = buf.readUInt32BE(16);
    height = buf.readUInt32BE(20);
  }
  return { isPng, isJpeg, width, height, bytes: buf.length };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd || MOBILE,
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout || result.error}`,
    );
  }
  return result;
}

function scanBundle(label, bundle, expectedUrl, forbiddenUrl) {
  assert.ok(bundle.length > 1000, `${label}: bundle vide`);
  const expectedHost = expectedUrl.replace(/^https:\/\//, "");
  const forbiddenHost = forbiddenUrl.replace(/^https:\/\//, "");
  assert.ok(
    bundle.includes(expectedUrl) || bundle.includes(expectedHost),
    `${label}: URL API absente (${expectedUrl})`,
  );
  assert.ok(!bundle.includes(forbiddenHost), `${label}: URL interdite présente (${forbiddenHost})`);
  assert.doesNotMatch(bundle, /http:\/\/localhost:5000/);
  assert.doesNotMatch(bundle, /http:\/\/10\.0\.2\.2:5000/);
  assert.doesNotMatch(bundle, /http:\/\/127\.0\.0\.1:5000/);
  assert.doesNotMatch(bundle, /http:\/\/192\.168\./);
  assert.doesNotMatch(bundle, /["']1234["']/);
  assert.doesNotMatch(bundle, /CD-2026-0001/);
  assert.doesNotMatch(bundle, /Remplir un compte enseignant demo/);
  assert.doesNotMatch(bundle, /DATABASE_URL\s*=\s*postgres/i);
  assert.doesNotMatch(bundle, /BEGIN (RSA )?PRIVATE KEY/);
  assert.doesNotMatch(bundle, /ghp_[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(bundle, /github_pat_[A-Za-z0-9_]{20,}/);
  assert.doesNotMatch(bundle, /sk_live_[A-Za-z0-9]+/);
  console.log(`OK: bundle ${label} (${bundle.length} octets)`);
}

function main() {
  fs.rmSync(path.join(MOBILE, "android"), { recursive: true, force: true });

  const envTest = spawnSync(process.execPath, ["config/releaseEnvironments.test.js"], {
    encoding: "utf8",
    cwd: MOBILE,
  });
  if (envTest.status !== 0) {
    throw new Error(envTest.stderr || envTest.stdout || "releaseEnvironments.test.js failed");
  }
  process.stdout.write(envTest.stdout);

  const eas = JSON.parse(read(path.join(MOBILE, "eas.json")).replace(/^\uFEFF/, ""));
  for (const profile of ["development", "preview", "preproduction", "production"]) {
    assert.ok(eas.build[profile], `eas.json profil manquant: ${profile}`);
  }
  assert.equal(eas.build.preview.distribution, "internal");
  assert.equal(eas.build.preview.android.buildType, "apk");
  assert.equal(eas.build.preview.env.EXPO_PUBLIC_API_URL, CANONICAL_API_URLS.preview);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(eas.build.preview.env, "EXPO_PUBLIC_DEMO_PIN"),
    "preview: EXPO_PUBLIC_DEMO_PIN omis (EAS CLI 22 refuse la chaîne vide)",
  );
  assert.equal(eas.build.preproduction.distribution, "store");
  assert.equal(eas.build.preproduction.android.buildType, "app-bundle");
  assert.equal(eas.build.production.distribution, "store");
  assert.equal(eas.build.production.android.buildType, "app-bundle");
  if (
    eas.cli.appVersionSource === "local"
    && eas.build.preproduction.autoIncrement
    && eas.build.production.autoIncrement
  ) {
    throw new Error(
      "NO-GO: appVersionSource=local + autoIncrement preproduction/production — "
        + "deux AAB du même Git versionCode peuvent entrer en collision Play. Utiliser remote.",
    );
  }
  assert.equal(eas.cli.appVersionSource, "remote", "Play versionCode doit être remote (pas local+autoIncrement)");
  assert.equal(eas.build.preproduction.autoIncrement, true);
  assert.equal(eas.build.production.autoIncrement, true);
  assert.equal(eas.build.preproduction.env.EXPO_PUBLIC_API_URL, CANONICAL_API_URLS.preproduction);
  assert.equal(eas.build.production.env.EXPO_PUBLIC_API_URL, CANONICAL_API_URLS.production);
  assert.notEqual(eas.build.preproduction.env.EXPO_PUBLIC_API_URL, eas.build.production.env.EXPO_PUBLIC_API_URL);
  assert.equal(eas.build.preproduction.env.EXPO_PUBLIC_DEMO_MODE, "false");
  assert.equal(eas.build.production.env.EXPO_PUBLIC_DEMO_MODE, "false");
  assert.ok(!eas.submit, "eas submit interdit dans ce lot");
  console.log("OK: eas.json — remote versionCode + autoIncrement store + 4 profils, pas de submit");

  const appJson = JSON.parse(read(path.join(MOBILE, "app.json")));
  assert.equal(appJson.expo.android.package, ANDROID_PACKAGE);
  assert.equal(appJson.expo.version, APP_VERSION);
  assert.equal(appJson.expo.android.versionCode, ANDROID_VERSION_CODE);
  assert.ok(Number.isInteger(appJson.expo.android.versionCode));
  assert.doesNotMatch(JSON.stringify(appJson), /usesCleartextTraffic/);
  assert.doesNotMatch(JSON.stringify(appJson), /SchoolLink|schoollink/i);
  const permissions = appJson.expo.android.permissions || [];
  assert.deepStrictEqual(permissions, ["CAMERA"]);
  assert.ok(!permissions.includes("READ_MEDIA_IMAGES"), "app.json ne doit plus déclarer READ_MEDIA_IMAGES");
  console.log("OK: app.json package/version/permissions/schema (CAMERA only)");

  const appConfig = read(path.join(MOBILE, "app.config.js"));
  assert.match(appConfig, /expo-build-properties/);
  assert.match(appConfig, /usesCleartextTraffic/);
  assert.match(appConfig, /profileAllowsCleartext/);
  assert.doesNotMatch(appConfig, /http:\/\/localhost:5000/);
  assert.match(appConfig, /withSomafrikAndroidSecurity/);
  assert.match(appConfig, /android\.permission\.READ_MEDIA_IMAGES/);
  const plugin = read(path.join(MOBILE, "plugins", "withSomafrikAndroidSecurity.js"));
  assert.match(plugin, /android\.permission\.READ_MEDIA_IMAGES/);
  console.log("OK: app.config fail-closed + cleartext hors schéma Expo + READ_MEDIA_IMAGES bloqué");

  const pkg = JSON.parse(read(path.join(MOBILE, "package.json")));
  assert.ok(pkg.dependencies["react-native-worklets"], "react-native-worklets manquant");
  assert.ok(pkg.dependencies["expo-build-properties"], "expo-build-properties manquant");
  assert.match(pkg.dependencies.expo || "", /54\./);
  console.log("OK: packages SDK 54 + worklets");

  verifyMobileBranding();
  const icon = pngInfo(path.join(MOBILE, "assets", "somafrik-app-icon.png"));
  const androidForeground = pngInfo(path.join(MOBILE, "assets", "somafrik-android-adaptive-foreground.png"));
  const uiLogo = pngInfo(path.join(MOBILE, "assets", "somafrik-logo.png"));
  const splash = pngInfo(path.join(MOBILE, "assets", "somafrik-splash.png"));
  assert.ok(icon.isPng && !icon.isJpeg, "icon doit être un vrai PNG");
  assert.ok(icon.width >= 1024 && icon.height >= 1024, "icon dimensions insuffisantes");
  assert.equal(icon.width, icon.height, "icon iOS/Expo doit être carrée");
  assert.ok(androidForeground.isPng && !androidForeground.isJpeg, "foreground Android doit être un vrai PNG");
  assert.ok(androidForeground.width >= 1024 && androidForeground.width === androidForeground.height, "foreground Android dimensions insuffisantes");
  assert.ok(uiLogo.isPng && !uiLogo.isJpeg, "logo UI doit être un vrai PNG");
  assert.ok(uiLogo.width >= 1024 && uiLogo.height >= 1024, "logo UI dimensions insuffisantes");
  assert.ok(splash.isPng && !splash.isJpeg, "splash doit être un vrai PNG (pas un JPEG renommé)");
  assert.ok(splash.width >= 1024 && splash.height >= 1024, "splash dimensions insuffisantes");
  assert.ok(!fs.existsSync(path.join(MOBILE, "assets", "schoollink-logo.png")), "relique SchoolLink");
  console.log("OK: assets BRANDING-V2 icon iOS + Android adaptive + logo/splash MIME réel + dimensions");

  const gitignore = `${read(path.join(ROOT, ".gitignore"))}\n${read(path.join(MOBILE, ".gitignore"))}`;
  for (const needle of ["*.jks", "*.keystore", "credentials.json", "*.apk"]) {
    assert.ok(gitignore.includes(needle), `.gitignore doit contenir ${needle}`);
  }
  const trackedSecrets = spawnSync("git", ["ls-files", "*.jks", "*.keystore", "credentials.json"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  assert.equal((trackedSecrets.stdout || "").trim(), "", "keystore / credentials.json suivis par git");
  console.log("OK: gitignore release secrets");

  assert.match(plugin, /allowBackup/);
  assert.match(plugin, /cleartextTrafficPermitted="false"/);
  assert.match(plugin, /allowCleartext \? NETWORK_SECURITY_DEV : NETWORK_SECURITY_RELEASE/);
  assert.match(plugin, /usesCleartextTraffic/);
  assert.match(plugin, /RECORD_AUDIO/);
  assert.doesNotMatch(plugin, /POST_NOTIFICATIONS/);
  assert.doesNotMatch(plugin, /android\.permission\.VIBRATE/);
  const gitignoreMobile = read(path.join(MOBILE, ".gitignore"));
  assert.match(gitignoreMobile, /^android\/$/m);
  const trackedAndroid = spawnSync("git", ["ls-files", "Mobile/android"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  assert.equal((trackedAndroid.stdout || "").trim(), "", "android/ ne doit plus être versionné (CNG)");
  console.log("OK: CNG — plugin sécurité + android/ non suivi");

  const docsInventory = read(path.join(ROOT, "docs", "mobile", "PLAY-STORE-DATA-INVENTORY.md"));
  const docsReady = read(path.join(ROOT, "docs", "mobile", "RELEASE-READINESS.md"));
  const docsPreview = read(path.join(ROOT, "docs", "mobile", "PREVIEW-APK.md"));
  assert.match(docsInventory, /Donnée/);
  assert.match(docsReady, /preproduction/);
  assert.match(docsReady, /Internal testing/);
  assert.match(docsReady, /NON effectué/);
  assert.match(docsReady, /appVersionSource/);
  assert.match(docsReady, /eas build:version:set/);
  assert.match(docsPreview, /eas build --platform android --profile preview/);
  assert.match(docsPreview, /ne constitue pas un service Render/);
  console.log("OK: documentation Play Store + Preview APK");

  const doctor = spawnSync("npx", ["expo-doctor"], { encoding: "utf8", cwd: MOBILE });
  process.stdout.write(doctor.stdout || "");
  process.stderr.write(doctor.stderr || "");
  if (doctor.status !== 0) {
    throw new Error("expo-doctor a échoué (cible 18/18 ou équivalent).");
  }
  console.log("OK: expo-doctor");

  for (const profile of ["preview", "preproduction", "production"]) {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `somafrik-${profile}-`));
    const exported = run(process.execPath, ["scripts/export-release-bundle.js", profile], {
      env: { SOMAFRIK_BUNDLE_OUT: outDir },
    });
    const bundlePath = (exported.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
    assert.ok(bundlePath && fs.existsSync(bundlePath), `${profile}: bundle introuvable`);
    const bundle = read(bundlePath);
    if (profile === "production") {
      scanBundle(profile, bundle, CANONICAL_API_URLS.production, CANONICAL_API_URLS.preproduction);
    } else {
      scanBundle(profile, bundle, CANONICAL_API_URLS.preproduction, CANONICAL_API_URLS.production);
    }
  }

  const { runNativeProof } = require("./verify-native-prebuild");
  runNativeProof();

  const ci = read(path.join(ROOT, ".github", "workflows", "ci.yml"));
  const security = read(path.join(ROOT, ".github", "workflows", "security.yml"));
  const aabWorkflow = read(path.join(ROOT, ".github", "workflows", "mobile-release-build.yml"));
  assert.match(ci, /npm run verify:mobile-release-readiness/);
  assert.match(ci, /npm run verify:mobile-preview-apk/);
  assert.match(ci, /npm run verify:mobile-usability/);
  assert.match(ci, /name: Bootstrap runtime guard/);
  // AAB Gradle n'est plus un step du nightly : job isolé workflow_dispatch.
  assert.match(aabWorkflow, /name: Android AAB/);
  assert.match(aabWorkflow, /SOMAFRIK_REQUIRE_AAB/);
  assert.match(aabWorkflow, /android-actions\/setup-android/);
  assert.doesNotMatch(aabWorkflow, /eas submit/);
  // Security nightly : invariants mobile-security, pas le scan Expo doctor / bundles.
  assert.match(security, /npm run verify:mobile-security/);
  assert.doesNotMatch(security, /eas submit/);
  console.log("OK: nightly CI release-readiness + preview-apk ; AAB Gradle = mobile-release-build.yml");

  console.log("verify:mobile-release-readiness OK");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
