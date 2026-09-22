"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertEvidenceDirectory,
  assertNotStoreReady,
  buildEvidenceReport,
  evidenceLogLine,
  parseAndroidIdentity,
  readKeytoolCertificate,
  writeAabEvidence,
} = require("./aabEvidence");

const SHA = "a853c3776d5b61a0b565929e6023396e202fad55";
const SECRET = "s3cret-keystore-pass";

const ROOT_GRADLE = `
ext {
    minSdkVersion = Integer.parseInt(findProperty('android.minSdkVersion') ?: '24')
    compileSdkVersion = Integer.parseInt(findProperty('android.compileSdkVersion') ?: '36')
    targetSdkVersion = Integer.parseInt(findProperty('android.targetSdkVersion') ?: '36')
}
`;

const DEBUG_GRADLE = `
android {
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId 'com.somafrik.app'
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 13
        versionName "1.2.1"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword '${SECRET}'
            keyAlias 'androiddebugkey'
            keyPassword '${SECRET}'
        }
    }
    buildTypes {
        debug { signingConfig signingConfigs.debug }
        release { signingConfig signingConfigs.debug }
    }
}
`;

const UPLOAD_GRADLE = DEBUG_GRADLE
  .replace("keyAlias 'androiddebugkey'", "keyAlias 'upload'")
  .replace("storeFile file('debug.keystore')", "storeFile file('release.keystore')")
  .replace("release { signingConfig signingConfigs.debug }", "release { signingConfig signingConfigs.release }")
  .replace("debug {", "release {");

const DEBUG_CERT = `
Owner: CN=Android Debug, O=Android, C=US
Issuer: CN=Android Debug, O=Android, C=US
SHA256: AA:BB:CC:DD
`;

const UPLOAD_CERT = `
Owner: CN=Somafrik Upload, O=Somafrik, C=FR
SHA256: 11:22:33:44
`;

function tempAab() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aab-evidence-"));
  const aabPath = path.join(dir, "app-release.aab");
  fs.writeFileSync(aabPath, Buffer.alloc(1200, 7));
  return { dir, aabPath };
}

test("identité SDK résolue depuis gradle.properties puis le repli Expo", () => {
  const fromProperties = parseAndroidIdentity({
    appGradle: DEBUG_GRADLE,
    rootGradle: ROOT_GRADLE,
    gradleProperties: "android.minSdkVersion=24\nandroid.compileSdkVersion=35\nandroid.targetSdkVersion=35\n",
  });
  assert.equal(fromProperties.packageName, "com.somafrik.app");
  assert.equal(fromProperties.versionName, "1.2.1");
  assert.equal(fromProperties.versionCode, 13);
  assert.equal(fromProperties.minSdk, 24);
  assert.equal(fromProperties.compileSdk, 35);
  assert.equal(fromProperties.targetSdk, 35);

  const fromFallback = parseAndroidIdentity({
    appGradle: DEBUG_GRADLE,
    rootGradle: ROOT_GRADLE,
    gradleProperties: "",
  });
  assert.equal(fromFallback.compileSdk, 36);
  assert.equal(fromFallback.targetSdk, 36);
  assert.equal(fromFallback.minSdk, 24);
});

test("certificat debug androiddebugkey : A1 passable, store-ready refusé", () => {
  const { aabPath } = tempAab();
  const report = buildEvidenceReport({
    candidateSha: SHA.toUpperCase(),
    toolingSha: SHA,
    profile: "preproduction",
    aabPath,
    appGradle: DEBUG_GRADLE,
    rootGradle: ROOT_GRADLE,
    gradleProperties: "",
    keytoolOutput: DEBUG_CERT,
  });
  assert.equal(report.candidateSha, SHA);
  assert.equal(report.debugCertificate, true);
  assert.equal(report.storeReady, false);
  assert.equal(report.a1ReproducibleBuild, "PASS");
  assert.equal(report.a2PlaySignature, "HOLD");
  assert.equal(report.signature.keyAlias, "androiddebugkey");
  assert.equal(report.signature.storeFileName, "debug.keystore");
  assert.equal(report.signature.releaseSigningConfig, "debug");
  assert.equal(report.signature.certificateSha256, "AA:BB:CC:DD");
  assert.equal(report.aab.sha256, crypto.createHash("sha256").update(fs.readFileSync(aabPath)).digest("hex"));
  assert.equal(report.aab.sizeBytes, 1200);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, new RegExp(SECRET));
  assert.doesNotMatch(serialized, /storePassword|keyPassword/);
  assert.doesNotMatch(evidenceLogLine(report), new RegExp(SECRET));
  assert.throws(() => assertNotStoreReady({ ...report, storeReady: true }), /androiddebugkey/);
});

