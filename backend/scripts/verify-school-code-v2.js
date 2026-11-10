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

/**
 * Exceptions **ligne par ligne** exclusivement pour les fixtures de rejet,
 * le seed school_code interne et les audits hors runtime. Toute nouvelle ligne
 * legacy (y compris dans ces fichiers) reste bloquante.
 * Ne jamais placer ici une surface de login publique ou un écran produit.
 */
const LEGACY_TEST_CONTEXT_LINES = new Map([
  [
    "web/src/lib/financeL308PaymentStudent.fixture.ts",
    [
      "export const L308_LEFTOVER_SCHOOL_CODE = \"CD-2026-0001\";"
    ]
  ],
  [
    "backend/lib/monoT1HttpHarness.js",
    [
      "*   école CD-2026-0001 peuplée, école BI-2026-0002 (administrateur seul),",
      "cdAdmin: { identifier: \"admin@unikin.somafrik\", school: \"CD-2026-0001\" },",
      "cdProviseur: { identifier: \"proviseur@somafrik.app\", school: \"CD-2026-0001\" },",
      "cdPrefet: { identifier: \"prefet@somafrik.app\", school: \"CD-2026-0001\" },",
      "cdSecretary: { identifier: \"secretaire@somafrik.app\", school: \"CD-2026-0001\" },",
      "cdParent: { identifier: \"parent.dupont@example.com\", school: \"CD-2026-0001\" },",
      "cdTeacher: { identifier: \"patrick.ilunga@somafrik.cd\", school: \"CD-2026-0001\" },",
      "* l'abonnement réel de la fixture CD-2026-0001 (fin 31-08-2027, données"
    ]
  ],
  [
    "scripts/audit-go-prod-baseline-400.js",
    [
      "const LEFTOVER = \"CD-2026-0001\";",
      "const aliases = snippet(mapUser, '\"ADMIN-CD-2026-0001-01\": \"admin\"');",
      "adminCdAliasPresent: mapUser.includes('\"ADMIN-CD-2026-0001-01\": \"admin\"') && mapUser.includes('\"ADMIN-BI-2026-0001-01\": \"admin-bi\"'),",
      "\"Script HEAD login schoolCode leftover CD-2026-0001\","
    ]
  ],
  [
    "scripts/mono-t1-route-inventory.js",
    [
      "[\"SCHOOL_ADMIN\", \"Admin School\", \"CD-2026-0001\"],",
      "[\"PROVISEUR\", \"Proviseur\", \"CD-2026-0001\"],",
      "[\"PREFET_ETUDES\", \"Préfet des études\", \"CD-2026-0001\"],",
      "[\"SECRETARY\", \"Secrétaire\", \"CD-2026-0001\"],",
      "[\"ACCOUNTANT\", \"Comptable\", \"CD-2026-0001\"],",
      "[\"SUPERVISOR\", \"Surveillant\", \"CD-2026-0001\"],",
      "[\"TEACHER\", \"Enseignant\", \"CD-2026-0001\"],",
      "[\"PARENT\", \"Parent\", \"CD-2026-0001\"],",
      "[\"STUDENT\", \"Élève / Étudiant\", \"CD-2026-0001\"],"
    ]
  ]
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
  assert.doesNotMatch(screen, /code:\s*isGlobal\s*\?\s*"PLATFORM"/);
  assert.doesNotMatch(screen, /PLATFORM-\$\{scope\}/);
  assert.match(screen, /buildPlatformLoginParams\("global"\)/);
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
  const approvedSeen = new Map();
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
      const approvedLines = LEGACY_TEST_CONTEXT_LINES.get(posix);
      if (approvedLines) {
        const expected = new Set(approvedLines);
        assert.equal(expected.size, approvedLines.length, `exception dupliquée : ${posix}`);
        const actualLines = text.split("\\n").filter((line) => line.includes(LEGACY)).map((line) => line.trim());
        const seen = new Set(actualLines);
        for (const line of actualLines) {
          if (!expected.has(line)) hits.push(posix + " : ligne legacy non autorisée : " + line);
        }
        for (const line of approvedLines) {
          assert.ok(seen.has(line), `exception legacy obsolète : ${posix}`);
        }
        approvedSeen.set(posix, true);
        continue;
      }
      const reason = ALLOWLIST.get(posix);
      if (reason) {
        console.log(`allowlist: ${posix} — ${reason}`);
        continue;
      }
      hits.push(posix);
    }
  }


  for (const [posix, approvedLines] of LEGACY_TEST_CONTEXT_LINES) {
    assert.ok(approvedSeen.has(posix), `exceptions non contrôlées ou fichier absent : ${posix} (${approvedLines.length} lignes)`);
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
