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
const { evidenceLogLine, writeAabEvidence } = require("./aabEvidence");
const { resolveSpawn } = require("./verify-mobile-preview-apk");

const MOBILE = path.join(__dirname, "..");
const ANDROID = path.join(MOBILE, "android");
const IOS = path.join(MOBILE, "ios");
const CANONICAL_CAMERA_PERMISSION =
  "Somafrik utilise l’appareil photo pour prendre la photo du compte et scanner les cartes élève par QR code.";
const CANONICAL_NFC_PERMISSION =
  "Somafrik utilise la puce NFC pour lire la carte élève de l’établissement.";

const PROFILE_API_ENV_KEYS = {
  development: "EXPO_PUBLIC_API_URL_DEV",
  preview: "EXPO_PUBLIC_API_URL_PREVIEW",
  preproduction: "EXPO_PUBLIC_API_URL_PREPRODUCTION",
  production: "EXPO_PUBLIC_API_URL_PRODUCTION",
};

function prebuildEnvForProfile(profile) {
  const apiUrl = CANONICAL_API_URLS[profile];
  const profileApiKey = PROFILE_API_ENV_KEYS[profile];
  const env = {
    CI: "1",
    EXPO_PUBLIC_RELEASE_PROFILE: profile,
    EAS_BUILD_PROFILE: profile,
    EXPO_PUBLIC_API_URL: apiUrl,
    EXPO_PUBLIC_DEMO_MODE: "false",
    EXPO_PUBLIC_DEMO_PIN: "",
  };
  if (profileApiKey && apiUrl) {
    env[profileApiKey] = apiUrl;
  }
  return env;
}

function mergeSpawnEnv(overlay, parentEnv = process.env) {
  return { ...parentEnv, ...(overlay || {}) };
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function resolveAndroidSdk() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function run(command, args, options = {}) {
  const resolved = resolveSpawn(command, args);
  const result = spawnSync(resolved.command, resolved.args, {
    encoding: "utf8",
    cwd: options.cwd || MOBILE,
    env: mergeSpawnEnv(options.env, process.env),
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
  return [...manifest.matchAll(/<uses-permission(?:-sdk-23)?\b([^>]*)\/?>/g)].map((match) => match[1] || "");
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
  const granted = permissions.filter((attr) => !isRemovedPermission(attr)).map(permissionName);
  assert.ok(names.includes("android.permission.INTERNET") || granted.includes("android.permission.INTERNET"), `${profile}: INTERNET manquant`);
  assert.ok(granted.includes("android.permission.CAMERA"), `${profile}: CAMERA manquant`);
  assert.ok(granted.includes("android.permission.NFC"), `${profile}: NFC manquant`);
  const nfcPermissionAttrs = permissions.filter((attr) => permissionName(attr) === "android.permission.NFC");
  assert.ok(
    nfcPermissionAttrs.every((attr) => !isRemovedPermission(attr)),
    `${profile}: NFC a tools:node=remove`,
  );

  const featureBlocks = [...manifest.matchAll(/<uses-feature\b([^>]*)\/?>/g)].map((match) => match[1] || "");
  const nfcFeatures = featureBlocks.filter((block) => /android:name="android\.hardware\.nfc"/.test(block));
  assert.ok(nfcFeatures.length > 0, `${profile}: uses-feature android.hardware.nfc manquant`);
  assert.ok(
    nfcFeatures.every((block) => /android:required="false"/.test(block)),
    `${profile}: android.hardware.nfc required doit être false`,
  );
  assert.ok(
    nfcFeatures.every((block) => !/android:required="true"/.test(block)),
    `${profile}: android.hardware.nfc required=true interdit`,
  );

  const sdk = readAndroidSdkVersions();
  assert.ok(Number.isInteger(sdk.compileSdk) && sdk.compileSdk >= 31, `${profile}: compileSdk ${sdk.compileSdk} < 31`);
  assert.ok(
    Number.isInteger(sdk.minSdk) && sdk.minSdk < 31,
    `${profile}: STOP — minSdk relevé à ${sdk.minSdk} (interdit ; contrainte NFC = compileSdk >= 31)`,
  );
  for (const blocked of [
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.READ_CONTACTS",
    "android.permission.CALL_PHONE",
  ]) {
    assert.ok(!granted.includes(blocked), `${profile}: ${blocked} accordé (interdit)`);
  }

  const mustRemove = [
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.WRITE_EXTERNAL_STORAGE",
  ];
  for (const name of mustRemove) {
    const matching = permissions.filter((attr) => permissionName(attr) === name);
    assert.ok(
      matching.length > 0,
      `${profile}: ${name} doit rester tools:node=remove dans le manifeste app `
        + "(sinon le merge Gradle réinjecte le grant expo-file-system / libs)",
    );
    assert.ok(
      matching.every(isRemovedPermission),
      `${profile}: ${name} accordé dans le manifeste app (interdit)`,
    );
    assert.ok(!granted.includes(name), `${profile}: ${name} accordé (interdit)`);
  }

  for (const attr of permissions) {
    const name = permissionName(attr);
    if (
      name === "android.permission.RECORD_AUDIO"
      || mustRemove.includes(name)
    ) {
      assert.ok(isRemovedPermission(attr), `${profile}: ${name} doit être tools:node=remove`);
    }
    if (isRemovedPermission(attr)) continue;
    if (name === "android.permission.POST_NOTIFICATIONS" || name === "android.permission.VIBRATE") {
      continue;
    }
    if (name === "android.permission.NFC") continue;
    assert.notEqual(name, "android.permission.ACCESS_FINE_LOCATION", `${profile}: localisation présente`);
  }

  const extraManifests = collectAndroidManifests(ANDROID).filter((file) => file !== manifestPath);
  for (const extra of extraManifests) {
    const extraManifest = read(extra);
    const extraGranted = permissionLines(extraManifest)
      .filter((attr) => !isRemovedPermission(attr))
      .map(permissionName);
    for (const name of mustRemove) {
      assert.ok(
        !extraGranted.includes(name),
        `${profile}: ${name} accordé dans ${path.relative(MOBILE, extra)}`,
      );
    }
  }

  console.log(
    `PROOF ${profile}: CAMERA granted ; NFC granted ; hardware.nfc required=false ; `
      + `compileSdk=${sdk.compileSdk} minSdk=${sdk.minSdk} ; READ_MEDIA_IMAGES not granted ; `
      + `READ/WRITE_EXTERNAL_STORAGE tools:node=remove`
      + ` (${ANDROID_PACKAGE} / ${expectedName} / versionCode ${versionCode} / HTTPS / backup off)`,
  );
  console.log(`OK: prebuild ${profile} — ${ANDROID_PACKAGE} / ${expectedName} / versionCode ${versionCode} / HTTPS / backup off`);
  return { versionCode, compileSdk: sdk.compileSdk, minSdk: sdk.minSdk };
}

function readAndroidSdkVersions() {
  const props = fs.existsSync(path.join(ANDROID, "gradle.properties"))
    ? read(path.join(ANDROID, "gradle.properties"))
    : "";
  const rootGradle = fs.existsSync(path.join(ANDROID, "build.gradle"))
    ? read(path.join(ANDROID, "build.gradle"))
    : "";
  const appGradle = read(path.join(ANDROID, "app", "build.gradle"));
  const minSdk = Number(
    (props.match(/android\.minSdkVersion\s*=\s*(\d+)/) || [])[1]
    || (rootGradle.match(/minSdkVersion[^\n]*?:\s*'(\d+)'/) || [])[1]
    || (appGradle.match(/minSdk(?:Version)?\s+(\d+)/) || [])[1]
    || NaN,
  );
  const compileSdk = Number(
    (props.match(/android\.compileSdkVersion\s*=\s*(\d+)/) || [])[1]
    || (rootGradle.match(/compileSdkVersion[^\n]*?:\s*'(\d+)'/) || [])[1]
    || (appGradle.match(/compileSdk(?:Version)?\s+(\d+)/) || [])[1]
    || NaN,
  );
  return { minSdk, compileSdk };
}

function findIosInfoPlist() {
  const found = [];
  if (!fs.existsSync(IOS)) return found;
  const stack = [IOS];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "Pods" || entry.name === "build") continue;
        stack.push(full);
      } else if (entry.name === "Info.plist") {
        found.push(full);
      }
    }
  }
  return found;
}

