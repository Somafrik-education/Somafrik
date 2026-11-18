#!/usr/bin/env node
/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 2 — registre de traçabilité APK/AAB.
 *
 * Usage :
 *   node scripts/verify-android-artifact-provenance.js <fichier.apk|.aab> --expect-sha <sha40> \
 *     [--channel <canal de distribution>] [--version-code <n>] [--registry <fichier.jsonl>]
 *
 * Produit une entrée « commit → versionCode → versionName → profil → SHA256 → signature → canal »
 * et échoue si le binaire n'embarque pas de provenance, ou un commit différent de celui attendu.
 *
 * - Provenance : `extra.buildProvenance` de `assets/app.config` (APK) ou `base/assets/app.config` (AAB).
 * - versionCode / versionName APK : `aapt2 dump badging` (build-tools Android).
 *   AAB : versionCode distant EAS fourni par --version-code (eas-build.json → appBuildVersion).
 * - Signature : `apksigner verify --print-certs` (APK) ou `keytool -printcert -jarfile` (AAB).
 * Lecture seule : aucune publication, aucun téléversement.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const FULL_SHA = /^[0-9a-f]{40}$/;

function parseArgs(argv) {
  const out = { file: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--expect-sha") { out.expectSha = String(value || "").toLowerCase(); i += 1; }
    else if (key === "--channel") { out.channel = value; i += 1; }
    else if (key === "--version-code") { out.versionCode = value; i += 1; }
    else if (key === "--registry") { out.registry = value; i += 1; }
    else if (!key.startsWith("--") && !out.file) out.file = key;
  }
  return out;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function unzipEntry(file, entry) {
  return execFileSync("unzip", ["-p", file, entry], { maxBuffer: 16 * 1024 * 1024 }).toString("utf8");
}

function buildTool(name) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
  const dir = path.join(sdk, "build-tools");
  if (sdk && fs.existsSync(dir)) {
    const versions = fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const version of versions.reverse()) {
      const candidate = path.join(dir, version, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return name;
}

function readApkBadging(file) {
  const out = execFileSync(buildTool("aapt2"), ["dump", "badging", file], { maxBuffer: 16 * 1024 * 1024 }).toString("utf8");
  const pkg = out.match(/package: name='([^']+)' versionCode='([^']+)' versionName='([^']*)'/);
  return pkg ? { packageName: pkg[1], versionCode: pkg[2], versionName: pkg[3] } : {};
}

function readSignature(file, kind) {
  try {
    if (kind === "apk") {
      const out = execFileSync(buildTool("apksigner"), ["verify", "--print-certs", file]).toString("utf8");
      const dn = out.match(/Signer #1 certificate DN: (.+)/);
      const digest = out.match(/Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/);
      return { subject: dn ? dn[1].trim() : null, sha256: digest ? digest[1] : null };
    }
    const out = execFileSync("keytool", ["-printcert", "-jarfile", file]).toString("utf8");
    const owner = out.match(/Owner: (.+)/);
    const digest = out.match(/SHA256: ([0-9A-F:]+)/);
    return { subject: owner ? owner[1].trim() : null, sha256: digest ? digest[1].replace(/:/g, "").toLowerCase() : null };
  } catch {
    return { subject: null, sha256: null };
  }
}

/** Partie pure, testée : entrée de registre + contrôles. */
function buildRegistryEntry({ kind, file, fileSha256, appConfig, badging = {}, signature = {}, options = {} }) {
  const provenance = appConfig?.extra?.buildProvenance ?? null;
  const versionCode = options.versionCode ?? badging.versionCode ?? appConfig?.android?.versionCode ?? null;
  const entry = {
    artifact: path.basename(file),
    kind,
    gitSha: provenance?.gitSha ?? null,
    gitBranch: provenance?.gitBranch ?? null,
    versionCode: versionCode == null ? null : String(versionCode),
    versionCodeSource: provenance?.versionCodeSource ?? null,
    versionName: badging.versionName ?? appConfig?.version ?? null,
    profile: provenance?.profile ?? appConfig?.extra?.releaseProfile ?? null,
    apiUrl: appConfig?.extra?.apiUrl ?? null,
    packageName: badging.packageName ?? appConfig?.android?.package ?? null,
    sha256: fileSha256,
    signatureSubject: signature.subject ?? null,
    signatureSha256: signature.sha256 ?? null,
    buildChannel: provenance?.channel ?? null,
    easBuildId: provenance?.easBuildId ?? null,
    distributionChannel: options.channel ?? "non distribué",
  };
  const errors = [];
  if (!provenance) errors.push("PROVENANCE_ABSENTE : extra.buildProvenance manquant (binaire antérieur au LOT 2 ?)");
  else if (!FULL_SHA.test(String(provenance.gitSha || ""))) errors.push("SHA_ABSENT : provenance sans commit complet");
  if (options.expectSha && entry.gitSha && entry.gitSha !== options.expectSha) {
    errors.push(`SHA_DIFFERENT : binaire ${entry.gitSha} ≠ attendu ${options.expectSha}`);
  }
  if (!entry.versionCode) errors.push("VERSION_CODE_ABSENT");
  if (/Android Debug/i.test(String(entry.signatureSubject || "")) && /production|play/i.test(String(entry.distributionChannel))) {
    errors.push("SIGNATURE_TEST_SUR_CANAL_PRODUCTION : signature debug interdite pour une distribution Play");
  }
  return { entry, errors };
}

function inspectArtifact(file, options = {}) {
  const kind = file.toLowerCase().endsWith(".aab") ? "aab" : "apk";
  const appConfig = JSON.parse(unzipEntry(file, kind === "aab" ? "base/assets/app.config" : "assets/app.config"));
  const badging = kind === "apk" ? readApkBadging(file) : {};
  return buildRegistryEntry({
    kind,
    file,
    fileSha256: sha256File(file),
    appConfig,
    badging,
    signature: readSignature(file, kind),
    options,
  });
}

module.exports = { buildRegistryEntry, inspectArtifact, parseArgs };

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  if (!options.file) {
    console.error("Usage : verify-android-artifact-provenance.js <apk|aab> --expect-sha <sha40> [--channel …] [--version-code …] [--registry …]");
    process.exit(2);
  }
  try {
    const { entry, errors } = inspectArtifact(options.file, options);
    console.log(JSON.stringify(entry, null, 2));
    if (options.registry) fs.appendFileSync(options.registry, `${JSON.stringify(entry)}\n`);
    if (errors.length) {
      for (const error of errors) console.error(`✗ ${error}`);
      process.exit(1);
    }
    console.log("✔ Provenance Android vérifiée.");
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(2);
  }
}
