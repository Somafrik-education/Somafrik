"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function extractBlock(source, anchor) {
  if (!source) return null;
  const flags = anchor.flags.includes("g") ? anchor.flags : `${anchor.flags}g`;
  const match = new RegExp(anchor.source, flags).exec(source);
  if (!match) return null;
  const open = source.indexOf("{", match.index);
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

function quoted(block, name) {
  if (!block) return null;
  const match = block.match(new RegExp(`\\b${name}\\s+['"]([^'"]+)['"]`));
  return match ? match[1] : null;
}

function numberProp(block, name) {
  if (!block) return null;
  const match = block.match(new RegExp(`\\b${name}\\s*=?\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

function sdkRef(block, name) {
  if (!block) return null;
  const literal = block.match(new RegExp(`\\b${name}\\s*=?\\s*(\\d+)`));
  if (literal) return Number(literal[1]);
  const ext = block.match(new RegExp(`\\b${name}\\s+rootProject\\.ext\\.(\\w+)`));
  if (ext) return { ext: ext[1] };
  return null;
}

function parseExtDefaults(rootGradle) {
  const ext = extractBlock(rootGradle, /ext\s*\{/) || "";
  const values = {};
  const propertyPattern = /(\w+)\s*=\s*(?:Integer\.parseInt\(\s*)?findProperty\('([^']+)'\)\s*\?:\s*'(\d+)'/g;
  let match = propertyPattern.exec(ext);
  while (match) {
    values[match[1]] = { property: match[2], fallback: Number(match[3]) };
    match = propertyPattern.exec(ext);
  }
  const literalPattern = /(\w+)\s*=\s*(\d+)/g;
  match = literalPattern.exec(ext);
  while (match) {
    if (!values[match[1]]) values[match[1]] = { literal: Number(match[2]) };
    match = literalPattern.exec(ext);
  }
  return values;
}

function parseGradleProperties(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    values[match[1].trim()] = match[2].trim();
  }
  return values;
}

function resolveSdk(ref, extDefaults, properties) {
  if (typeof ref === "number") return ref;
  if (!ref || !ref.ext || !extDefaults[ref.ext]) return null;
  const entry = extDefaults[ref.ext];
  if (entry.property && /^\d+$/.test(properties[entry.property] || "")) {
    return Number(properties[entry.property]);
  }
  if (typeof entry.fallback === "number") return entry.fallback;
  if (typeof entry.literal === "number") return entry.literal;
  return null;
}

function parseAndroidIdentity({ appGradle, rootGradle, gradleProperties }) {
  const app = appGradle || "";
  const defaultConfig = extractBlock(app, /defaultConfig\s*\{/) || "";
  const extDefaults = parseExtDefaults(rootGradle || "");
  const properties = parseGradleProperties(gradleProperties || "");
  return {
    packageName: quoted(defaultConfig, "applicationId"),
    versionName: quoted(defaultConfig, "versionName"),
    versionCode: numberProp(defaultConfig, "versionCode"),
    minSdk: resolveSdk(sdkRef(defaultConfig, "minSdkVersion"), extDefaults, properties),
    targetSdk: resolveSdk(sdkRef(defaultConfig, "targetSdkVersion"), extDefaults, properties),
    compileSdk: resolveSdk(
      sdkRef(app, "compileSdkVersion") || sdkRef(app, "compileSdk"),
      extDefaults,
      properties,
    ),
  };
}

function parseReleaseSigning(appGradle) {
  const buildTypes = extractBlock(appGradle, /buildTypes\s*\{/) || "";
  const release = extractBlock(buildTypes, /\brelease\s*\{/) || "";
  const configMatch = release.match(/signingConfig\s+signingConfigs\.(\w+)/);
  const configName = configMatch ? configMatch[1] : null;
  const signingConfigs = extractBlock(appGradle, /signingConfigs\s*\{/) || "";
  const configBlock = configName
    ? extractBlock(signingConfigs, new RegExp(`\\b${configName}\\s*\\{`))
    : null;
  const storeMatch = configBlock
    ? configBlock.match(/storeFile\s+file\(\s*['"]([^'"]+)['"]\s*\)/)
    : null;
  return {
    releaseSigningConfig: configName,
    keyAlias: quoted(configBlock, "keyAlias"),
    storeFileName: storeMatch ? path.posix.basename(storeMatch[1].replace(/\\/g, "/")) : null,
  };
}

function parseKeytoolPrintcert(output) {
  const text = String(output || "");
  const owner = (text.match(/^Owner:\s*(.+)$/m) || [])[1] || null;
  const sha256 = (text.match(/SHA256:\s*([0-9A-F:]+)/i) || [])[1] || null;
  return {
    certificateOwner: owner ? owner.trim() : null,
    certificateSha256: sha256 ? sha256.trim().toUpperCase() : null,
  };
}

function isDebugCertificate(signature) {
  const alias = String(signature.keyAlias || "").trim().toLowerCase();
  const config = String(signature.releaseSigningConfig || "").trim().toLowerCase();
  const store = String(signature.storeFileName || "").trim().toLowerCase();
  const owner = String(signature.certificateOwner || "");
  return alias === "androiddebugkey"
    || config === "debug"
    || store === "debug.keystore"
    || /android debug/i.test(owner);
}

function normalizeSha(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(trimmed) ? trimmed : null;
}

function redact(text) {
  return String(text || "")
    .replace(/storePassword\s+\S+/gi, "storePassword [redacted]")
    .replace(/keyPassword\s+\S+/gi, "keyPassword [redacted]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]");
}

function assertNoSecrets(report) {
  const serialized = JSON.stringify(report);
  if (/storePassword|keyPassword|BEGIN [A-Z ]*PRIVATE KEY/i.test(serialized)) {
    throw new Error("REFUSED: evidence report would contain secret material");
  }
}

function assertNotStoreReady(report) {
  if (report && report.storeReady === true) {
    const error = new Error(
      report.debugCertificate
        ? "REFUSED: debug certificate androiddebugkey cannot be store-ready"
        : "REFUSED: this pipeline does not conclude Play store-ready",
    );
    error.code = "AAB_STORE_READY_REFUSED";
    throw error;
  }
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertComplete(report) {
  const missing = [];
  const identity = report.identity;
  if (!report.candidateSha) missing.push("candidateSha");
  if (!report.toolingSha) missing.push("toolingSha");
  if (report.candidateSha && report.toolingSha && report.candidateSha !== report.toolingSha) {
    missing.push("candidate/tooling SHA mismatch");
  }
  if (!identity.package) missing.push("package");
  if (!identity.versionName) missing.push("versionName");
  if (!Number.isInteger(identity.versionCode)) missing.push("versionCode");
  if (!Number.isInteger(identity.minSdk)) missing.push("minSdk");
  if (!Number.isInteger(identity.targetSdk)) missing.push("targetSdk");
  if (!Number.isInteger(identity.compileSdk)) missing.push("compileSdk");
  if (!report.aab.sha256 || report.aab.sha256.length !== 64) missing.push("sha256");
  if (!(report.aab.sizeBytes > 1000)) missing.push("size");
  if (!report.signature.certificateSha256) missing.push("certificateSha256");
  if (missing.length) {
    throw new Error(`AAB evidence incomplete: ${missing.join(", ")}`);
  }
}

function buildEvidenceReport({
  candidateSha = null,
  toolingSha = null,
  profile,
  aabPath,
  appGradle,
  rootGradle,
  gradleProperties,
  keytoolOutput,
}) {
  const identity = parseAndroidIdentity({ appGradle, rootGradle, gradleProperties });
  const signing = parseReleaseSigning(appGradle);
  const certificate = parseKeytoolPrintcert(keytoolOutput);
  const signature = { ...signing, ...certificate };
  const debugCertificate = isDebugCertificate(signature);
  const stat = fs.statSync(aabPath);
  const report = {
    candidateSha: normalizeSha(candidateSha),
    toolingSha: normalizeSha(toolingSha),
    profile,
    aab: {
      fileName: path.basename(aabPath),
      sizeBytes: stat.size,
      sha256: sha256File(aabPath),
    },
    identity: {
      package: identity.packageName,
      versionName: identity.versionName,
      versionCode: identity.versionCode,
      minSdk: identity.minSdk,
      targetSdk: identity.targetSdk,
      compileSdk: identity.compileSdk,
    },
    signature,
    debugCertificate,
    storeReady: false,
    a1ReproducibleBuild: "PASS",
    a2PlaySignature: "HOLD",
    reason: debugCertificate
      ? "debug certificate androiddebugkey"
      : "Play upload certificate not verified by this pipeline",
  };
  assertComplete(report);
  assertNotStoreReady(report);
  assertNoSecrets(report);
  return report;
}

function readKeytoolCertificate(aabPath, spawn = spawnSync) {
  const result = spawn("keytool", ["-printcert", "-jarfile", aabPath], { encoding: "utf8" });
  if (!result || result.status !== 0) {
    throw new Error(`keytool -printcert failed: ${redact(result && (result.stderr || result.stdout || result.error))}`);
  }
  return result.stdout || "";
}

function evidenceLogLine(report) {
  return [
    `profile=${report.profile}`,
    `candidate=${report.candidateSha}`,
    `package=${report.identity.package}`,
    `versionName=${report.identity.versionName}`,
    `versionCode=${report.identity.versionCode}`,
    `minSdk=${report.identity.minSdk}`,
    `targetSdk=${report.identity.targetSdk}`,
    `compileSdk=${report.identity.compileSdk}`,
    `size=${report.aab.sizeBytes}`,
    `sha256=${report.aab.sha256}`,
    `certSha256=${report.signature.certificateSha256}`,
    `alias=${report.signature.keyAlias}`,
    `debugCertificate=${report.debugCertificate}`,
    `storeReady=${report.storeReady}`,
    `a1=${report.a1ReproducibleBuild}`,
    `a2=${report.a2PlaySignature}`,
  ].join(" ");
}

function writeAabEvidence({
  aabPath,
  profile,
  androidDir,
  evidenceDir,
  candidateSha = null,
  toolingSha = null,
  spawn,
}) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const copiedAab = path.join(evidenceDir, `${profile}-${path.basename(aabPath)}`);
  fs.copyFileSync(aabPath, copiedAab);
  const report = buildEvidenceReport({
    candidateSha,
    toolingSha,
    profile,
    aabPath: copiedAab,
    appGradle: fs.readFileSync(path.join(androidDir, "app", "build.gradle"), "utf8"),
    rootGradle: readIfPresent(path.join(androidDir, "build.gradle")),
    gradleProperties: readIfPresent(path.join(androidDir, "gradle.properties")),
    keytoolOutput: readKeytoolCertificate(copiedAab, spawn),
  });
  const reportPath = path.join(evidenceDir, `${profile}-evidence.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath, aabPath: copiedAab };
}

function readIfPresent(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function assertEvidenceDirectory(dir) {
  const names = fs.readdirSync(dir);
  const reports = names.filter((name) => name.endsWith("-evidence.json"));
  const aabs = names.filter((name) => name.endsWith(".aab"));
  if (reports.length === 0 || aabs.length === 0) {
    throw new Error("AAB evidence artifact incomplete");
  }
  const lines = [];
  for (const name of reports) {
    const report = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    assertNotStoreReady(report);
    assertNoSecrets(report);
    if (report.a2PlaySignature !== "HOLD" || report.storeReady !== false) {
      throw new Error("REFUSED: store-ready conclusion is not allowed");
    }
    lines.push(evidenceLogLine(report));
  }
  return lines;
}

module.exports = {
  assertEvidenceDirectory,
  assertNotStoreReady,
  buildEvidenceReport,
  evidenceLogLine,
  isDebugCertificate,
  parseAndroidIdentity,
  parseKeytoolPrintcert,
  parseReleaseSigning,
  readKeytoolCertificate,
  redact,
  writeAabEvidence,
};

if (require.main === module) {
  try {
    const lines = assertEvidenceDirectory(process.argv[2]);
    for (const line of lines) console.log(line);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
