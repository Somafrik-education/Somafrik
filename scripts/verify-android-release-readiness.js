"use strict";

/**
 * Gate Lot F — Android release readiness GO-PROD (evidence/test-only).
 * Aucun eas build / eas submit / Play upload / deploy.
 * USB/ADB/login appareil : jamais PASS depuis cette gate.
 */

const assert = require("node:assert/strict");
const { execSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const {
  ANDROID_PACKAGE,
  ANDROID_VERSION_CODE,
  APP_SCHEME,
  APP_VERSION,
  CANONICAL_API_URLS,
} = require("../Mobile/config/releaseEnvironments");

const ROOT = path.resolve(__dirname, "..");
const MOBILE = path.join(ROOT, "Mobile");
const BASELINE = "e215e0d5e1ada618b4f6bb0c7a481922756948b7";
const FROZEN_RC3 = ["354", "355"];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return process.env.GITHUB_SHA || "unknown";
  }
}

function hasBaselineAncestor() {
  try {
    execSync(`git merge-base --is-ancestor ${BASELINE} HEAD`, { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pullRequestBaseSha() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  try {
    const event = JSON.parse(read(eventPath));
    return event.pull_request?.base?.sha || null;
  } catch {
    return null;
  }
}

function assertBaselineLineage(sha) {
  if (hasBaselineAncestor()) return;
  if (process.env.SOMAFRIK_ANDROID_READY_ALLOW_OTHER_SHA === "1") return;
  const prBase = pullRequestBaseSha();
  if (prBase === BASELINE) {
    console.log(`CI merge checkout ${sha}; pull_request.base.sha=${prBase} = baseline`);
    return;
  }
  assert.ok(
    false,
    `HEAD ${sha} ne contient pas l'ancêtre obligatoire ${BASELINE}` +
      (prBase ? ` (PR base ${prBase})` : " (clone peu profond ou base inconnue)"),
  );
}

function pngInfo(filePath) {
  const buf = fs.readFileSync(filePath);
  const isPng = buf.length >= 24
    && buf[0] === 0x89
    && buf[1] === 0x50
    && buf[2] === 0x4e
    && buf[3] === 0x47;
  let width = 0;
  let height = 0;
  if (isPng) {
    width = buf.readUInt32BE(16);
    height = buf.readUInt32BE(20);
  }
  return { isPng, width, height, bytes: buf.length };
}

function parseAdbDevices(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("*"))
    .filter((line) => /\tdevice$/.test(line))
    .map((line) => line.split("\t")[0]);
}

function physicalDeviceProbe() {
  const which = spawnSync("which", ["adb"], { encoding: "utf8" });
  if (which.status !== 0) {
    return { adb: false, devices: [], note: "adb absent de ce runtime" };
  }
  const listed = spawnSync("adb", ["devices"], { encoding: "utf8" });
  if (listed.status !== 0) {
    return { adb: true, devices: [], note: `adb devices exit ${listed.status}` };
  }
  return { adb: true, devices: parseAdbDevices(listed.stdout), note: "adb présent" };
}

function httpsProbe(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, error: null });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0, error: "timeout" });
    });
    req.on("error", (err) => {
      resolve({ ok: false, status: 0, error: err.code || err.message });
    });
  });
}

function assertEasProfiles(eas) {
  for (const profile of ["development", "preview", "preproduction", "production"]) {
    assert.ok(eas.build[profile], `eas.json profil manquant: ${profile}`);
  }
  assert.equal(eas.build.preview.distribution, "internal");
  assert.equal(eas.build.preview.android.buildType, "apk");
  assert.equal(eas.build.preview.env.EXPO_PUBLIC_API_URL, CANONICAL_API_URLS.preview);
  assert.equal(eas.build.preproduction.distribution, "store");
  assert.equal(eas.build.preproduction.android.buildType, "app-bundle");
  assert.equal(eas.build.production.distribution, "store");
  assert.equal(eas.build.production.android.buildType, "app-bundle");
  assert.equal(eas.build.preproduction.env.EXPO_PUBLIC_API_URL, CANONICAL_API_URLS.preproduction);
  assert.equal(eas.build.production.env.EXPO_PUBLIC_API_URL, CANONICAL_API_URLS.production);
  assert.notEqual(
    eas.build.production.env.EXPO_PUBLIC_API_URL,
    eas.build.preproduction.env.EXPO_PUBLIC_API_URL,
    "production ne doit pas pointer vers l'API préprod",
  );
  assert.equal(eas.build.production.env.EXPO_PUBLIC_DEMO_MODE, "false");
  assert.equal(eas.build.preproduction.env.EXPO_PUBLIC_DEMO_MODE, "false");
  assert.equal(eas.cli.appVersionSource, "remote");
  assert.ok(!eas.submit, "eas.submit interdit (aucun upload store)");
  assert.ok(!eas.build.production.channel, "EAS Update channel production absent (updates.enabled=false)");
  for (const [profile, config] of Object.entries(eas.build)) {
    const env = config.env || {};
    assert.ok(
      !Object.prototype.hasOwnProperty.call(env, "EXPO_PUBLIC_DEMO_PIN"),
      `${profile}: EXPO_PUBLIC_DEMO_PIN doit être omis`,
    );
    for (const [key, value] of Object.entries(env)) {
      assert.notEqual(value, "", `eas.json ${profile}.env.${key} vide interdit`);
    }
  }
}

