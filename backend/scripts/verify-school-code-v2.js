"use strict";

/**
 * Gate anti-régression — code établissement V2 (CD-IN-26-001).
 *
 * Interdit CD-2026-0001 sur les surfaces runtime. Les tests de rejet
 * legacy, la doc historique et l'alias interne seed (school_code) sont
 * allowlistés un par un.
 *
 * Usage : npm run verify:school-code-v2
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  formatSchoolLoginCode,
  isLegacySchoolCodeFormat,
  isV2SchoolLoginCode,
  validateSchoolCode,
} = require("../lib/schoolCodeV2");

const ROOT = path.resolve(__dirname, "../..");
const LEGACY = "CD-2026-0001";
const V2_FIRST = "CD-IN-26-001";
const V2_NEXT = "CD-IN-26-002";
const SOURCE_EXT = new Set([".js", ".jsx", ".cjs", ".mjs", ".ts", ".tsx"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".expo",
  "android",
  "ios",
  "coverage",
  ".next",
]);

/** Allowlist exacte — chaque entrée est justifiée. */
const ALLOWLIST = new Map([
  [
    "backend/lib/schoolCodeV2.js",
    "message d'erreur de rejet création legacy",
  ],
  [
    "backend/lib/schoolModule.js",
    "message d'erreur de rejet création legacy",
  ],
  [
    "backend/db/fallbackRepository.js",
    "message d'erreur de rejet création legacy",
  ],
  [
    "backend/data.js",
    "alias interne school_code du seed mémoire ; loginCode public = CD-IN-26-001",
  ],
  [
    "backend/db/postgresRepository.js",
    "alias user_code historiques (ADMIN-CD-2026-0001-01), pas une génération login_code",
  ],
  [
    "backend/scripts/verify-school-code-v2.js",
    "ce gate cite le token interdit pour le scanner",
  ],
  [
    "docs/project/SCHOOL-CODE-V2.md",
    "contrat historique : explique pourquoi CD-2026-0001 est legacy",
  ],
  [
    "docs/project/IDENTIFIER-CONTRACT.md",
    "contrat identifiants — section School code V2 / legacy",
  ],
  [
    "docs/project/DECISIONS.md",
    "ADR School code V2",
  ],
  [
    "docs/project/CURRENT-SETTINGS-INVENTORY.md",
    "inventaire paramètres — format legacy documenté comme remplacé",
  ],
  [
    "scripts/e2e-cleanup-rules.js",
    "protection e2e du tenant seed (school_code interne historique + login_code V2) — aucune génération",
  ],
]);

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function isTestFile(file) {
  const name = path.basename(file);
  return (
    /\.test\.(js|ts|tsx)$/.test(name) ||
    /\.spec\.(js|ts|tsx)$/.test(name) ||
    /\/__tests__\//.test(file.split(path.sep).join("/"))
  );
}

function isHistoricalDoc(file) {
  const posix = rel(file);
  return posix.startsWith("docs/") && posix.endsWith(".md");
}

function assertGenerator() {
  assert.equal(
    formatSchoolLoginCode({
      countryIso: "CD",
      schoolName: "Institut Nuru",
      year: 2026,
      sequence: 1,
    }),
    V2_FIRST,
  );
  assert.equal(
    formatSchoolLoginCode({
      countryIso: "CD",
      schoolName: "Institut Nuru",
      year: 2026,
      sequence: 2,
    }),
    V2_NEXT,
  );
  assert.equal(isV2SchoolLoginCode(V2_FIRST), true);
  assert.equal(isV2SchoolLoginCode(LEGACY), false);
  assert.equal(isLegacySchoolCodeFormat(LEGACY), true);
  assert.throws(
    () => validateSchoolCode(LEGACY, { forCreation: true }),
    (error) => error.code === "SCHOOL_CODE_LEGACY_FORBIDDEN",
  );
  const src = fs.readFileSync(path.join(ROOT, "backend/lib/schoolCodeV2.js"), "utf8");
  assert.doesNotMatch(src, /INSTITUT NURU/);
  console.log(`OK: générateur ${V2_FIRST} → ${V2_NEXT} ; création ${LEGACY} refusée`);
}

