/**
 * LOT 4 RED — Issue #695 — complétude optionnelle du school setup.
 *
 * Contrats L4-01 → L4-09. Réutilise LOT 0 (`deriveSchoolSetupStatus`)
 * et LOT 1/2 (widget / auto-open / progression). Aucun runtime LOT 4.
 *
 * Les invariants READY déjà satisfaits peuvent être verts.
 * La section « Complétude recommandée » absente doit rester rouge.
 * Ne pas inverser d'assertion pour forcer du rouge.
 *
 *   npx --yes tsx scripts/verify-school-setup-lot4-red.ts
 *   npm run verify:school-setup-lot4-red
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendStatusPath = path.join(repoRoot, "backend/lib/schoolSetupStatus.js");
const webApiPath = path.join(repoRoot, "web/src/lib/schoolSetupStatusApi.ts");
const mobileApiPath = path.join(repoRoot, "Mobile/src/lib/schoolSetupStatusApi.ts");
const webContractPath = path.join(repoRoot, "web/src/lib/schoolSetupWeb.ts");
const mobileContractPath = path.join(repoRoot, "Mobile/src/lib/schoolSetupMobile.ts");
const webSettingsPagePath = path.join(repoRoot, "web/src/pages/parametres/SchoolSetupSettingsPage.tsx");
const mobileSettingsPath = path.join(repoRoot, "Mobile/src/screens/SchoolSetupSettingsScreen.tsx");
const webSettingsHubPath = path.join(repoRoot, "web/src/pages/parametres/SettingsHubPage.tsx");
const mobileConfigPath = path.join(repoRoot, "Mobile/src/screens/ConfigurationScreen.tsx");

const OPTIONAL_LOT4 = ["periods", "teachers", "students", "feeGrids", "notifications"] as const;
const OPTIONAL_PAYLOAD_KEYS = [
  "periods",
  "subjects",
  "teachers",
  "students",
  "feeGrids",
  "notifications",
] as const;
const SECTION_HEADING = /Complétude recommandée|Pour aller plus loin/;
const CORE_TOTAL = 3;

type SetupStatus = "NOT_STARTED" | "IN_PROGRESS" | "READY";
interface SchoolSetupPayload {
  status: SetupStatus;
  core: { academicYear: boolean; structure: boolean; classes: boolean };
  optional?: Record<string, boolean>;
  progress: { coreDone: number; coreTotal: number };
}

function read(abs: string) {
  return fs.readFileSync(abs, "utf8");
}

function exists(abs: string) {
  return fs.existsSync(abs);
}

function assertHas(source: string, needle: string | RegExp, message: string) {
  const ok = typeof needle === "string" ? source.includes(needle) : needle.test(source);
  assert.ok(ok, message);
}

function assertLacks(source: string, needle: string | RegExp, message: string) {
  const found = typeof needle === "string" ? source.includes(needle) : needle.test(source);
  assert.ok(!found, message);
}

function walkSchoolSetupFiles(dir: string, acc: string[] = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSchoolSetupFiles(full, acc);
      continue;
    }
    if (/schoolSetup/i.test(entry.name) && !/\.test\./.test(entry.name) && !/lot4/i.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function schoolSetupModuleSources() {
  return ["backend", path.join("web", "src"), path.join("Mobile", "src")]
    .flatMap((rel) => walkSchoolSetupFiles(path.join(repoRoot, rel)))
    .map((file) => ({ file, source: read(file) }));
}

function readyAllOptionalFalse(): SchoolSetupPayload {
  return {
    status: "READY",
    core: { academicYear: true, structure: true, classes: true },
    optional: {
      periods: false,
      teachers: false,
      students: false,
      feeGrids: false,
      notifications: false,
    },
    progress: { coreDone: 3, coreTotal: CORE_TOTAL },
  };
}

function mixedOptional(): SchoolSetupPayload {
  return {
    status: "READY",
    core: { academicYear: true, structure: true, classes: true },
    optional: {
      periods: true,
      teachers: false,
      students: true,
      feeGrids: false,
      notifications: false,
    },
    progress: { coreDone: 3, coreTotal: CORE_TOTAL },
  };
}

async function loadWebContract() {
  assert.ok(exists(webContractPath), "web/src/lib/schoolSetupWeb.ts manquant");
  return import(pathToFileURL(webContractPath).href);
}

async function loadMobileContract() {
  assert.ok(exists(mobileContractPath), "Mobile/src/lib/schoolSetupMobile.ts manquant");
  return import(pathToFileURL(mobileContractPath).href);
}

function loadBackendContract() {
  assert.ok(exists(backendStatusPath), "backend/lib/schoolSetupStatus.js manquant");
  return require(backendStatusPath) as {
    deriveSchoolSetupStatus: (raw?: Record<string, unknown>) => SchoolSetupPayload;
  };
}

function assertNamedOptionalType(source: string, client: string) {
  for (const key of OPTIONAL_PAYLOAD_KEYS) {
    assertHas(
      source,
      new RegExp(`${key}\\s*\\??\\s*:\\s*boolean`),
      `${client}: le type optional n'expose pas ${key} (L4-01${key === "subjects" ? ", conserver subjects du contrat backend" : ""})`,
    );
  }
  assertLacks(
    source,
    /optional\?\s*:\s*Record<\s*string\s*,\s*boolean\s*>/,
    `${client}: optional ne doit pas rester un Record<string, boolean> anonyme — nommer periods/subjects/teachers/students/feeGrids/notifications`,
  );
}

function completenessClientSources(pagePath: string, extraDir: string) {
  const parts = [read(pagePath)];
  if (exists(extraDir)) {
    for (const file of walkSchoolSetupFiles(extraDir)) {
      if (/optional|complet|recommend/i.test(path.basename(file))) {
        parts.push(read(file));
      }
    }
  }
  return parts.join("\n");
}

function assertCompletenessSection(source: string, client: string) {
  assertHas(
    source,
    SECTION_HEADING,
    `${client}: section Complétude recommandée / Pour aller plus loin absente`,
  );
  assertHas(source, "payload.optional", `${client}: la section ne lit pas payload.optional`);
  for (const key of OPTIONAL_LOT4) {
    assertHas(source, key, `${client}: élément optionnel ${key} absent de l'écran permanent`);
  }
  assertHas(source, "Configuré", `${client}: état Configuré absent`);
  assertHas(source, "À compléter", `${client}: état À compléter absent`);
}

function isLot4ForbiddenPath(file: string) {
  if (file === "backend/lib/schoolSetupStatus.js") return true;
  if (file.startsWith("backend/")) return true;
  if (file.startsWith("apps/")) return true;
  if (/(^|\/)migrations?\//.test(file) || /\.sql$/.test(file)) return true;
  if (/permissions\.ts$|rbac/i.test(file)) return true;
  return false;
}

function isLot4AllowedFile(file: string) {
  // L4-09 must stay green in RED (tests only) and after a conforming GREEN.
  // Allow planned school-setup Web/Mobile types, helpers, permanent screens,
  // and dedicated components. Keep backend métier, READY formula, SQL, RBAC,
  // CRUD and legacy out of LOT 4.
  if (isLot4ForbiddenPath(file)) return false;
  if (/\.test\./.test(file) || /\.red\.test\.tsx?$/.test(file)) {
    return file.startsWith("web/") || file.startsWith("Mobile/") || file.startsWith("scripts/");
  }
  if (file === "package.json" || file === "Mobile/package.json" || file === "web/package.json") return true;
  if (file === "scripts/verify-school-setup-lot4-red.ts") return true;
  if (file === ".github/workflows/pr-gates.yml") return true;
  const allowedExact = new Set([
    "web/src/lib/schoolSetupStatusApi.ts",
    "web/src/lib/schoolSetupWeb.ts",
    "web/src/pages/parametres/SchoolSetupSettingsPage.tsx",
    "Mobile/src/lib/schoolSetupStatusApi.ts",
    "Mobile/src/lib/schoolSetupMobile.ts",
    "Mobile/src/screens/SchoolSetupSettingsScreen.tsx",
  ]);
  if (allowedExact.has(file)) return true;
  if (file.startsWith("web/src/components/schoolSetup/") && /\.(ts|tsx)$/.test(file)) return true;
  if (file.startsWith("Mobile/src/components/schoolSetup/") && /\.(ts|tsx)$/.test(file)) return true;
  if (/^web\/src\/lib\/schoolSetup[^/]*\.(ts|tsx)$/.test(file)) return true;
  if (/^Mobile\/src\/lib\/schoolSetup[^/]*\.(ts|tsx)$/.test(file)) return true;
  return false;
}

function isLot4GateMetaFile(file: string) {
  return (
    file === "scripts/verify-school-setup-lot4-red.ts" ||
    file === ".github/workflows/pr-gates.yml" ||
    file === "package.json" ||
    file === "Mobile/package.json" ||
    file === "web/package.json"
  );
}

function isLot4ChantierFile(file: string) {
  // PR-wide L4-09 s'applique seulement au chantier « complétude optionnelle ».
  // Un helper school-setup partagé (auto-open, widget) utilisé par un autre lot
  // ne déclenche pas le contrôle de périmètre backend/RBAC.
  if (isLot4GateMetaFile(file)) return false;
  if (file === "backend/lib/schoolSetupStatus.js") return true;
  if (file === "web/src/pages/parametres/SchoolSetupSettingsPage.tsx") return true;
  if (file === "Mobile/src/screens/SchoolSetupSettingsScreen.tsx") return true;
  if (/OptionalCompleteness/i.test(file)) return true;
  if (/schoolSetupOptional/i.test(file)) return true;
  if (/\.lot4\./i.test(file)) return true;
  if (
    (/(^|\/)migrations?\//.test(file) || /\.sql$/.test(file)) &&
    /schoolSetup|school-setup|school_setup/i.test(file)
  ) {
    return true;
  }
  if (file.startsWith("packages/help-catalog/") || file.startsWith("docs/") || file.startsWith("scripts/verify-help")) {
    return false;
  }
  return false;
}

type Lot409Verdict = { kind: "na" | "ok" | "fail"; message: string };

function isGuidedDedicatedFile(file: string) {
  return /schoolSetupGuided/i.test(file);
}

const STUDENT_CARD_PR6_EXACT = new Set([
  "scripts/verify-student-card-web.js",
  "scripts/verify-school-setup-lot4-red.ts",
  "web/package.json",
  "web/package-lock.json",
  "package.json",
  ".github/workflows/pr-gates.yml",
  "web/scripts/verify-student-workspace-shell.ts",
  "web/src/components/students/StudentWorkspaceTabs.tsx",
  "web/src/context/ActiveSchoolContext.tsx",
  "web/src/index.css",
  "web/src/lib/studentWorkspace.ts",
  "web/src/lib/studentWorkspaceNavigation.ts",
  "web/src/pages/parametres/SchoolSetupSettingsPage.tsx",
]);

const STUDENT_CARD_PR8_EXACT = new Set([
  "Mobile/src/lib/nfcSession.ts",
  "Mobile/src/lib/nfcSessionNative.ts",
  "Mobile/src/lib/nfcSession.test.ts",
  "Mobile/app.config.js",
  "Mobile/plugins/withSomafrikAndroidSecurity.js",
  "backend/lib/schoolSettings.studentCard.test.js",
  "docs/audits/GATE-NFC-STORES.md",
]);

const STUDENT_CARD_PR7_EXACT = new Set([
  "scripts/verify-student-card-mobile.js",
  "Mobile/scripts/verify-student-card-qr.js",
  "scripts/verify-school-setup-lot4-red.ts",
  "package.json",
  ".github/workflows/pr-gates.yml",
  "Mobile/app.json",
  "Mobile/package.json",
  "Mobile/package-lock.json",
  "Mobile/scripts/verify-native-prebuild.js",
  "Mobile/scripts/verify-mobile-security.js",
  "Mobile/src/domain/security/permissions.ts",
  "Mobile/src/lib/mobileParentP0.security.test.ts",
  "Mobile/src/lib/mobileParentProfile.audit.red.test.ts",
  "Mobile/src/lib/mobileUsability.ts",
  "Mobile/src/lib/platformSchoolDomainDeny.ts",
  "Mobile/src/lib/superadminSchoolDomain.p1-04.test.ts",
  "Mobile/src/navigation/AppNavigator.tsx",
  "Mobile/src/screens/TeacherAttendanceScreen.tsx",
  "Mobile/src/screens/StudentDetailScreen.tsx",
  "Mobile/plugins/withSomafrikNfcAndroid.js",
  "Mobile/plugins/withSomafrikAndroidSecurity.js",
  "Mobile/app.config.js",
  "backend/db/studentAccessCardsPgStore.js",
  "backend/db/studentAccessCardsSchema.js",
  "backend/db/schema.sql",
  "docs/mobile/NFC-ENCODING-SMOKE.md",
  "docs/mobile/NFC-ENC-01-REVIEW.md",
  "docs/mobile/NFC-RECON-02-REVIEW.md",
  ".github/workflows/nfc-encoding-preprod.yml",
  "scripts/verify-android-release-readiness.js",
  "backend/db/studentCardsNfcSchema.js",
  "backend/db/studentCardsNfcReservationsSchema.js",
  "backend/db/migrations/20261013_student_cards_nfc_reservations.sql",
  // NFC-P0-R2 — additive recovery metadata (same canonical table) and the NFC lock/write guard.
  "backend/db/studentCardsNfcRecoverySchema.js",
  "backend/db/migrations/20261017_student_cards_nfc_recovery.sql",
  "Mobile/scripts/verify-nfc-no-permanent-lock.py",
  "Mobile/scripts/verify-nfc-no-permanent-lock_test.py",
  "docs/mobile/NFC-PROG-02-REVIEW.md",
  "docs/mobile/NFC-PROG-03-REVIEW.md",
  "docs/mobile/NFC-PROG-03-UUID-REVIEW.md",
  "docs/mobile/NFC-PROG-04-REVIEW.md",
  "docs/mobile/NFC-PROG-05-REVIEW.md",
  "docs/mobile/NFC-PROG-05-PHYSICAL-RECIPE.md",
  "Mobile/src/services/safeLogger.ts",
  "Mobile/src/screens/ClassesScreen.tsx",
  "backend/lib/schoolSettings.studentCard.test.js",
  "backend/db/migrations/20261012_student_cards_nfc_encoding.sql",
  "Mobile/src/lib/establishment.ts",
  "Mobile/src/lib/establishment.teacherScope.test.ts",
  "Mobile/src/lib/attendanceClassIdentity.ts",
  "Mobile/src/lib/attendanceClassIdentity.test.ts",
  "Mobile/src/lib/canonicalRoleIdentity.ts",
  "docs/audits/AUDIT-CARTE-01-eleve-presence-nfc-qr-impayes.md",
  "docs/audits/GATE-QR-STORES-camera-qr.md",
  "docs/mobile/PLAY-STORE-DATA-INVENTORY.md",
  "docs/mobile/RELEASE-READINESS.md",
  "docs/mobile/PREVIEW-APK.md",
  "docs/mobile/L10-APK-RC1-SMOKE.md",
  "Mobile/scripts/verify-mobile-preview-apk.js",
  "Mobile/scripts/verify-mobile-preview-apk.test.js",
  "Mobile/config/releaseEnvironments.test.js",
  ".github/workflows/mobile-preview-windows.yml",
  "Mobile/scripts/verify-native-prebuild.test.js",
  "backend/server.js",
  "backend/services/rbacService.js",
  "backend/lib/platformPersonalDataGuard.js",
  "backend/lib/platformPersonalDataGuard.test.js",
  "backend/scripts/verify-student-access-cards.js",
]);

// CARTE-PR3-A1 (#944, GO CTO) : contrôle d'entrée au portail. Fichiers exacts, admis uniquement
// lorsque le diff porte aussi le module du chantier (ancre ci-dessous). Aucun dossier, aucune
// autre migration, aucun autre fichier RBAC : tout le reste demeure FAIL.
const STUDENT_CARD_PR3_A1_ANCHOR = "backend/lib/studentCardEntry.js";
const STUDENT_CARD_PR3_A1_EXACT = new Set([
  "backend/db/migrations/20261016_school_entry_events.sql",
  "backend/db/schoolEntryEventsSchema.js",
  "backend/db/postgresRepository.js",
  "backend/lib/liveSchoolRoleKeys.js",
  "backend/lib/functionalModulesCatalog.js",
  "backend/lib/admin07AdministrationReplay.test.js",
  "web/src/lib/admin07AdministrationReplay.audit.test.ts",
]);

// CARTE-PR3-B (#945, GO CTO) : appel en classe. Fichiers exacts, admis uniquement lorsque le diff
// porte aussi les DEUX ancres du chantier. Aucun dossier, aucune autre migration, aucun autre
// fichier RBAC : tout le reste demeure FAIL.
const STUDENT_CARD_PR3_B_ANCHORS = Object.freeze([
  "backend/lib/studentCardRollCall.js",
  "backend/db/attendanceRollCallsSchema.js",
]);
const STUDENT_CARD_PR3_B_EXACT = new Set([
  "backend/db/migrations/20261016_attendance_roll_calls.sql",
  "backend/db/attendanceRollCallsSchema.js",
  "backend/db/postgresRepository.js",
  "backend/lib/pedagogyService.js",
  "backend/db/pedagogyPgStore.js",
]);

// CARTE-CYCLE-01 (#978, GO CTO du 21-10-2026) : titulaire de carte élève / étudiant. Fichiers exacts,
// admis uniquement lorsque le diff porte aussi les DEUX ancres : le module du chantier et SA
// migration datée (une migration fusionnée n'est jamais réécrite : une PR future qui ne fait que
// modifier studentCardHolder.js ne réactive pas l'exception). Aucun dossier, aucune autre
// migration, aucun fichier RBAC : tout le reste demeure FAIL.
const STUDENT_CARD_CYCLE_01_ANCHORS = Object.freeze([
  "backend/lib/studentCardHolder.js",
  "backend/db/migrations/20261021_school_settings_student_card_holder.sql",
]);
const STUDENT_CARD_CYCLE_01_EXACT = new Set([
  "backend/db/migrations/20261021_school_settings_student_card_holder.sql",
  "backend/db/schoolSettingsMemoryStore.js",
  "backend/db/schoolSettingsPgStore.js",
  "backend/db/schoolSettingsSchema.js",
  "backend/lib/schoolSettingsManagement.js",
  "backend/lib/schoolSettingsService.js",
  "docs/student-card/CARTE-CYCLE-01-titulaire.md",
  "web/src/lib/schoolSettingsApi.ts",
]);

// CARTE-BATCH-API-02 (#984) : préparation et activation des cartes QR par classe.
// Fichiers exacts, admis uniquement lorsque le diff porte les DEUX ancres : le
// module du protocole et SA migration datée. postgresRepository.js n'est admis
// que dans ce couple. Aucune autre migration, aucun autre boot, aucun fichier
// LOT 4 exclusif.
const STUDENT_CARD_BATCH_API_02_ANCHORS = Object.freeze([
  "backend/lib/studentCardBatchIssue.js",
  "backend/db/migrations/20261023_student_card_batches.sql",
]);
const STUDENT_CARD_BATCH_API_02_EXACT = new Set([
  "backend/db/migrations/20261023_student_card_batches.sql",
  "backend/db/studentCardBatchesSchema.js",
  "backend/db/postgresRepository.js",
  "docs/student-card/CARTE-BATCH-API-02-protocole.md",
]);

// CARTE-BATCH-WEB-01 : parcours Web de préparation et d'activation par classe.
// Fichiers hors globs Carte élève admis uniquement avec les DEUX ancres : le
// dialogue et la session qui interdit la réémission automatique. La page
// Classes n'est pas un fichier d'intégration. Aucun backend, aucune migration.
const STUDENT_CARD_BATCH_WEB_01_ANCHORS = Object.freeze([
  "web/src/components/students/StudentCardBatchDialog.tsx",
  "web/src/lib/studentCardBatchSession.ts",
]);
const STUDENT_CARD_BATCH_WEB_01_EXACT = new Set([
  "web/src/pages/etablissement/ClassesListPage.tsx",
  "web/src/pages/etablissement/ClassesListPage.test.tsx",
  "docs/student-card/CARTE-BATCH-WEB-01-parcours.md",
]);

// CARTE-PR3-M1 (#947) : exception pour le menu, uniquement avec les deux ancres exactes.
const STUDENT_CARD_PR3_M1_NAV_FILE = "Mobile/src/navigation/roleDrawerPreferences.ts";
const STUDENT_CARD_PR3_M1_NAV_ANCHORS = Object.freeze([
  "Mobile/src/lib/studentCardEntryControl.ts",
  "Mobile/src/screens/StudentCardEntryControlScreen.tsx",
]);

// NFC-P0-R3-2: the administrator drawer can expose diagnostic only alongside
// these exact mobile-only, read-only implementation anchors (no backend/RBAC/SQL).
const STUDENT_CARD_R3_DIAG_ANCHORS = Object.freeze([
  "Mobile/src/lib/studentCardNfcDiagnosis.ts",
  "Mobile/src/lib/studentCardNfcDiagnosisNative.ts",
  "Mobile/src/screens/StudentCardNfcDiagnosisScreen.tsx",
  "Mobile/src/services/studentCardNfcDiagnosisApi.ts",
]);
const STUDENT_CARD_R3_DIAG_NAV_FILE = "Mobile/src/navigation/AppNavigator.tsx";

function isStudentCardPr6Signal(file: string) {
  return (
    file === "scripts/verify-student-card-web.js" ||
    file === "scripts/verify-student-card-mobile.js" ||
    file === "Mobile/scripts/verify-student-card-qr.js" ||
    /studentCard/i.test(file)
  );
}

// develop already records the historical apksigner fixture fingerprints
// (73da7fe2). The rebase copied that public-cert false positive onto
// 766fe215. Permit *only* those two exact additions after the untouched
// develop file. This must not turn the Carte eleve scope gate into a blanket
// exception for changes to secret-scanner controls.
const NFC_APKSIGNER_TEST_FIXTURE_FINGERPRINTS = new Set([
  "766fe2156312eef613875afe5c3e4dea3b2942eb:Mobile/scripts/verify-student-card-nfc-apk_test.py:generic-api-key:88",
  "766fe2156312eef613875afe5c3e4dea3b2942eb:Mobile/scripts/verify-student-card-nfc-apk_test.py:generic-api-key:90",
]);

function isApprovedNfcFixtureGitleaksIgnore(file: string) {
  if (file !== ".gitleaksignore") return false;
  try {
    const baseline = execFileSync("git", ["show", "origin/develop:.gitleaksignore"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).replace(/\s+$/, "");
    const current = read(path.join(repoRoot, file)).replace(/\s+$/, "");
    // develop's ignore file ends with a blank line; the NFC addition follows
    // the last fingerprint directly. Compare the shared prefix, not the bytes
    // of that trailing newline.
    if (current !== baseline && !current.startsWith(`${baseline}\n`)) return false;
    const added = current
      .slice(baseline.length)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    return added.length === NFC_APKSIGNER_TEST_FIXTURE_FINGERPRINTS.size
      && added.every((line) => NFC_APKSIGNER_TEST_FIXTURE_FINGERPRINTS.has(line))
      && new Set(added).size === added.length;
  } catch {
    return false; // No git base or unrecognized history => fail closed.
  }
}

function isStudentCardPr6IntegrationFile(file: string) {
  if (file === ".gitleaksignore") return isApprovedNfcFixtureGitleaksIgnore(file);
  if (STUDENT_CARD_PR6_EXACT.has(file) || STUDENT_CARD_PR7_EXACT.has(file) || STUDENT_CARD_PR8_EXACT.has(file)) return true;
  if (/^web\/src\/components\/students\/StudentCard[^/]*$/.test(file)) return true;
  if (/^web\/src\/lib\/studentCard[^/]*$/.test(file)) return true;
  if (/^web\/src\/lib\/studentCardsApi[^/]*$/.test(file)) return true;
  if (/^Mobile\/src\/lib\/studentCard[^/]*$/.test(file)) return true;
  if (/^Mobile\/src\/services\/studentCard[^/]*$/.test(file)) return true;
  if (/^Mobile\/src\/screens\/StudentCard[^/]*$/.test(file)) return true;
  if (/^Mobile\/src\/components\/StudentCard[^/]*$/.test(file)) return true;
  if (/^Mobile\/scripts\/verify-student-card[^/]*$/.test(file)) return true;
  if (/^backend\/lib\/studentCard[^/]*$/.test(file)) return true;
  if (/^backend\/lib\/studentAccessCards[^/]*$/.test(file)) return true;
  return false;
}

function isLot4ExclusiveChantierFile(file: string) {
  return (
    isLot4ChantierFile(file) &&
    file !== "web/src/pages/parametres/SchoolSetupSettingsPage.tsx" &&
    file !== "Mobile/src/screens/SchoolSetupSettingsScreen.tsx"
  );
}

function evaluateLot4Scope(changed: readonly string[]): Lot409Verdict {
  // Un changement isolé du menu n'est jamais classé hors périmètre / N/A.
  const navChanged = changed.includes(STUDENT_CARD_PR3_M1_NAV_FILE);
  const navAnchored = STUDENT_CARD_PR3_M1_NAV_ANCHORS.every((anchor) => changed.includes(anchor));
  const r3DiagnosticAnchored = STUDENT_CARD_R3_DIAG_ANCHORS.every((anchor) => changed.includes(anchor))
    && changed.includes(STUDENT_CARD_R3_DIAG_NAV_FILE);
  if (navChanged && !navAnchored && !r3DiagnosticAnchored) {
    return { kind: "fail", message: "L4-09: navigation Contrôle d'entrée sans les deux ancres CARTE-PR3-M1" };
  }
  const guidedDedicated = changed.filter(isGuidedDedicatedFile);
  const exclusiveLot4 = changed.filter(isLot4ExclusiveChantierFile);
  if (guidedDedicated.length > 0 && exclusiveLot4.length === 0) {
    return {
      kind: "na",
      message:
        "L4-09 N/A: chantier guidé distinct (schoolSetupGuided); SchoolSetupSettingsPage peut être orchestré sans activer le périmètre LOT 4.",
    };
  }
  if (changed.some(isStudentCardPr6Signal)) {
    const pr3EntryControl = changed.includes(STUDENT_CARD_PR3_A1_ANCHOR);
    const pr3RollCall = STUDENT_CARD_PR3_B_ANCHORS.every((anchor) => changed.includes(anchor));
    const cardCycle01 = STUDENT_CARD_CYCLE_01_ANCHORS.every((anchor) => changed.includes(anchor));
    const batchApi02 = STUDENT_CARD_BATCH_API_02_ANCHORS.every((anchor) => changed.includes(anchor));
    const batchWeb01 = STUDENT_CARD_BATCH_WEB_01_ANCHORS.every((anchor) => changed.includes(anchor));
    const pr3MobileNav = navChanged && navAnchored;
    const r3DiagnosticNav = navChanged && r3DiagnosticAnchored;
    const outside = changed.filter(
      (file) => !isStudentCardPr6IntegrationFile(file)
        && !(pr3EntryControl && STUDENT_CARD_PR3_A1_EXACT.has(file))
        && !(pr3RollCall && STUDENT_CARD_PR3_B_EXACT.has(file))
        && !(cardCycle01 && STUDENT_CARD_CYCLE_01_EXACT.has(file))
        && !(batchApi02 && STUDENT_CARD_BATCH_API_02_EXACT.has(file))
        && !(batchWeb01 && STUDENT_CARD_BATCH_WEB_01_EXACT.has(file))
        && !(pr3MobileNav && file === STUDENT_CARD_PR3_M1_NAV_FILE)
        && !(r3DiagnosticNav && (file === STUDENT_CARD_PR3_M1_NAV_FILE || file === STUDENT_CARD_R3_DIAG_NAV_FILE)),
    );
    if (outside.length === 0 && exclusiveLot4.length === 0) {
      return {
        kind: "na",
        message:
          "L4-09 N/A: chantier Carte élève distinct; périmètre PR6/PR7 contrôlé, sans fichier LOT 4 exclusif.",
      };
    }
    const leaked = [...new Set([...outside, ...exclusiveLot4])];
    return {
      kind: "fail",
      message: `L4-09: chantier Carte élève hors périmètre contrôlé (backend/migration/RBAC/LOT 4 exclusif): ${leaked.join(", ")}`,
    };
  }
  const chantier = changed.filter(isLot4ChantierFile);
  if (chantier.length === 0) {
    return {
      kind: "na",
      message:
        "L4-09 N/A: aucun fichier school-setup LOT 4 dans le diff; le contrôle de périmètre ne s'applique pas à ce PR.",
    };
  }
  const forbidden = changed.filter((file) => !isLot4AllowedFile(file));
  if (forbidden.length > 0) {
    return {
      kind: "fail",
      message: `LOT 4 hors périmètre (backend/READY/RBAC/CRUD/legacy interdit): ${forbidden.join(", ")}`,
    };
  }
  if (changed.includes("backend/lib/schoolSetupStatus.js")) {
    return {
      kind: "fail",
      message: "deriveSchoolSetupStatus / schoolSetupStatus.js hors LOT 4",
    };
  }
  return {
    kind: "ok",
    message: `L4-09: chantier LOT 4 détecté (${chantier.join(", ")})`,
  };
}

function gitNameOnly(args: string[]) {
  return execFileSync("git", ["diff", "--name-only", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function lot4CommittedFiles() {
  const baseRef = String(process.env.GITHUB_BASE_REF || "develop").replace(/^origin\//, "");
  // Une promotion develop -> main contient volontairement tout l'écart accumulé
  // depuis la dernière release. L4-09 doit contrôler les changements propres au
  // candidat au-dessus de develop, et non requalifier tout cet historique comme
  // un unique chantier LOT 4.
  if (baseRef === "main") {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", "origin/develop", "HEAD"], {
        cwd: repoRoot,
        stdio: "ignore",
      });
      return gitNameOnly(["origin/develop...HEAD"]);
    } catch {
      // Une PR ordinaire vers main qui ne contient pas develop conserve le
      // calcul standard ci-dessous et reste contrôlée contre sa vraie base.
    }
  }
  const bases = [process.env.GITHUB_BASE_SHA, `origin/${baseRef}`, "origin/develop"].filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  );
  const attempts = bases.flatMap((base) => [[`${base}...HEAD`], [base, "HEAD"]]);
  const errors: string[] = [];
  for (const args of attempts) {
    try {
      return gitNameOnly(args);
    } catch (error) {
      errors.push(`${args.join(" ")}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }
  throw new Error(`L4-09: diff vs base indisponible (${errors[0] ?? "aucune base"})`);
}

function lot4ChangedFiles() {
  const committed = lot4CommittedFiles();
  const unstaged = execSync("git diff --name-only", { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const staged = execSync("git diff --cached --name-only", { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const untracked = execSync("git ls-files --others --exclude-standard", {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return [...new Set([...committed, ...unstaged, ...staged, ...untracked])];
}

const cases: { id: string; title: string; run: () => void | Promise<void> }[] = [
  {
    id: "L4-01",
    title: "types Web et Mobile exposent periods, subjects, teachers, students, feeGrids, notifications",
    run() {
      assert.ok(exists(webApiPath), "web/src/lib/schoolSetupStatusApi.ts manquant");
      assert.ok(exists(mobileApiPath), "Mobile/src/lib/schoolSetupStatusApi.ts manquant");
      assertNamedOptionalType(read(webApiPath), "Web");
      assertNamedOptionalType(read(mobileApiPath), "Mobile");
    },
  },
  {
    id: "L4-02",
    title: "READY + cinq optionnels false → status READY, progress 3/3",
    run() {
      const { deriveSchoolSetupStatus } = loadBackendContract();
      const derived = deriveSchoolSetupStatus({
        hasCurrentOrOpenAcademicYear: true,
        activatedLevelCount: 1,
        activatedGroupCount: 1,
        classCount: 1,
        termCount: 0,
        teacherCount: 0,
        studentCount: 0,
        feeGridCount: 0,
        notificationsConfigured: false,
      });
      assert.equal(derived.status, "READY");
      assert.equal(derived.progress.coreDone, 3);
      assert.equal(derived.progress.coreTotal, CORE_TOTAL);
      for (const key of OPTIONAL_LOT4) {
        assert.equal(derived.optional?.[key], false, `${key} doit rester false sans modifier READY`);
      }
    },
  },
  {
    id: "L4-03",
    title: "Web SchoolSetupSettingsPage affiche la complétude recommandée depuis payload.optional",
    run() {
      assert.ok(exists(webSettingsPagePath), "SchoolSetupSettingsPage.tsx manquant");
      assertCompletenessSection(
        completenessClientSources(webSettingsPagePath, path.join(repoRoot, "web/src/components/schoolSetup")),
        "Web",
      );
    },
  },
  {
    id: "L4-04",
    title: "Mobile SchoolSetupSettingsScreen affiche la même complétude depuis payload.optional",
    run() {
      assert.ok(exists(mobileSettingsPath), "SchoolSetupSettingsScreen.tsx manquant");
      assertCompletenessSection(
        completenessClientSources(
          mobileSettingsPath,
          path.join(repoRoot, "Mobile/src/components/schoolSetup"),
        ),
        "Mobile",
      );
    },
  },
  {
    id: "L4-05",
    title: "parité Web/Mobile : même payload → mêmes done/missing, sans autre API",
    async run() {
      const web = await loadWebContract();
      const mobile = await loadMobileContract();
      assert.equal(
        typeof web.schoolSetupOptionalCompleteness,
        "function",
        "Web: schoolSetupOptionalCompleteness manquant — mapping optional.* LOT 4",
      );
      assert.equal(
        typeof mobile.schoolSetupOptionalCompleteness,
        "function",
        "Mobile: schoolSetupOptionalCompleteness manquant — mapping optional.* LOT 4",
      );
      const snap = mixedOptional();
      const webItems = web.schoolSetupOptionalCompleteness(snap);
      const mobileItems = mobile.schoolSetupOptionalCompleteness(snap);
      const asMap = (items: Array<{ id?: string; done?: boolean }>) => {
        const map = new Map<string, boolean>();
        for (const item of items ?? []) {
          if (item?.id) map.set(item.id, Boolean(item.done));
        }
        return map;
      };
      const webMap = asMap(webItems);
      const mobileMap = asMap(mobileItems);
      for (const key of OPTIONAL_LOT4) {
        assert.equal(webMap.get(key), Boolean(snap.optional?.[key]), `Web: ${key} mal classé`);
        assert.equal(mobileMap.get(key), webMap.get(key), `parité Web/Mobile cassée pour ${key}`);
      }
      const joined = `${read(webContractPath)}\n${read(mobileContractPath)}`;
      assertLacks(
        joined,
        /listAcademicYears|getAcademicYears|getEducationCatalog|feeGridsApi|teachersApi/,
        "pas d'agrégation locale pour la complétude optionnelle",
      );
    },
  },
  {
    id: "L4-06",
    title: "READY + optionnels incomplets → pas de widget/auto-open, Paramètres conservé",
    async run() {
      const web = await loadWebContract();
      const mobile = await loadMobileContract();
      const snap = readyAllOptionalFalse();
      const input = { payload: snap, role: "Admin School", mustChangePassword: false };
      assert.equal(web.shouldShowDashboardSetupWidget(input), false, "Web: widget interdit si READY");
      assert.equal(web.shouldAutoOpenSchoolSetupWizard(input), false, "Web: auto-open interdit si READY");
      assert.equal(
        mobile.shouldShowDashboardSetupWidget({ payload: snap, role: "school_admin" }),
        false,
        "Mobile: widget interdit si READY",
      );
      assertHas(read(webSettingsHubPath), "Configuration de l'établissement");
      assertHas(read(mobileConfigPath), /title:\s*["']Configuration de l['’]établissement["']/);
    },
  },
  {
    id: "L4-07",
    title: "progression essentielle = coreDone/coreTotal uniquement",
    async run() {
      const web = await loadWebContract();
      const mobile = await loadMobileContract();
      const snap = mixedOptional();
      assert.equal(web.dashboardSetupProgressLabel(snap), "3 / 3");
      assert.equal(mobile.dashboardSetupProgressLabel(snap), "3 / 3");
      const screens = `${read(webSettingsPagePath)}\n${read(mobileSettingsPath)}`;
      assertHas(screens, "dashboardSetupProgressLabel", "libellé de progression essentielle absent");
      assertLacks(
        screens,
        /coreDone\s*\+\s*|coreTotal\s*\+\s*|optionalDone|\/\s*8|3 \+ /,
        "interdit de mélanger core et optional dans la progression X/3",
      );
    },
  },
  {
    id: "L4-08",
    title: "aucune persistance / snooze serveur pour les états optionnels",
    run() {
      const rows = schoolSetupModuleSources();
      assert.ok(rows.length > 0, "aucun module school setup à inspecter");
      for (const { file, source } of rows) {
        const rel = path.relative(repoRoot, file);
        assertLacks(
          source,
          /localStorage|sessionStorage|AsyncStorage|SecureStore/,
          `${rel}: persistance client des états optionnels interdite`,
        );
        assertLacks(
          source,
          /snooze|dismissed_until|setup_status|optional_status/,
          `${rel}: snooze / setup_status / optional_status interdit`,
        );
      }
    },
  },
  {
    id: "L4-09",
    title: "périmètre LOT 4 : school setup Web/Mobile prévu, pas backend/READY/RBAC",
    run() {
      const forbiddenOnly = evaluateLot4Scope(["backend/lib/schoolSetupStatus.js"]);
      assert.equal(forbiddenOnly.kind, "fail", forbiddenOnly.message);
      const forbiddenSql = evaluateLot4Scope([
        "backend/db/migrations/20260918_school_setup_optional.sql",
      ]);
      assert.equal(forbiddenSql.kind, "fail", forbiddenSql.message);
      const helpSettings = evaluateLot4Scope([
        "packages/help-catalog/src/articles-refresh.js",
        "packages/help-catalog/test/settings.test.js",
        "scripts/verify-help-settings.js",
        "scripts/verify-school-setup-lot4-red.ts",
      ]);
      assert.equal(helpSettings.kind, "na", helpSettings.message);
      const allowedLot4 = evaluateLot4Scope([
        "web/src/lib/schoolSetupWeb.ts",
        "Mobile/src/lib/schoolSetupMobile.ts",
        "web/src/pages/parametres/SchoolSetupSettingsPage.tsx",
      ]);
      assert.equal(allowedLot4.kind, "ok", allowedLot4.message);
      const mixed = evaluateLot4Scope([
        "web/src/lib/schoolSetupWeb.ts",
        "backend/lib/schoolSetupStatus.js",
      ]);
      assert.equal(mixed.kind, "fail", mixed.message);

      const otherLotSharedHelper = evaluateLot4Scope([
        "Mobile/src/lib/schoolSetupMobile.ts",
        "web/src/lib/schoolSetupWeb.ts",
        "backend/lib/educationSchoolCatalogScope.js",
        "backend/server.js",
        "docs/audits/parite-web-mobile-lot1-referentiels-etablissement.md",
      ]);
      assert.equal(
        otherLotSharedHelper.kind,
        "na",
        "un autre lot peut toucher le helper school-setup partagé + son backend hors LOT 4",
      );

      const lot4PlusForeignBackend = evaluateLot4Scope([
        "web/src/pages/parametres/SchoolSetupSettingsPage.tsx",
        "backend/server.js",
      ]);
      assert.equal(lot4PlusForeignBackend.kind, "fail", lot4PlusForeignBackend.message);

      const guidedDistinctChantier = evaluateLot4Scope([
        "web/src/pages/parametres/SchoolSetupSettingsPage.tsx",
        "Mobile/src/screens/SchoolSetupSettingsScreen.tsx",
        "web/src/components/schoolSetup/GuidedSchoolSetupWizard.tsx",
        "web/src/lib/schoolSetupGuidedWeb.ts",
        "Mobile/src/lib/schoolSetupGuidedMobile.ts",
        "backend/lib/schoolSetupGuided.js",
        "backend/db/schoolSetupGuidedSchema.js",
        "backend/services/rbacService.js",
        "backend/server.js",
      ]);
      assert.equal(
        guidedDistinctChantier.kind,
        "na",
        "L4-09: chantier guidé distinct (schoolSetupGuided) doit être N/A même s'il orchestre SchoolSetupSettingsPage",
      );
      assert.equal(lot4PlusForeignBackend.kind, "fail", "vrai LOT 4 + backend doit rester FAIL");

      const studentCardDistinctChantier = evaluateLot4Scope([
        "web/src/pages/parametres/SchoolSetupSettingsPage.tsx",
        "web/src/components/students/StudentCardSettingsSection.tsx",
        "web/src/components/students/StudentCardTab.tsx",
        "web/src/lib/studentCardPolicy.ts",
        "web/src/lib/studentCardsApi.ts",
        "scripts/verify-student-card-web.js",
        "web/package-lock.json",
        "web/src/index.css",
      ]);
      assert.equal(
        studentCardDistinctChantier.kind,
        "na",
        "L4-09: chantier Carte élève distinct doit être N/A dans le périmètre PR6 contrôlé",
      );

      const studentCardPr8DistinctChantier = evaluateLot4Scope([
        "Mobile/src/components/StudentCardNfcScannerModal.tsx",
        "Mobile/src/lib/studentCardNfc.ts",
        "Mobile/src/lib/studentCardNfc.test.ts",
        "Mobile/src/lib/studentCardNfcNative.ts",
        "Mobile/src/lib/nfcSession.ts",
        "Mobile/src/lib/nfcSessionNative.ts",
        "Mobile/src/lib/nfcSession.test.ts",
        "Mobile/src/lib/studentCardScan.ts",
        "Mobile/src/screens/TeacherAttendanceScreen.tsx",
        "Mobile/app.json",
        "Mobile/app.config.js",
        "Mobile/plugins/withSomafrikAndroidSecurity.js",
        "Mobile/package.json",
        "backend/lib/studentCardCapabilities.js",
        "backend/lib/studentCardsNfcLifecycle.js",
        "backend/db/studentCardsNfcReservationsSchema.js",
        "backend/db/migrations/20261013_student_cards_nfc_reservations.sql",
        "docs/mobile/NFC-PROG-02-REVIEW.md",
        "docs/mobile/NFC-PROG-03-REVIEW.md",
        "docs/mobile/NFC-PROG-03-UUID-REVIEW.md",
        "docs/mobile/NFC-PROG-04-REVIEW.md",
        "docs/mobile/NFC-PROG-05-REVIEW.md",
        "docs/mobile/NFC-PROG-05-PHYSICAL-RECIPE.md",
        "Mobile/src/services/safeLogger.ts",
        "Mobile/src/screens/ClassesScreen.tsx",
        "docs/mobile/PLAY-STORE-DATA-INVENTORY.md",
        "docs/audits/GATE-NFC-STORES.md",
      ]);
      assert.equal(
        studentCardPr8DistinctChantier.kind,
        "na",
        "L4-09: chantier Carte élève Mobile (PR8 NFC) doit être N/A dans le périmètre contrôlé",
      );

      const studentCardPr7DistinctChantier = evaluateLot4Scope([
        "Mobile/src/components/StudentCardQrScannerModal.tsx",
        "Mobile/src/lib/studentCardScan.ts",
        "Mobile/src/lib/studentCardScan.test.ts",
        "Mobile/src/services/studentCardScanApi.ts",
        "Mobile/src/screens/TeacherAttendanceScreen.tsx",
        "Mobile/src/lib/establishment.ts",
        "Mobile/src/lib/attendanceClassIdentity.ts",
        "Mobile/src/navigation/AppNavigator.tsx",
        "Mobile/src/domain/security/permissions.ts",
        "Mobile/app.json",
        "Mobile/package.json",
        "Mobile/scripts/verify-student-card-qr.js",
        "docs/audits/GATE-QR-STORES-camera-qr.md",
        "docs/mobile/PLAY-STORE-DATA-INVENTORY.md",
      ]);
      assert.equal(
        studentCardPr7DistinctChantier.kind,
        "na",
        "L4-09: chantier Carte élève Mobile (PR7) doit être N/A dans le périmètre contrôlé",
      );

      const studentCardGitleaksFingerprint = evaluateLot4Scope([
        "Mobile/scripts/verify-student-card-nfc-apk_test.py",
        ".github/workflows/nfc-encoding-preprod.yml",
        ".gitleaksignore",
      ]);
      assert.equal(
        studentCardGitleaksFingerprint.kind,
        "na",
        "L4-09: seules les deux empreintes rebasées du vérificateur APK sont admises après le fichier develop",
      );

      const studentCardPr7PlusBackend = evaluateLot4Scope([
        "Mobile/src/components/StudentCardQrScannerModal.tsx",
        "Mobile/src/lib/studentCardScan.ts",
        "backend/lib/educationSchoolCatalogScope.js",
      ]);
      assert.equal(
        studentCardPr7PlusBackend.kind,
        "fail",
        "L4-09: Carte élève Mobile + backend hors allowlist doit rester FAIL",
      );

      const studentCardPr7Capabilities = evaluateLot4Scope([
        "Mobile/src/components/StudentCardQrScannerModal.tsx",
        "Mobile/src/lib/studentCardScan.ts",
        "Mobile/src/services/studentCardScanApi.ts",
        "Mobile/src/screens/TeacherAttendanceScreen.tsx",
        "Mobile/src/lib/establishment.ts",
        "Mobile/src/lib/attendanceClassIdentity.ts",
        "backend/lib/studentCardCapabilities.js",
        "backend/lib/studentCardCapabilities.test.js",
        "backend/server.js",
        "backend/services/rbacService.js",
        "backend/lib/platformPersonalDataGuard.js",
        "backend/scripts/verify-student-access-cards.js",
      ]);
      assert.equal(
        studentCardPr7Capabilities.kind,
        "na",
        "L4-09: capabilities Carte élève (Présences) autorisées dans le périmètre PR7",
      );

      const studentCardPlusBackend = evaluateLot4Scope([
        "web/src/pages/parametres/SchoolSetupSettingsPage.tsx",
        "web/src/components/students/StudentCardSettingsSection.tsx",
        "web/src/components/students/StudentCardTab.tsx",
        "web/src/lib/studentCardPolicy.ts",
        "web/src/lib/studentCardsApi.ts",
        "backend/lib/educationSchoolCatalogScope.js",
      ]);
      assert.equal(
        studentCardPlusBackend.kind,
        "fail",
        "L4-09: Carte élève + backend hors allowlist doit rester FAIL",
      );

      const studentCardPlusMigration = evaluateLot4Scope([
        "web/src/components/students/StudentCardTab.tsx",
        "web/src/lib/studentCardsApi.ts",
        "backend/db/migrations/20261006_student_cards.sql",
      ]);
      assert.equal(
        studentCardPlusMigration.kind,
        "fail",
        "L4-09: Carte élève + migration SQL doit rester FAIL",
      );

      const studentCardPlusRbac = evaluateLot4Scope([
        "web/src/components/students/StudentCardTab.tsx",
        "web/src/lib/studentCardPolicy.ts",
        "backend/lib/functionalModulesCatalog.js",
      ]);
      assert.equal(
        studentCardPlusRbac.kind,
        "fail",
        "L4-09: Carte élève + catalogue hors allowlist doit rester FAIL",
      );

      // CARTE-PR3-A1 (#944) : diff exact admis ; tout ajout hors liste nominative reste FAIL.
      const pr3A1Files = [
        "backend/lib/studentCardEntry.js",
        "backend/lib/studentCardEntry.test.js",
        "backend/lib/studentCardEntry.http.pg.test.js",
        "backend/db/migrations/20261016_school_entry_events.sql",
        "backend/db/schoolEntryEventsSchema.js",
        "backend/db/postgresRepository.js",
        "backend/lib/liveSchoolRoleKeys.js",
        "backend/lib/functionalModulesCatalog.js",
        "backend/lib/admin07AdministrationReplay.test.js",
        "backend/lib/platformPersonalDataGuard.js",
        "backend/server.js",
        "backend/services/rbacService.js",
        "web/src/lib/admin07AdministrationReplay.audit.test.ts",
        ".github/workflows/nfc-encoding-preprod.yml",
        "scripts/verify-school-setup-lot4-red.ts",
      ];
      assert.equal(evaluateLot4Scope(pr3A1Files).kind, "na", "L4-09: diff exact CARTE-PR3-A1 admis nominativement");
      for (const [extra, label] of [
        ["backend/db/migrations/20261017_other_table.sql", "autre migration"],
        ["backend/db/migrations/20261016_attendance_roll_calls.sql", "migration d'un autre chantier"],
        ["backend/lib/financeManagement.js", "autre fichier backend"],
        ["backend/lib/functionalRbacService.js", "autre fichier RBAC backend"],
        ["web/src/lib/permissions.ts", "fichier RBAC Web"],
        ["backend/db/schema.sql.bak/x.sql", "SQL hors liste"],
      ] as const) {
        assert.equal(
          evaluateLot4Scope([...pr3A1Files, extra]).kind,
          "fail",
          `L4-09: CARTE-PR3-A1 + ${label} (${extra}) doit rester FAIL`,
        );
      }
      for (const pr3Only of [
        "backend/db/migrations/20261016_school_entry_events.sql",
        "backend/db/postgresRepository.js",
        "backend/lib/functionalModulesCatalog.js",
      ]) {
        assert.equal(
          evaluateLot4Scope(["web/src/components/students/StudentCardTab.tsx", "web/src/lib/studentCardsApi.ts", pr3Only]).kind,
          "fail",
          `L4-09: ${pr3Only} sans le module du portail (ancre) doit rester FAIL`,
        );
      }

      // CARTE-CYCLE-01 (#978) : diff exact admis ; tout ajout hors liste reste FAIL, ancres obligatoires.
      const cycle01Files = [
        "backend/lib/studentCardHolder.js",
        "backend/lib/studentCardHolder.test.js",
        "backend/lib/studentCardHolder.http.pg.test.js",
        "backend/db/migrations/20261021_school_settings_student_card_holder.sql",
        "backend/db/schoolSettingsMemoryStore.js",
        "backend/db/schoolSettingsPgStore.js",
        "backend/db/schoolSettingsSchema.js",
        "backend/db/schema.sql",
        "backend/db/studentAccessCardsPgStore.js",
        "backend/lib/schoolSettingsManagement.js",
        "backend/lib/schoolSettingsService.js",
        "backend/lib/studentAccessCardsManagement.js",
        "backend/server.js",
        "docs/student-card/CARTE-CYCLE-01-titulaire.md",
        "web/src/lib/schoolSettingsApi.ts",
        "web/src/lib/studentCardsApi.ts",
        "web/src/components/students/StudentCardTab.tsx",
        ".github/workflows/nfc-encoding-preprod.yml",
      ];
      assert.equal(evaluateLot4Scope(cycle01Files).kind, "na", "L4-09: diff exact CARTE-CYCLE-01 admis nominativement");
      for (const [extra, label] of [
        ["backend/db/migrations/20261022_other_table.sql", "autre migration"],
        ["backend/db/migrations/20261016_school_entry_events.sql", "migration d'un autre chantier"],
        ["backend/lib/schoolSetupStatus.js", "fichier LOT 4 exclusif"],
        ["backend/lib/functionalModulesCatalog.js", "fichier RBAC (exception PR3-A1 non ancrée)"],
        ["backend/lib/financeManagement.js", "autre fichier backend"],
        ["backend/lib/functionalRbacService.js", "autre fichier RBAC backend"],
        ["backend/db/schoolSettingsMemoryStore.test.js", "voisin non listé"],
        ["docs/student-card/CARTE-CYCLE-02.md", "autre document"],
        ["web/src/lib/schoolSettingsApi.test.ts", "autre fichier Web"],
      ]) {
        assert.equal(evaluateLot4Scope([...cycle01Files, extra]).kind, "fail", `L4-09: CARTE-CYCLE-01 + ${label} doit rester FAIL`);
      }
      for (const missingAnchor of STUDENT_CARD_CYCLE_01_ANCHORS) {
        assert.equal(
          evaluateLot4Scope(cycle01Files.filter((file) => file !== missingAnchor)).kind,
          "fail",
          `L4-09: CARTE-CYCLE-01 sans l'ancre ${missingAnchor} doit rester FAIL`,
        );
      }
      // Réutilisation : un futur chantier qui modifie studentCardHolder.js (sans la migration datée)
      // et un fichier school-settings reste FAIL.
      for (const cycle01Only of STUDENT_CARD_CYCLE_01_EXACT) {
        if (STUDENT_CARD_CYCLE_01_ANCHORS.includes(cycle01Only)) continue;
        assert.equal(
          evaluateLot4Scope(["backend/lib/studentCardHolder.js", "web/src/lib/studentCardsApi.ts", cycle01Only]).kind,
          "fail",
          `L4-09: ${cycle01Only} sans la migration ancre CARTE-CYCLE-01 doit rester FAIL`,
        );
        assert.equal(
          evaluateLot4Scope(["web/src/components/students/StudentCardTab.tsx", cycle01Only]).kind,
          "fail",
          `L4-09: ${cycle01Only} sans les ancres CARTE-CYCLE-01 doit rester FAIL`,
        );
      }

      // CARTE-BATCH-API-02 (#984) : diff exact admis ; tout ajout hors liste reste FAIL, ancres obligatoires.
      const batchApi02Files = [
        "backend/db/migrations/20261023_student_card_batches.sql",
        "backend/db/postgresRepository.js",
        "backend/db/studentCardBatchesSchema.js",
        "backend/lib/platformPersonalDataGuard.js",
        "backend/lib/studentAccessCardsManagement.test.js",
        "backend/lib/studentCardBatchIssue.http.pg.test.js",
        "backend/lib/studentCardBatchIssue.js",
        "backend/lib/studentCardBatchIssue.test.js",
        "backend/lib/studentCardBatches.schema.pg.test.js",
        "backend/scripts/verify-student-access-cards.js",
        "backend/server.js",
        "backend/services/rbacService.js",
        "docs/student-card/CARTE-BATCH-API-02-protocole.md",
        "package.json",
        "scripts/verify-school-setup-lot4-red.ts",
      ];
      assert.equal(evaluateLot4Scope(batchApi02Files).kind, "na", "L4-09: diff exact CARTE-BATCH-API-02 admis nominativement");
      for (const [extra, label] of [
        ["backend/db/migrations/20261024_other_table.sql", "autre migration"],
        ["backend/db/migrations/20261021_school_settings_student_card_holder.sql", "migration d'un autre chantier"],
        ["backend/lib/schoolSetupStatus.js", "fichier LOT 4 exclusif"],
        ["backend/lib/financeManagement.js", "autre fichier backend"],
        ["backend/db/connectionConfig.js", "autre fichier de boot"],
        ["docs/student-card/CARTE-BATCH-API-03.md", "autre document"],
      ] as const) {
        assert.equal(
          evaluateLot4Scope([...batchApi02Files, extra]).kind,
          "fail",
          `L4-09: CARTE-BATCH-API-02 + ${label} doit rester FAIL`,
        );
      }
      for (const missingAnchor of STUDENT_CARD_BATCH_API_02_ANCHORS) {
        assert.equal(
          evaluateLot4Scope(batchApi02Files.filter((file) => file !== missingAnchor)).kind,
          "fail",
          `L4-09: CARTE-BATCH-API-02 sans l'ancre ${missingAnchor} doit rester FAIL`,
        );
      }
      for (const batchOnly of STUDENT_CARD_BATCH_API_02_EXACT) {
        if (STUDENT_CARD_BATCH_API_02_ANCHORS.includes(batchOnly)) continue;
        assert.equal(
          evaluateLot4Scope(["backend/lib/studentCardBatchIssue.js", "backend/server.js", batchOnly]).kind,
          "fail",
          `L4-09: ${batchOnly} sans la migration ancre CARTE-BATCH-API-02 doit rester FAIL`,
        );
      }

      // CARTE-BATCH-WEB-01 : diff exact admis ; la page Classes exige les deux ancres.
      const batchWeb01Files = [
        "docs/student-card/CARTE-BATCH-WEB-01-parcours.md",
        "scripts/verify-school-setup-lot4-red.ts",
        "scripts/verify-student-card-web.js",
        "web/src/components/students/StudentCardBatchDialog.test.tsx",
        "web/src/components/students/StudentCardBatchDialog.tsx",
        "web/src/lib/studentCardBatchApi.test.ts",
        "web/src/lib/studentCardBatchApi.ts",
        "web/src/lib/studentCardBatchSession.test.ts",
        "web/src/lib/studentCardBatchSession.ts",
        "web/src/pages/etablissement/ClassesListPage.test.tsx",
        "web/src/pages/etablissement/ClassesListPage.tsx",
      ];
      assert.equal(evaluateLot4Scope(batchWeb01Files).kind, "na", "L4-09: diff exact CARTE-BATCH-WEB-01 admis nominativement");
      for (const [extra, label] of [
        ["backend/lib/financeManagement.js", "fichier backend"],
        ["backend/db/postgresRepository.js", "boot PostgreSQL"],
        ["backend/db/migrations/20261024_other_table.sql", "autre migration"],
        ["web/src/App.tsx", "route hors liste"],
        ["web/src/lib/permissions.ts", "fichier RBAC Web"],
        ["docs/student-card/CARTE-BATCH-WEB-02.md", "autre document"],
      ] as const) {
        assert.equal(
          evaluateLot4Scope([...batchWeb01Files, extra]).kind,
          "fail",
          `L4-09: CARTE-BATCH-WEB-01 + ${label} doit rester FAIL`,
        );
      }
      for (const missingAnchor of STUDENT_CARD_BATCH_WEB_01_ANCHORS) {
        assert.equal(
          evaluateLot4Scope(batchWeb01Files.filter((file) => file !== missingAnchor)).kind,
          "fail",
          `L4-09: CARTE-BATCH-WEB-01 sans l'ancre ${missingAnchor} doit rester FAIL`,
        );
      }
      for (const webOnly of STUDENT_CARD_BATCH_WEB_01_EXACT) {
        assert.equal(
          evaluateLot4Scope(["web/src/lib/studentCardsApi.ts", webOnly]).kind,
          "fail",
          `L4-09: ${webOnly} sans les ancres CARTE-BATCH-WEB-01 doit rester FAIL`,
        );
      }

      // CARTE-PR3-B (#945) : diff exact admis ; tout ajout hors liste nominative reste FAIL.
      const pr3BFiles = [
        ".github/workflows/nfc-encoding-preprod.yml",
        "backend/db/attendanceRollCallsSchema.js",
        "backend/db/migrations/20261016_attendance_roll_calls.sql",
        "backend/db/pedagogyPgStore.js",
        "backend/db/postgresRepository.js",
        "backend/lib/pedagogyService.js",
        "backend/lib/platformPersonalDataGuard.js",
        "backend/lib/studentCardRollCall.http.pg.test.js",
        "backend/lib/studentCardRollCall.js",
        "backend/lib/studentCardRollCall.test.js",
        "backend/server.js",
        "backend/services/rbacService.js",
        "scripts/verify-school-setup-lot4-red.ts",
      ];
      assert.equal(evaluateLot4Scope(pr3BFiles).kind, "na", "L4-09: diff exact CARTE-PR3-B admis nominativement");
      for (const [extra, label] of [
        ["backend/db/migrations/20261017_other_table.sql", "autre migration"],
        ["backend/db/migrations/20261016_school_entry_events.sql", "migration d'un autre chantier (#944)"],
        ["backend/lib/financeManagement.js", "autre fichier backend"],
        ["backend/lib/functionalRbacService.js", "autre fichier RBAC backend"],
        ["backend/lib/functionalModulesCatalog.js", "catalogue RBAC"],
        ["web/src/lib/permissions.ts", "fichier RBAC Web"],
        ["backend/db/schema.sql.bak/x.sql", "SQL hors liste"],
      ] as const) {
        assert.equal(
          evaluateLot4Scope([...pr3BFiles, extra]).kind,
          "fail",
          `L4-09: CARTE-PR3-B + ${label} (${extra}) doit rester FAIL`,
        );
      }
      // Les DEUX ancres sont exigées : une seule ancre ne suffit pas.
      for (const missingAnchor of ["backend/lib/studentCardRollCall.js", "backend/db/attendanceRollCallsSchema.js"]) {
        assert.equal(
          evaluateLot4Scope(pr3BFiles.filter((file) => file !== missingAnchor)).kind,
          "fail",
          `L4-09: CARTE-PR3-B sans l'ancre ${missingAnchor} doit rester FAIL`,
        );
      }
      for (const pr3BOnly of [
        "backend/db/migrations/20261016_attendance_roll_calls.sql",
        "backend/db/postgresRepository.js",
        "backend/lib/pedagogyService.js",
        "backend/db/pedagogyPgStore.js",
      ]) {
        assert.equal(
          evaluateLot4Scope(["web/src/components/students/StudentCardTab.tsx", "web/src/lib/studentCardsApi.ts", pr3BOnly]).kind,
          "fail",
          `L4-09: ${pr3BOnly} sans les ancres PR3-B doit rester FAIL`,
        );
      }

      const r3DiagnosisFiles = [
        ...STUDENT_CARD_R3_DIAG_ANCHORS,
        STUDENT_CARD_R3_DIAG_NAV_FILE,
        STUDENT_CARD_PR3_M1_NAV_FILE,
        "Mobile/package.json",
        ".github/workflows/nfc-encoding-preprod.yml",
      ];
      assert.equal(evaluateLot4Scope(r3DiagnosisFiles).kind, "na", "R3-2 diagnostic complet autorisé");
      for (const missing of STUDENT_CARD_R3_DIAG_ANCHORS) {
        assert.equal(evaluateLot4Scope(r3DiagnosisFiles.filter((f) => f !== missing)).kind, "fail", "R3-2 sans ancre doit rester refusé");
      }
      assert.equal(evaluateLot4Scope([...r3DiagnosisFiles, "backend/lib/financeManagement.js"]).kind, "fail", "R3-2 et backend hors périmètre refusé");

      // CARTE-PR3-M1 : exact menu + DEUX ancres, jamais un catalogue autorisé en bloc.
      const m1NavFiles = [
        "Mobile/src/lib/studentCardEntryControl.ts",
        "Mobile/src/screens/StudentCardEntryControlScreen.tsx",
        STUDENT_CARD_PR3_M1_NAV_FILE,
      ];
      assert.equal(evaluateLot4Scope(m1NavFiles).kind, "na", "M1 navigation + deux ancres autorisés");
      for (const omitted of STUDENT_CARD_PR3_M1_NAV_ANCHORS) {
        assert.equal(evaluateLot4Scope(m1NavFiles.filter((f) => f !== omitted)).kind, "fail", `M1 sans ancre ${omitted} FAIL`);
      }
      assert.equal(evaluateLot4Scope([STUDENT_CARD_PR3_M1_NAV_FILE]).kind, "fail", "modification isolée du menu FAIL");
      assert.equal(evaluateLot4Scope([STUDENT_CARD_PR3_M1_NAV_FILE, "Mobile/src/navigation/AppNavigator.tsx"]).kind, "fail", "catalogue sans ancre FAIL");
      assert.equal(evaluateLot4Scope([...m1NavFiles, "Mobile/src/navigation/rolesUnauthorized.ts"]).kind, "fail", "autre navigation hors liste FAIL");
      assert.equal(evaluateLot4Scope([...m1NavFiles, "backend/db/migrations/20261017_unrelated.sql"]).kind, "fail", "migration hors liste FAIL");

      const lot4PlusStudentCard = evaluateLot4Scope([
        "web/src/pages/parametres/SchoolSetupSettingsPage.tsx",
        "web/src/components/schoolSetup/SchoolSetupOptionalCompleteness.tsx",
        "web/src/components/students/StudentCardTab.tsx",
      ]);
      assert.equal(
        lot4PlusStudentCard.kind,
        "fail",
        "un vrai chantier LOT 4 exclusif reste FAIL même s'il embarque la Carte élève",
      );

      const live = evaluateLot4Scope(lot4ChangedFiles());
      console.log(live.message);
      assert.notEqual(live.kind, "fail", live.message);
    },
  },
];

async function main() {
  const failed: { id: string; title: string; message: string }[] = [];
  const passedIds: string[] = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      passedIds.push(testCase.id);
    } catch (error) {
      failed.push({
        id: testCase.id,
        title: testCase.title,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    `LOT 4 school-setup RED — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`,
  );
  for (const id of passedIds) console.log(`  PASS ${id}`);
  for (const item of failed) {
    console.log(`  FAIL [${item.id}] ${item.title}`);
    console.log(`    ${item.message}`);
  }
  console.log(
    `SCHOOL_SETUP_LOT4_RED ${JSON.stringify({
      passedIds,
      failedIds: failed.map((item) => item.id),
      expectedIds: cases.map((item) => item.id),
    })}`,
  );
  if (failed.length) process.exitCode = 1;
  else console.log("OK: LOT 4 school-setup (contrats GREEN)");
}

void main();