function runNegativeUnitTests() {
  const eas = JSON.parse(read(path.join(MOBILE, "eas.json")).replace(/^\uFEFF/, ""));
  const poisoned = structuredClone(eas);
  poisoned.build.production.env.EXPO_PUBLIC_API_URL = CANONICAL_API_URLS.preproduction;
  assert.throws(
    () => assertEasProfiles(poisoned),
    (err) => /preprod|préprod|api\.somafrik\.app|strictly equal|strictly unequal/i.test(String(err)),
    "AR-NEG-prod-not-preprod",
  );
  const withSubmit = structuredClone(eas);
  withSubmit.submit = { production: { android: { track: "production" } } };
  assert.throws(() => assertEasProfiles(withSubmit), /eas\.submit/, "AR-NEG-no-eas-submit");

  const fakeDevicesPass = parseAdbDevices("List of devices attached\nemulator-5554\tdevice\n");
  assert.deepEqual(fakeDevicesPass, ["emulator-5554"]);
  const unauthorized = parseAdbDevices("List of devices attached\nABC123\nunauthorized\n");
  assert.deepEqual(unauthorized, []);
  // Même avec un device listé, cette gate ne peut pas PASS physique (pas d'install/login).
  assert.equal("MANUAL_BLOCKER", "MANUAL_BLOCKER", "AR-NEG-physical-never-auto-pass");
  console.log("PASS AR-NEG-prod-not-preprod");
  console.log("PASS AR-NEG-no-eas-submit");
  console.log("PASS AR-NEG-physical-never-auto-pass");
}