function assertRoleSelectionSource() {
  const screen = fs.readFileSync(
    path.join(ROOT, "Mobile/src/screens/RoleSelectionScreen.tsx"),
    "utf8",
  );
  assert.match(screen, /useState\(""\)/);
  assert.match(screen, /useState<SchoolInfo \| null>\(null\)/);
  assert.doesNotMatch(screen, /useState\(["']CD-2026-0001["']\)/);
  assert.doesNotMatch(screen, /code:\s*["']CD-2026-0001["']/);
  assert.match(screen, /PLATFORM-\$\{scope\}/);
  assert.match(screen, /disabled=\{isLoading \|\| !accessCode\.trim\(\)\}/);
  const spec = fs.readFileSync(
    path.join(ROOT, "Mobile/src/lib/loginScreenSpec.ts"),
    "utf8",
  );
  assert.match(spec, /placeholderExample:\s*"CD-IN-26-001"/);
  assert.doesNotMatch(spec, /CD-2026-0001/);
  console.log("OK: RoleSelectionScreen accessCode === \"\" ; school === null");
}

function scanRuntimeSurfaces() {
  const roots = [
    path.join(ROOT, "Mobile/src"),
    path.join(ROOT, "web/src"),
    path.join(ROOT, "backend"),
    path.join(ROOT, "scripts"),
  ];
  const hits = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (!SOURCE_EXT.has(path.extname(file))) continue;
      const posix = rel(file);
      if (isTestFile(file)) continue;
      if (posix.startsWith("backend/scripts/verify-") && posix !== "backend/scripts/verify-school-code-v2.js") {
        continue;
      }
      if (posix.startsWith("web/scripts/verify-")) continue;
      if (posix.startsWith("scripts/verify-")) continue;
      if (posix.startsWith("scripts/repair-")) continue;
      const text = fs.readFileSync(file, "utf8");
      if (!text.includes(LEGACY)) continue;
      const reason = ALLOWLIST.get(posix);
      if (reason) {
        console.log(`allowlist: ${posix} — ${reason}`);
        continue;
      }
      hits.push(posix);
    }
  }

  for (const [posix, reason] of ALLOWLIST) {
    if (isHistoricalDoc(posix) || posix.startsWith("docs/")) continue;
    const full = path.join(ROOT, posix);
    if (!fs.existsSync(full)) {
      throw new Error(`allowlist orpheline: ${posix} (${reason})`);
    }
  }

  assert.deepEqual(
    hits,
    [],
    `CD-2026-0001 interdit en runtime:\n- ${hits.join("\n- ")}`,
  );
  console.log("OK: 0 occurrence runtime CD-2026-0001 (hors allowlist explicite)");
}

function assertCiWired() {
  const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const security = fs.readFileSync(path.join(ROOT, ".github/workflows/security.yml"), "utf8");
  const pkg = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
  const release = fs.readFileSync(
    path.join(ROOT, "Mobile/scripts/verify-mobile-release-readiness.js"),
    "utf8",
  );
  assert.match(pkg, /"verify:school-code-v2"/);
  assert.doesNotMatch(pkg, /verify:school-code-v2[^"]*\|\| true/);
  assert.match(ci, /name: verify:school-code-v2/);
  assert.match(ci, /npm run verify:school-code-v2/);
  assert.doesNotMatch(ci, /verify:school-code-v2[\s\S]{0,80}continue-on-error:\s*true/);
  assert.match(security, /name: verify:school-code-v2/);
  assert.match(security, /npm run verify:school-code-v2/);
  assert.doesNotMatch(security, /verify:school-code-v2[\s\S]{0,80}continue-on-error:\s*true/);
  assert.match(release, /CD-2026-0001/);
  assert.match(release, /assert\.doesNotMatch\(bundle, \/CD-2026-0001\/\)/);
  console.log("OK: CI + Security branchent verify:school-code-v2 (fail-closed)");
}

function main() {
  assertGenerator();
  assertRoleSelectionSource();
  scanRuntimeSurfaces();
  assertCiWired();
  console.log("verify:school-code-v2 OK");
}

main();