function findIosEntitlements() {
  const found = [];
  if (!fs.existsSync(IOS)) return found;
  const stack = [IOS];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "Pods" || entry.name === "build") continue;
        stack.push(full);
      } else if (entry.name.endsWith(".entitlements")) {
        found.push(full);
      }
    }
  }
  return found;
}

function inspectGeneratedIos() {
  const plists = findIosInfoPlist();
  assert.ok(plists.length > 0, "iOS: Info.plist manquant après prebuild");
  let cameraOk = false;
  let nfcOk = false;
  for (const file of plists) {
    const plist = read(file);
    if (plist.includes("NSCameraUsageDescription")) {
      assert.ok(
        plist.includes(CANONICAL_CAMERA_PERMISSION),
        `${path.relative(MOBILE, file)}: NSCameraUsageDescription doit être la chaîne duale`,
      );
      cameraOk = true;
    }
    if (plist.includes("NFCReaderUsageDescription")) {
      assert.ok(
        plist.includes(CANONICAL_NFC_PERMISSION),
        `${path.relative(MOBILE, file)}: NFCReaderUsageDescription doit être la chaîne figée`,
      );
      nfcOk = true;
    }
    assert.doesNotMatch(plist, /NSUserTrackingUsageDescription/, `${path.relative(MOBILE, file)}: tracking interdit`);
    assert.doesNotMatch(
      plist,
      /NSMicrophoneUsageDescription/,
      `${path.relative(MOBILE, file)}: microphone scanner interdit`,
    );
    assert.doesNotMatch(plist, /iso7816/i, `${path.relative(MOBILE, file)}: ISO7816 interdit`);
    assert.doesNotMatch(plist, /felica/i, `${path.relative(MOBILE, file)}: FeliCa interdit`);
  }
  assert.ok(cameraOk, "iOS: NSCameraUsageDescription absente");
  assert.ok(nfcOk, "iOS: NFCReaderUsageDescription absente");

  const entitlements = findIosEntitlements();
  assert.ok(entitlements.length > 0, "iOS: fichier entitlements manquant après prebuild");
  let ndefOk = false;
  for (const file of entitlements) {
    const content = read(file);
    if (content.includes("com.apple.developer.nfc.readersession.formats")) {
      assert.match(content, /NDEF/, `${path.relative(MOBILE, file)}: entitlement NDEF manquant`);
      assert.doesNotMatch(content, /iso7816/i, `${path.relative(MOBILE, file)}: ISO7816 interdit`);
      assert.doesNotMatch(content, /felica/i, `${path.relative(MOBILE, file)}: FeliCa interdit`);
      ndefOk = true;
    }
  }
  assert.ok(ndefOk, "iOS: entitlement NFC NDEF manquant");
  console.log("PROOF ios: NSCameraUsageDescription duale ; NFCReaderUsageDescription ; entitlement NDEF ; pas de tracking");
}