test("certificat non debug : A2 reste HOLD, store-ready non conclu", () => {
  const { aabPath } = tempAab();
  const report = buildEvidenceReport({
    candidateSha: SHA,
    toolingSha: SHA,
    profile: "production",
    aabPath,
    appGradle: UPLOAD_GRADLE,
    rootGradle: ROOT_GRADLE,
    gradleProperties: "",
    keytoolOutput: UPLOAD_CERT,
  });
  assert.equal(report.debugCertificate, false);
  assert.equal(report.storeReady, false);
  assert.equal(report.a2PlaySignature, "HOLD");
  assert.equal(report.signature.keyAlias, "upload");
  assert.throws(() => assertNotStoreReady({ ...report, storeReady: true }), /does not conclude Play store-ready/);
});

test("candidate SHA et tooling SHA doivent être présents et identiques", () => {
  const { aabPath } = tempAab();
  assert.throws(() => buildEvidenceReport({
    candidateSha: SHA,
    toolingSha: "b".repeat(40),
    profile: "preproduction",
    aabPath,
    appGradle: DEBUG_GRADLE,
    rootGradle: ROOT_GRADLE,
    gradleProperties: "",
    keytoolOutput: DEBUG_CERT,
  }), /candidate\/tooling SHA mismatch/);
});

test("preuve incomplète refuse le rapport", () => {
  const { aabPath } = tempAab();
  assert.throws(() => buildEvidenceReport({
    profile: "preproduction",
    aabPath,
    appGradle: "android { }",
    rootGradle: "",
    gradleProperties: "",
    keytoolOutput: "",
  }), /AAB evidence incomplete/);
});

test("échec keytool ne réimprime pas le secret", () => {
  assert.throws(() => readKeytoolCertificate("app-release.aab", () => ({
    status: 1,
    stderr: `storePassword ${SECRET}\nkeyPassword ${SECRET}`,
    stdout: "",
  })), (error) => {
    assert.match(error.message, /keytool -printcert failed/);
    assert.match(error.message, /storePassword \[redacted\]/);
    assert.doesNotMatch(error.message, new RegExp(SECRET));
    return true;
  });
});

test("writeAabEvidence conserve l'AAB et le rapport hors de android/", () => {
  const { dir, aabPath } = tempAab();
  const androidDir = path.join(dir, "android");
  fs.mkdirSync(path.join(androidDir, "app"), { recursive: true });
  fs.writeFileSync(path.join(androidDir, "app", "build.gradle"), DEBUG_GRADLE);
  fs.writeFileSync(path.join(androidDir, "build.gradle"), ROOT_GRADLE);
  const evidenceDir = path.join(dir, "dist", "aab-evidence");
  const written = writeAabEvidence({
    aabPath,
    profile: "preproduction",
    androidDir,
    evidenceDir,
    candidateSha: SHA,
    toolingSha: SHA,
    spawn: () => ({ status: 0, stdout: DEBUG_CERT, stderr: "" }),
  });
  assert.equal(path.basename(written.aabPath), "preproduction-app-release.aab");
  assert.equal(fs.existsSync(written.aabPath), true);
  assert.equal(fs.existsSync(written.reportPath), true);
  const lines = assertEvidenceDirectory(evidenceDir);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /storeReady=false/);
  assert.match(lines[0], /a2=HOLD/);
  assert.doesNotMatch(lines[0], new RegExp(SECRET));
});

test("le script de prebuild copie la preuve avant suppression et ne soumet pas au store", () => {
  const source = fs.readFileSync(path.join(__dirname, "verify-native-prebuild.js"), "utf8");
  assert.match(source, /SOMAFRIK_AAB_EVIDENCE === "1"/);
  assert.match(source, /writeAabEvidence\(/);
  assert.match(source, /fs\.rmSync\(aab, \{ force: true \}\)/);
  assert.match(source, /aucun eas submit/);
  assert.doesNotMatch(source, /storePassword|keyPassword/);
  assert.doesNotMatch(source, /spawnSync\(\s*["']eas["']/);
});
