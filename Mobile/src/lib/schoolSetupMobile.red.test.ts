/**
 * LOT 2 RED — Issue #691 — Mobile Expo parité configuration établissement.
 *
 * Contrats MOB-01 → MOB-08. Doivent échouer tant que le client
 * GET /api/v2/school-setup/status, le widget Hub Scolarité, l'entrée
 * Paramètres et la correction ClassMutationControls sont absents.
 * Ne pas inverser les assertions. Aucune implémentation GREEN dans ce lot.
 * Aucun Web, aucun backend, aucune migration, aucun RBAC.
 *
 *   npx --yes tsx Mobile/src/lib/schoolSetupMobile.red.test.ts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const mobileSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.join(mobileSrc, "..");
const repoRoot = path.join(mobileRoot, "..");

const STATUS_API = "/v2/school-setup/status";
const YEAR_ROUTE = "SchoolYearSettings";
const STRUCTURE_ROUTE = "SchoolPedagogicalStructure";
const CLASSES_ROUTE = "Classes";
const USERS_ROUTE = "Users";
const FORBIDDEN_WEB_COPY = "Configurez-la sur le Web";
const CORE_TOTAL = 3;

const API_PATH = path.join(mobileSrc, "lib/schoolSetupStatusApi.ts");
const CONTRACT_PATH = path.join(mobileSrc, "lib/schoolSetupMobile.ts");
const HUB_PATH = path.join(mobileSrc, "screens/SchoolingHubScreen.tsx");
const CONFIG_PATH = path.join(mobileSrc, "screens/ConfigurationScreen.tsx");
const CLASS_MUTATION_PATH = path.join(mobileSrc, "components/ClassMutationControls.tsx");
const LOGIN_PATH = path.join(mobileSrc, "screens/LoginScreen.tsx");
const AUTH_PATH = path.join(mobileSrc, "context/AuthContext.tsx");

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
    if (/schoolSetup/i.test(entry.name) && !/\.red\.test\./.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function collectLot2Sources() {
  const dedicated = walkSchoolSetupFiles(mobileSrc);
  const always = [HUB_PATH, CONFIG_PATH, CLASS_MUTATION_PATH, LOGIN_PATH, AUTH_PATH, API_PATH, CONTRACT_PATH];
  return [...new Set([...dedicated, ...always])].filter((file) => exists(file)).map((file) => read(file));
}

async function loadContract() {
  assert.ok(
    exists(CONTRACT_PATH),
    "Mobile/src/lib/schoolSetupMobile.ts manquant — mapping UX LOT 2 non implémenté",
  );
  return import(pathToFileURL(CONTRACT_PATH).href);
}

function payload(status: SetupStatus, core: SchoolSetupPayload["core"], coreDone?: number): SchoolSetupPayload {
  const done =
    coreDone ?? [core.academicYear, core.structure, core.classes].filter(Boolean).length;
  return {
    status,
    core,
    progress: { coreDone: done, coreTotal: CORE_TOTAL },
  };
}

function notStarted() {
  return payload("NOT_STARTED", { academicYear: false, structure: false, classes: false }, 0);
}

function inProgressYearOnly() {
  return payload("IN_PROGRESS", { academicYear: true, structure: false, classes: false }, 1);
}

function ready() {
  return payload("READY", { academicYear: true, structure: true, classes: true }, 3);
}

function lot2ChangedFiles() {
  const committed = execSync("git diff --name-only origin/develop...HEAD", {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
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
    id: "MOB-01",
    title: "client GET /v2/school-setup/status sans schoolCode ni agrégation locale",
    async run() {
      assert.ok(exists(API_PATH), "Mobile/src/lib/schoolSetupStatusApi.ts manquant");
      const src = read(API_PATH);
      assertHas(src, STATUS_API, `client Mobile n'appelle pas ${STATUS_API}`);
      assertLacks(src, "school-setup/status/:schoolCode", "path :schoolCode interdit");
      assertLacks(src, /schoolCode\s*[:=]/, "schoolCode client interdit sur school-setup/status");
      assertLacks(
        src,
        /listAcademicYears|getAcademicYears|getEducationCatalog|filterCanonicalClasses|countCanonicalClasses/,
        "pas d'agrégation locale academic years / structure / classes pour le statut",
      );
    },
  },
  {
    id: "MOB-02",
    title: "widget Configuration rapide sur Hub Scolarité selon NOT_STARTED / IN_PROGRESS / READY",
    async run() {
      assert.ok(exists(HUB_PATH), "SchoolingHubScreen.tsx manquant");
      const hub = read(HUB_PATH);
      assertHas(hub, "Configuration rapide", "widget Configuration rapide absent de SchoolingHubScreen");
      assertHas(hub, "Continuer", "widget Hub Scolarité sans CTA Continuer");
      assertHas(
        hub,
        /schoolSetupStatusApi|school-setup\/status/,
        "Hub Scolarité ne consomme pas GET school-setup/status",
      );
      assertHas(
        hub,
        /shouldShowDashboardSetupWidget|SchoolSetupDashboardWidget/,
        "READY: le hub doit décider via shouldShowDashboardSetupWidget",
      );
      const { shouldShowDashboardSetupWidget } = await loadContract();
      assert.equal(
        shouldShowDashboardSetupWidget({ payload: notStarted(), role: "school_admin" }),
        true,
        "NOT_STARTED + school_admin → widget visible",
      );
      assert.equal(
        shouldShowDashboardSetupWidget({ payload: inProgressYearOnly(), role: "school_admin" }),
        true,
        "IN_PROGRESS + school_admin → widget visible",
      );
      assert.equal(
        shouldShowDashboardSetupWidget({ payload: ready(), role: "school_admin" }),
        false,
        "READY + school_admin → widget absent",
      );
      assert.equal(
        shouldShowDashboardSetupWidget({ payload: notStarted(), role: "Admin School" }),
        true,
        "compatibilité affichage Admin School : NOT_STARTED → widget visible",
      );
      assert.equal(
        shouldShowDashboardSetupWidget({ payload: inProgressYearOnly(), role: "Admin School" }),
        true,
        "compatibilité affichage Admin School : IN_PROGRESS → widget visible",
      );
      assert.equal(
        shouldShowDashboardSetupWidget({ payload: ready(), role: "Admin School" }),
        false,
        "compatibilité affichage Admin School : READY → widget absent",
      );
    },
  },
  {
    id: "MOB-03",
    title: "progression widget = progress.coreDone/coreTotal serveur, pas de recomptage local",
    async run() {
      const { dashboardSetupProgressLabel } = await loadContract();
      const snap = inProgressYearOnly();
      const label =
        typeof dashboardSetupProgressLabel === "function"
          ? dashboardSetupProgressLabel(snap)
          : `${snap.progress.coreDone} / ${snap.progress.coreTotal}`;
      assertHas(String(label), /1\s*\/\s*3/, "progression widget doit exposer 1 / 3 depuis progress serveur");
      assert.equal(snap.progress.coreTotal, CORE_TOTAL);
      const sources = collectLot2Sources().join("\n");
      assertLacks(
        sources,
        /coreDone\s*=\s*\[[^\]]*(academicYear|structure|classes)/,
        "recomptage local des booléens core interdit pour la progression widget",
      );
    },
  },
  {
    id: "MOB-04",
    title: "entrée permanente Configuration de l'établissement dans ConfigurationScreen, y compris READY",
    run() {
      assert.ok(exists(CONFIG_PATH), "ConfigurationScreen.tsx manquant");
      const config = read(CONFIG_PATH);
      assertHas(
        config,
        /title:\s*["']Configuration de l['’]établissement["']/,
        "carte Paramètres « Configuration de l'établissement » absente (ne pas compter le sous-titre existant)",
      );
      assertHas(
        config,
        /SchoolSetup|schoolSetup|configuration-etablissement/,
        "la carte permanente ne relie pas l'assistant / le statut canonique",
      );
    },
  },
  {
    id: "MOB-05",
    title: "assistant shell : routes natives, Classes gated par academicYear, aucun CRUD dupliqué",
    async run() {
      const {
        SCHOOL_SETUP_MOBILE_LINKS,
        isSchoolSetupClassesStepEnabled,
        schoolSetupWizardSteps,
      } = await loadContract();
      assert.equal(SCHOOL_SETUP_MOBILE_LINKS?.academicYear, YEAR_ROUTE);
      assert.equal(SCHOOL_SETUP_MOBILE_LINKS?.structure, STRUCTURE_ROUTE);
      assert.equal(SCHOOL_SETUP_MOBILE_LINKS?.classes, CLASSES_ROUTE);
      assert.equal(SCHOOL_SETUP_MOBILE_LINKS?.teachers, USERS_ROUTE);
      assert.equal(
        isSchoolSetupClassesStepEnabled({ academicYear: false, structure: true, classes: false }),
        false,
        "Classes indisponible tant que core.academicYear=false",
      );
      const steps = schoolSetupWizardSteps(notStarted());
      const yearStep = (steps ?? []).find((step: { id?: string }) => step.id === "academicYear");
      const structureStep = (steps ?? []).find((step: { id?: string }) => step.id === "structure");
      const classesStep = (steps ?? []).find((step: { id?: string }) => step.id === "classes");
      const teacherStep = (steps ?? []).find((step: { id?: string }) => step.id === "teachers");
      assert.equal(yearStep?.to, YEAR_ROUTE);
      assert.equal(structureStep?.to, STRUCTURE_ROUTE);
      assert.ok(classesStep, "étape classes absente du shell assistant");
      assert.equal(classesStep.disabled, true);
      assert.equal(classesStep.to, CLASSES_ROUTE);
      assert.equal(teacherStep?.to, USERS_ROUTE);
      const dedicated = walkSchoolSetupFiles(mobileSrc).map((file) => read(file)).join("\n");
      assert.ok(dedicated.length, "shell/widget assistant Mobile schoolSetup manquant");
      assertHas(dedicated, "Plus tard", "assistant sans CTA Plus tard");
      assertLacks(
        dedicated,
        /POST\s+\/teachers|createAcademicYear|academicYearsApi\.create|httpRequest\([^)]*\/v2\/academic-years[^)]*method:\s*["']POST/,
        "CRUD année/enseignants dupliqué dans l'assistant",
      );
      assertLacks(dedicated, /["'`]\/api\/teachers/, "POST /api/teachers interdit");
    },
  },
  {
    id: "MOB-06",
    title: "ClassMutationControls : plus de copy Web ; CTA natif vers SchoolYearSettings",
    run() {
      assert.ok(exists(CLASS_MUTATION_PATH), "ClassMutationControls.tsx manquant");
      const src = read(CLASS_MUTATION_PATH);
      assertLacks(
        src,
        FORBIDDEN_WEB_COPY,
        "copy « Configurez-la sur le Web » encore présente alors que SchoolYearSettings existe nativement",
      );
      assertLacks(src, /sur le Web/, "guidance année scolaire encore déléguée au Web");
      assertHas(
        src,
        /navigate\(\s*["']SchoolYearSettings["']\s*\)/,
        "CTA/navigation native vers SchoolYearSettings absente quand l'année scolaire est absente",
      );
    },
  },
  {
    id: "MOB-07",
    title: "dismiss Plus tard = mémoire de session RAM ; pas AsyncStorage / snooze / setup_status",
    async run() {
      const {
        dismissSchoolSetupWizardForSession,
        isSchoolSetupWizardDismissedThisSession,
        resetSchoolSetupWizardSessionDismiss,
      } = await loadContract();
      resetSchoolSetupWizardSessionDismiss?.();
      assert.equal(isSchoolSetupWizardDismissedThisSession(), false);
      dismissSchoolSetupWizardForSession();
      assert.equal(isSchoolSetupWizardDismissedThisSession(), true);
      const sources = [
        exists(CONTRACT_PATH) ? read(CONTRACT_PATH) : "",
        ...walkSchoolSetupFiles(mobileSrc).map((file) => read(file)),
        exists(LOGIN_PATH) ? read(LOGIN_PATH) : "",
        exists(AUTH_PATH) ? read(AUTH_PATH) : "",
      ].join("\n");
      assertLacks(
        sources,
        /AsyncStorage|localStorage|sessionStorage/,
        "dismiss persisté en storage interdit (MOB-07)",
      );
      assertLacks(sources, /snooze|dismissed_until|setup_status/, "snooze serveur / setup_status interdit");
      assertLacks(sources, /httpRequest\([^)]*school-setup/, "API write school-setup interdite");
      const authSources = `${exists(LOGIN_PATH) ? read(LOGIN_PATH) : ""}\n${exists(AUTH_PATH) ? read(AUTH_PATH) : ""}`;
      assertHas(
        authSources,
        "resetSchoolSetupWizardSessionDismiss",
        "nouvelle authentification doit réinitialiser le dismiss mémoire (pas d'héritage inter-sessions)",
      );
    },
  },
  {
    id: "MOB-08",
    title: "périmètre LOT 2 : aucun Web, backend, migration, RBAC, nouveau CRUD",
    run() {
      const changed = lot2ChangedFiles();
      const forbidden = changed.filter((file) => {
        if (file.startsWith("web/")) return true;
        if (file.startsWith("backend/")) return true;
        if (file.startsWith("apps/")) return true;
        if (/(^|\/)migrations?\//.test(file) || /\.sql$/.test(file)) return true;
        if (/permissions\.ts$|rbac/i.test(file) && !/\.red\.test\./.test(file)) return true;
        return false;
      });
      assert.equal(
        forbidden.length,
        0,
        `LOT 2 ne doit pas toucher Web/backend/DB/RBAC: ${forbidden.join(", ")}`,
      );
      const runtimeSchoolSetup = walkSchoolSetupFiles(mobileSrc);
      const joined = runtimeSchoolSetup.map((file) => read(file)).join("\n");
      if (joined) {
        assertLacks(
          joined,
          /POST\s+["'`]\/api\/teachers|httpRequest\([^)]*\/teachers[^)]*method:\s*["']POST/,
          "nouveau CRUD enseignants interdit",
        );
      }
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
    `LOT 2 Mobile school-setup RED — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`,
  );
  for (const id of passedIds) console.log(`  PASS ${id}`);
  for (const item of failed) {
    console.log(`  FAIL [${item.id}] ${item.title}`);
    console.log(`    ${item.message}`);
  }
  console.log(
    `SCHOOL_SETUP_MOBILE_LOT2_RED ${JSON.stringify({
      passedIds,
      failedIds: failed.map((item) => item.id),
      expectedIds: cases.map((item) => item.id),
    })}`,
  );
  if (failed.length) process.exitCode = 1;
  else console.log("OK: LOT 2 Mobile school-setup (contrats GREEN)");
}

void main();
