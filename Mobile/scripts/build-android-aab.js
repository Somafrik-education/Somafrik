/**
 * Build AAB release Android (Somafrik Mobile) — préproduction ou production.
 * Aucun upload Google Play (LOT 7).
 */
const fs = require("fs");
const path = require("path");
const { mobileRoot, androidDir, loadBuildEnv, runGradle } = require("./build-android-env");
const { ANDROID_VERSION_CODE } = require("../config/releaseEnvironments");

const profile = process.argv[2] || process.env.EXPO_PUBLIC_RELEASE_PROFILE || "production";
if (profile !== "preproduction" && profile !== "production") {
  console.error("Usage: node scripts/build-android-aab.js <preproduction|production>");
  process.exit(1);
}

const apiUrl = loadBuildEnv(profile);

console.log(`Build AAB ${profile} avec API: ${apiUrl}`);
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

const distDir = path.join(mobileRoot, "dist");
fs.mkdirSync(distDir, { recursive: true });
const stamped = `somafrik-${profile}-v${ANDROID_VERSION_CODE}-${new Date().toISOString().slice(0, 10)}.aab`;
const distAab = path.join(distDir, stamped);
fs.copyFileSync(aabPath, distAab);

console.log("");
console.log(`AAB ${profile} genere (non commite, aucun upload) :`);
console.log(`  ${aabPath}`);
console.log(`  ${distAab}`);
console.log("");
console.log("LOT 7 : ne pas lancer eas submit / Play Console upload.");