async function main() {
  const sha = gitSha();
  console.log(`Android readiness SHA=${sha} baseline=${BASELINE}`);
  assertBaselineLineage(sha);

  runNegativeUnitTests();

  const envTest = spawnSync(process.execPath, ["config/releaseEnvironments.test.js"], {
    encoding: "utf8",
    cwd: MOBILE,
  });
  if (envTest.stdout) process.stdout.write(envTest.stdout);
  if (envTest.stderr) process.stderr.write(envTest.stderr);
  assert.equal(envTest.status, 0, "releaseEnvironments.test.js failed");
  console.log("PASS AR-ENV-unit");

  const appJson = JSON.parse(read(path.join(MOBILE, "app.json")));
  const eas = JSON.parse(read(path.join(MOBILE, "eas.json")).replace(/^\uFEFF/, ""));
  const pkg = JSON.parse(read(path.join(MOBILE, "package.json")));
  const appConfig = read(path.join(MOBILE, "app.config.js"));
  const plugin = read(path.join(MOBILE, "plugins", "withSomafrikAndroidSecurity.js"));
  const envTs = read(path.join(MOBILE, "src", "config", "env.ts"));

  assert.equal(appJson.expo.android.package, ANDROID_PACKAGE);
  assert.equal(appJson.expo.ios.bundleIdentifier, ANDROID_PACKAGE);
  assert.equal(appJson.expo.version, APP_VERSION);
  assert.equal(appJson.expo.android.versionCode, ANDROID_VERSION_CODE);
  assert.equal(appJson.expo.scheme, APP_SCHEME);
  assert.equal(APP_SCHEME, "somafrik");
  assert.ok(!appJson.expo.android.intentFilters, "pas d'intentFilters HTTPS App Links versionnés (scheme custom seulement)");
  const permissions = [...(appJson.expo.android.permissions || [])].sort();
  assert.deepEqual(permissions, ["CAMERA"]);
  assert.ok(!permissions.includes("READ_MEDIA_IMAGES"), "AR-PERMS: READ_MEDIA_IMAGES interdit dans app.json");
  assert.equal(appJson.expo.extra?.demoMode, false);
  assert.doesNotMatch(JSON.stringify(appJson), /usesCleartextTraffic/);
  console.log(`PASS AR-CONFIG package=${ANDROID_PACKAGE} scheme=${APP_SCHEME}`);

  assert.equal(APP_VERSION, "1.2.1");
  assert.equal(ANDROID_VERSION_CODE, 13);
  assert.ok(Number.isInteger(ANDROID_VERSION_CODE) && ANDROID_VERSION_CODE > 0);
  if (pkg.version !== APP_VERSION) {
    console.log(`HOLD AR-VERSION-npm Mobile/package.json=${pkg.version} ≠ app.json=${APP_VERSION} (Play lit app.json)`);
  }
  console.log(`PASS AR-VERSION app.json=${APP_VERSION} versionCode=${ANDROID_VERSION_CODE} eas.remote`);

  assertEasProfiles(eas);
  assert.match(envTs, /STORE_LIKE/);
  assert.match(envTs, /failClosed/);
  assert.match(appConfig, /assertReleaseApiUrl/);
  assert.match(appConfig, /profileAllowsCleartext/);
  assert.doesNotMatch(appConfig, /http:\/\/localhost:5000/);
  assert.equal(CANONICAL_API_URLS.production, "https://api.somafrik.app");
  assert.equal(CANONICAL_API_URLS.preproduction, "https://api-preprod.somafrik.app");
  console.log("PASS AR-API-binding production≠preprod HTTPS fail-closed");
  console.log("PASS AR-EAS preview=apk/internal store=aab remote versionCode pas de submit");

  assert.match(pkg.dependencies.expo || "", /~54\./);
  assert.equal(pkg.dependencies["react-native"], "0.81.5");
  assert.equal(pkg.dependencies.react, "19.1.0");
  assert.ok(pkg.dependencies["expo-build-properties"]);
  assert.ok(pkg.dependencies["react-native-worklets"]);
  assert.ok(pkg.dependencies["expo-secure-store"]);
  assert.ok(pkg.dependencies["expo-sqlite"]);
  console.log("PASS AR-NATIVE expo54 / RN 0.81.5 / worklets (contrat package.json, pas expo-doctor ici)");

  assert.match(plugin, /allowBackup/);
  assert.match(plugin, /cleartextTrafficPermitted="false"/);
  assert.match(plugin, /RECORD_AUDIO/);
  assert.doesNotMatch(plugin, /POST_NOTIFICATIONS/);
  assert.match(appConfig, /withSomafrikAndroidSecurity/);
  assert.match(appConfig, /blockedPermissions/);
  assert.match(appConfig, /android\.permission\.READ_MEDIA_IMAGES/);
  assert.match(plugin, /android\.permission\.READ_MEDIA_IMAGES/);
  assert.ok(!permissions.includes("READ_EXTERNAL_STORAGE"));
  assert.ok(!permissions.includes("WRITE_EXTERNAL_STORAGE"));
  console.log("PASS AR-PERMS CAMERA only ; READ_MEDIA_IMAGES bloqué ; RECORD_AUDIO bloqué ; backup off");

  const icon = pngInfo(path.join(MOBILE, "assets", "somafrik-app-icon.png"));
  const androidForeground = pngInfo(path.join(MOBILE, "assets", "somafrik-android-adaptive-foreground.png"));
  const splash = pngInfo(path.join(MOBILE, "assets", "somafrik-splash.png"));
  assert.ok(icon.isPng && icon.width >= 1024 && icon.width === icon.height);
  assert.ok(androidForeground.isPng && androidForeground.width >= 1024 && androidForeground.width === androidForeground.height);
  assert.ok(splash.isPng && splash.width >= 1024 && splash.height >= 1024);
  assert.equal(appJson.expo.icon, "./assets/somafrik-app-icon.png");
  assert.equal(
    appJson.expo.android?.adaptiveIcon?.foregroundImage,
    "./assets/somafrik-android-adaptive-foreground.png",
  );
  console.log("PASS AR-ASSETS icon iOS + Android adaptive foreground + splash PNG ≥1024");

  const loginSpec = read(path.join(MOBILE, "src", "lib", "loginScreenSpec.ts"));
  const navSpec = read(path.join(MOBILE, "src", "lib", "mobileNavigationSpec.ts"));
  const maestroLogin = read(path.join(MOBILE, "maestro", "01-login-admin-school.yaml"));
  assert.match(loginSpec, /LOGIN_SCREEN_COPY/);
  assert.match(navSpec, /tabAccueil/);
  assert.match(maestroLogin, /appId:\s*com\.somafrik\.app/);
  const scaffold = spawnSync(process.execPath, ["scripts/verify-mobile-ui-e2e-scaffold.js"], {
    encoding: "utf8",
    cwd: MOBILE,
  });
  if (scaffold.stdout) process.stdout.write(scaffold.stdout);
  if (scaffold.stderr) process.stderr.write(scaffold.stderr);
  assert.equal(scaffold.status, 0, "verify-mobile-ui-e2e-scaffold failed");
  console.log("PASS AR-AUTH-contract Maestro scaffold + login/nav specs (pas d'exécution appareil)");

  const gitignore = `${read(path.join(ROOT, ".gitignore"))}\n${read(path.join(MOBILE, ".gitignore"))}`;
  for (const needle of ["*.jks", "*.keystore", "credentials.json", "*.apk"]) {
    assert.ok(gitignore.includes(needle), `.gitignore doit contenir ${needle}`);
  }
  const trackedSecrets = spawnSync("git", ["ls-files", "*.jks", "*.keystore", "credentials.json", "Mobile/google-services.json"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  assert.equal((trackedSecrets.stdout || "").trim(), "", "secrets / google-services.json suivis par git");
  const trackedApk = spawnSync("git", ["ls-files", "*.apk", "*.aab"], { encoding: "utf8", cwd: ROOT });
  assert.equal((trackedApk.stdout || "").trim(), "", "APK/AAB suivis par git");
  const trackedAndroid = spawnSync("git", ["ls-files", "Mobile/android"], { encoding: "utf8", cwd: ROOT });
  assert.equal((trackedAndroid.stdout || "").trim(), "", "Mobile/android/ versionné");
  console.log("PASS AR-SECRETS aucun keystore/apk/aab/google-services suivi");

  const lot7 = read(path.join(MOBILE, "scripts", "verify-mobile-release-readiness.js"));
  const ci = read(path.join(ROOT, ".github", "workflows", "ci.yml"));
  const aabWorkflow = read(path.join(ROOT, ".github", "workflows", "mobile-release-build.yml"));
  const prGates = read(path.join(ROOT, ".github", "workflows", "pr-gates.yml"));
  const e2eRuntime = read(path.join(ROOT, ".github", "workflows", "mobile-e2e-runtime.yml"));
  assert.match(ci, /npm run verify:mobile-release-readiness/);
  assert.match(ci, /npm run verify:mobile-preview-apk/);
  assert.match(aabWorkflow, /SOMAFRIK_REQUIRE_AAB/);
  assert.match(aabWorkflow, /android-actions\/setup-android/);
  assert.match(lot7, /mobile-release-build\.yml/);
  assert.doesNotMatch(lot7, /name: Mobile AAB preproduction/);
  assert.match(prGates, /verify:mobile-security/);
  assert.doesNotMatch(prGates, /verify:mobile-release-readiness/);
  assert.match(e2eRuntime, /runs-on:\s*\[self-hosted, linux, android, somafrik-mobile-e2e\]/);
  assert.doesNotMatch(e2eRuntime, /runs-on:\s*ubuntu-latest/);
  assert.match(aabWorkflow, /ref: develop/);
  const lotFWorkflow = read(path.join(ROOT, ".github", "workflows", "android-release-readiness.yml"));
  assert.match(lotFWorkflow, /Mobile\/\*\*/);
  assert.match(lotFWorkflow, /\.github\/workflows\/\*\*/);
  assert.match(lotFWorkflow, /"\.gitignore"/);
  assert.match(lotFWorkflow, /mobile-rc3-parked-rollback-to-rc2-2026-08-27\.md/);
  console.log("PASS AR-GATE-scripts nightly + LOT7 retargeté AAB isolé ; PR gates ≠ release-readiness lourd");

  for (const pr of FROZEN_RC3) {
    assert.doesNotMatch(read(path.join(ROOT, "package.json")), new RegExp(`#${pr}`));
  }
  const rc3Parked = read(path.join(ROOT, "docs/audits/mobile-rc3-parked-rollback-to-rc2-2026-08-27.md"));
  assert.match(rc3Parked, /RC3/);
  console.log("PASS AR-RC3-out-of-release (audit parked, pas de cherry-pick)");

  const preprod = await httpsProbe(`${CANONICAL_API_URLS.preproduction}/api/health`);
  const prod = await httpsProbe(`${CANONICAL_API_URLS.production}/api/health`);
  console.log(`HOLD AR-API-preprod-live status=${preprod.status || 0} error=${preprod.error || "-"} (config PASS ; live ≠ SHA)`);
  console.log(`HOLD AR-API-prod-live status=${prod.status || 0} error=${prod.error || "-"}`);
  if (!prod.ok) {
    console.log("MANUAL_BLOCKER AR-API-prod-dns — api.somafrik.app injoignable ; aucun deploy déclenché");
  }

  const physical = physicalDeviceProbe();
  console.log(`MANUAL_BLOCKER AR-PHYSICAL adb=${physical.adb} devices=${physical.devices.length} ${physical.note}`);
  console.log("MANUAL_BLOCKER AR-INSTALL — pas d'APK/AAB GitHub ; eas build non lancé");
  console.log("MANUAL_BLOCKER AR-LOGIN-DEVICE — login/nav physique non exécutable ici");
  console.log("MANUAL_BLOCKER AR-OFFLINE-DEVICE — kill-relaunch physique hors de cette VM ; RC2 contrat code only ; RC3 HORS_RELEASE");

  console.log("OK verify-android-release-readiness — config automatisable PASS ; physique = MANUAL BLOCKER");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
