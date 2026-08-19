/**
 * LOT 7 P0-2 — prebuild Android réel + inspection native.
 * Optionnellement compile un AAB si ANDROID_HOME est présent (ou exigé).
 *
 * Usage :
 *   node scripts/verify-native-prebuild.js
 *   SOMAFRIK_REQUIRE_AAB=1 node scripts/verify-native-prebuild.js
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  ANDROID_PACKAGE,
  CANONICAL_API_URLS,
  DISPLAY_NAMES,
} = require("../config/releaseEnvironments");

const MOBILE = path.join(__dirname, "..");
const ANDROID = path.join(MOBILE, "android");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function resolveAndroidSdk() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
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

function permissionLines(manifest) {
  return [...manifest.matchAll(/<uses-permission\b([^>]*)\/?>/g)].map((match) => match[1] || "");
}

function permissionName(attrBlock) {
  const match = attrBlock.match(/android:name="([^"]+)"/);
  return match ? match[1] : "";
}

function isRemovedPermission(attrBlock) {
  return /tools:node="remove"/.test(attrBlock);
}

function inspectGeneratedAndroid(profile) {
  const manifestPath = path.join(ANDROID, "app", "src", "main", "AndroidManifest.xml");
  const gradlePath = path.join(ANDROID, "app", "build.gradle");
  const stringsPath = path.join(ANDROID, "app", "src", "main", "res", "values", "strings.xml");
  const networkPath = path.join(ANDROID, "app", "src", "main", "res", "xml", "network_security_config.xml");
  for (const file of [manifestPath, gradlePath, stringsPath, networkPath]) {
    assert.ok(fs.existsSync(file), `${profile}: natif manquant (${path.relative(MOBILE, file)})`);
  }

  const gradle = read(gradlePath);
  assert.match(gradle, new RegExp(`applicationId ['"]${ANDROID_PACKAGE}['"]`));
  assert.match(gradle, /versionCode\s+\d+/);
  const versionCode = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1]);
  assert.ok(Number.isInteger(versionCode) && versionCode > 0, `${profile}: versionCode invalide`);

  const strings = read(stringsPath);
  const expectedName = DISPLAY_NAMES[profile];
  assert.match(strings, new RegExp(`<string name="app_name">${expectedName}</string>`));

  const manifest = read(manifestPath);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);

  const network = read(networkPath);
  assert.match(network, /cleartextTrafficPermitted="false"/);

  const permissions = permissionLines(manifest);
  const names = permissions.map(permissionName);
  assert.ok(names.includes("android.permission.INTERNET"), `${profile}: INTERNET manquant`);
  assert.ok(names.includes("android.permission.CAMERA"), `${profile}: CAMERA manquant`);
  assert.ok(names.includes("android.permission.READ_MEDIA_IMAGES"), `${profile}: READ_MEDIA_IMAGES manquant`);

  for (const attr of permissions) {
    const name = permissionName(attr);
    if (name === "android.permission.RECORD_AUDIO") {
      assert.ok(isRemovedPermission(attr), `${profile}: RECORD_AUDIO doit être tools:node=remove`);
    }
    assert.notEqual(name, "android.permission.POST_NOTIFICATIONS", `${profile}: POST_NOTIFICATIONS présent`);
    assert.notEqual(name, "android.permission.NFC", `${profile}: NFC présent`);
    assert.notEqual(name, "android.permission.ACCESS_FINE_LOCATION", `${profile}: localisation présente`);
  }

  console.log(`OK: prebuild ${profile} — ${ANDROID_PACKAGE} / ${expectedName} / versionCode ${versionCode} / HTTPS / backup off`);
  return { versionCode };
}

function prebuildProfile(profile) {
  const apiUrl = CANONICAL_API_URLS[profile];
  console.log(`prebuild android --clean (${profile})`);
  run("npx", ["expo", "prebuild", "--platform", "android", "--clean", "--no-install"], {
    env: {
      CI: "1",
      EXPO_PUBLIC_RELEASE_PROFILE: profile,
      EAS_BUILD_PROFILE: profile,
      EXPO_PUBLIC_API_URL: apiUrl,
      EXPO_PUBLIC_DEMO_MODE: "false",
      EXPO_PUBLIC_DEMO_PIN: "",
    },
  });
  return inspectGeneratedAndroid(profile);
}

function listAabs() {
  const dir = path.join(ANDROID, "app", "build", "outputs", "bundle", "release");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".aab")).map((name) => path.join(dir, name));
}

function profilesNeedingAab() {
  if (process.env.SOMAFRIK_AAB_PROFILES) {
    return process.env.SOMAFRIK_AAB_PROFILES.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (process.env.SOMAFRIK_REQUIRE_AAB === "1") return ["preproduction"];
  if (resolveAndroidSdk()) return ["preproduction"];
  return [];
}

function bundleReleaseAab(label) {
  const sdkDir = resolveAndroidSdk();
  if (!sdkDir) {
    throw new Error(
      `SDK Android absent pour compiler l'AAB ${label}. `
        + "buildType=app-bundle n'est PAS une preuve. "
        + "Installer le SDK (job CI Mobile AAB preproduction) ou lancer "
        + "`eas build --platform android --profile preproduction` (aucun eas submit).",
    );
  }

  process.env.ANDROID_HOME = sdkDir;
  process.env.ANDROID_SDK_ROOT = sdkDir;
  fs.writeFileSync(path.join(ANDROID, "local.properties"), `sdk.dir=${sdkDir.replace(/\\/g, "/")}\n`);

  const wrapper = process.platform === "win32" ? "gradlew.bat" : "gradlew";
  assert.ok(fs.existsSync(path.join(ANDROID, wrapper)), "gradlew absent après prebuild");
  console.log(`Gradle bundleRelease (${label}) ANDROID_HOME=${sdkDir}`);
  run(process.platform === "win32" ? "gradlew.bat" : "./gradlew", ["bundleRelease", "--no-daemon"], {
    cwd: ANDROID,
  });

  const aabs = listAabs();
  assert.ok(aabs.length > 0, `${label}: aucun .aab sous android/app/build/outputs/bundle/release/`);
  for (const aab of aabs) {
    const stat = fs.statSync(aab);
    assert.ok(stat.size > 1000, `${label}: AAB trop petit (${aab})`);
    console.log(`OK: AAB réel ${label} ${aab} (${stat.size} octets) — non commité, aucun upload`);
    fs.rmSync(aab, { force: true });
  }
  return aabs;
}

function runNativeProof() {
  const aabProfiles = profilesNeedingAab();
  fs.rmSync(ANDROID, { recursive: true, force: true });

  prebuildProfile("preview");
  console.log("OK: config native preview inspectée (APK interne, pas d'AAB Play)");

  prebuildProfile("preproduction");
  if (aabProfiles.includes("preproduction")) {
    bundleReleaseAab("preproduction");
  } else {
    console.log(
      "AAB Gradle préprod non exécuté (pas de SDK Android). "
        + "La preuve compilation est le job CI « Mobile AAB preproduction » ou un EAS Build preproduction. "
        + "eas.json buildType=app-bundle n'est pas une preuve.",
    );
  }

  prebuildProfile("production");
  if (aabProfiles.includes("production")) {
    bundleReleaseAab("production");
  } else {
    console.log("OK: config native production inspectée");
  }

  fs.rmSync(ANDROID, { recursive: true, force: true });
  console.log("OK: android/ régénéré puis supprimé (CNG, non commité)");
}

module.exports = {
  runNativeProof,
  inspectGeneratedAndroid,
  prebuildProfile,
};

if (require.main === module) {
  try {
    runNativeProof();
    console.log("verify-native-prebuild OK");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
