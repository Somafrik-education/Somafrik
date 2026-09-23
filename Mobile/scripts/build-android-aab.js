/**
 * Build AAB release Android (Somafrik Mobile) — préproduction ou production.
 * Aucun upload Google Play (LOT 7).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { mobileRoot, androidDir, loadBuildEnv, runGradle } = require("./build-android-env");
const { ANDROID_VERSION_CODE } = require("../config/releaseEnvironments");
const { configureUploadSigning, verifySignedBundle } = require("./local-eas-upload-signing");

const profile = process.argv[2] || process.env.EXPO_PUBLIC_RELEASE_PROFILE || "production";
if (profile !== "preproduction" && profile !== "production") {
  console.error("Usage: node scripts/build-android-aab.js <preproduction|production>");
  process.exit(1);
}

const apiUrl = loadBuildEnv(profile);

function runExpoPrebuild() {
  console.log(`Expo prebuild Android --clean (${profile}) pour synchroniser la config canonique...`);
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["expo", "prebuild", "--platform", "android", "--clean", "--no-install"],
    {
      cwd: mobileRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        CI: "1",
        EXPO_PUBLIC_RELEASE_PROFILE: profile,
        EAS_BUILD_PROFILE: profile,
        EXPO_PUBLIC_API_URL: apiUrl,
        EXPO_PUBLIC_DEMO_MODE: "false",
        EXPO_PUBLIC_DEMO_PIN: "",
      },
    },
  );
  if (result.error || result.status !== 0) {
    console.error("Expo prebuild Android echoue.");
    process.exit(result.status ?? 1);
  }
}

function readNativeVersionCode() {
  const gradlePath = path.join(androidDir, "app", "build.gradle");
  assert.ok(fs.existsSync(gradlePath), `build.gradle introuvable: ${gradlePath}`);
  const gradle = fs.readFileSync(gradlePath, "utf8");
  const match = gradle.match(/versionCode\s+(\d+)/);
  assert.ok(match, "versionCode natif introuvable dans android/app/build.gradle");
  return Number(match[1]);
}

runExpoPrebuild();
const nativeVersionCode = readNativeVersionCode();
if (nativeVersionCode !== ANDROID_VERSION_CODE) {
  console.error(
    `HOLD AAB: versionCode natif ${nativeVersionCode} != versionCode canonique ${ANDROID_VERSION_CODE}.`,
  );
  process.exit(1);
}

if (profile === "production") configureUploadSigning(androidDir);

console.log(`Build AAB ${profile} avec API: ${apiUrl}`);
console.log(`versionCode natif/canonique: ${nativeVersionCode}`);
console.log(`JAVA_HOME: ${process.env.JAVA_HOME}`);
console.log(`ANDROID_HOME: ${process.env.ANDROID_HOME}`);
console.log("Gradle bundleRelease en cours (premier build : 5 a 15 min)...");
console.log("");

runGradle("bundleRelease");

const aabPath = path.join(
  androidDir,
  "app",
  "build",
  "outputs",
  "bundle",
  "release",
  "app-release.aab",
);

if (!fs.existsSync(aabPath)) {
  console.error(`AAB introuvable apres build: ${aabPath}`);
  process.exit(1);
}

if (profile === "production") verifySignedBundle(aabPath);

const distDir = path.join(mobileRoot, "dist");
fs.mkdirSync(distDir, { recursive: true });
const stamped = `somafrik-${profile}-v${nativeVersionCode}-${new Date().toISOString().slice(0, 10)}.aab`;
const distAab = path.join(distDir, stamped);
fs.copyFileSync(aabPath, distAab);

console.log("");
console.log(`AAB ${profile} genere (non commite, aucun upload) :`);
console.log(`  ${aabPath}`);
console.log(`  ${distAab}`);
console.log("");
console.log("LOT 7 : ne pas lancer eas submit / Play Console upload.");