function prebuildIos() {
  console.log("prebuild ios --clean");
  run("npx", ["expo", "prebuild", "--platform", "ios", "--clean", "--no-install"], {
    env: prebuildEnvForProfile("production"),
  });
  inspectGeneratedIos();
}

function collectAndroidManifests(root) {
  const found = [];
  if (!fs.existsSync(root)) return found;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "build" || entry.name === ".gradle") continue;
        stack.push(full);
      } else if (entry.name === "AndroidManifest.xml") {
        found.push(full);
      }
    }
  }
  return found;
}

function prebuildProfile(profile) {
  const apiUrl = CANONICAL_API_URLS[profile];
  const profileApiKey = PROFILE_API_ENV_KEYS[profile];
  console.log(`prebuild android --clean (${profile})`);
  const env = prebuildEnvForProfile(profile);
  if (profileApiKey && apiUrl) {
    assert.equal(env[profileApiKey], apiUrl);
  }
  assert.equal(env.EXPO_PUBLIC_API_URL, apiUrl);
  run(
    "npx",
    ["expo", "prebuild", "--platform", "android", "--clean", "--no-install"],
    { env },
  );
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

  const mergedManifests = collectAndroidManifests(path.join(ANDROID, "app", "build")).concat(
    collectAndroidManifests(path.join(ANDROID, "app", "src")),
  );
  for (const file of mergedManifests) {
    const granted = permissionLines(read(file))
      .filter((attr) => !isRemovedPermission(attr))
      .map(permissionName);
    assert.ok(
      !granted.includes("android.permission.READ_MEDIA_IMAGES"),
      `${label}: READ_MEDIA_IMAGES encore accordé après merge Gradle (${path.relative(MOBILE, file)})`,
    );
    assert.ok(
      !granted.includes("android.permission.READ_EXTERNAL_STORAGE"),
      `${label}: READ_EXTERNAL_STORAGE encore accordé après merge Gradle (${path.relative(MOBILE, file)})`,
    );
    assert.ok(
      !granted.includes("android.permission.WRITE_EXTERNAL_STORAGE"),
      `${label}: WRITE_EXTERNAL_STORAGE encore accordé après merge Gradle (${path.relative(MOBILE, file)})`,
    );
    if (granted.includes("android.permission.CAMERA")) {
      console.log(
        `PROOF ${label} merged: CAMERA granted ; READ_MEDIA_IMAGES absent ; `
          + `READ/WRITE_EXTERNAL_STORAGE absent ${path.relative(MOBILE, file)}`,
      );
    }
  }

  const aabs = listAabs();
  assert.ok(aabs.length > 0, `${label}: aucun .aab sous android/app/build/outputs/bundle/release/`);
  const keepEvidence = process.env.SOMAFRIK_AAB_EVIDENCE === "1";
  for (const aab of aabs) {
    const stat = fs.statSync(aab);
    assert.ok(stat.size > 1000, `${label}: AAB trop petit (${aab})`);
    if (keepEvidence) {
      const evidenceDir = process.env.SOMAFRIK_AAB_EVIDENCE_DIR
        || path.join(MOBILE, "dist", "aab-evidence");
      const written = writeAabEvidence({
        aabPath: aab,
        profile: label,
        androidDir: ANDROID,
        evidenceDir,
        candidateSha: process.env.SOMAFRIK_CANDIDATE_SHA || null,
        toolingSha: process.env.SOMAFRIK_TOOLING_SHA || process.env.GITHUB_SHA || null,
      });
      console.log(evidenceLogLine(written.report));
      console.log(`OK: AAB evidence ${written.reportPath} — storeReady=false, aucun upload`);
    }
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
  prebuildIos();
  fs.rmSync(IOS, { recursive: true, force: true });
  console.log("OK: android/ et ios/ régénérés puis supprimés (CNG, non commité)");
}

module.exports = {
  runNativeProof,
  inspectGeneratedAndroid,
  prebuildProfile,
  PROFILE_API_ENV_KEYS,
  prebuildEnvForProfile,
  mergeSpawnEnv,
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
