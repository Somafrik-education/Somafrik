/**
 * RED — assistant guidé Mobile Expo (équivalents W1–W10 + M11–M13).
 *
 *   npx --yes tsx Mobile/src/lib/schoolSetupGuidedMobile.red.test.ts
 *
 * Aucune implémentation GREEN. Ne pas inverser les assertions.
 * LOT 2 (checklist 3 core) reste intact.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const mobileSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.join(mobileSrc, "..");
const repoRoot = path.join(mobileRoot, "..");

const CONTRACT_PATH = path.join(mobileSrc, "lib/schoolSetupGuidedMobile.ts");
const API_PATH = path.join(mobileSrc, "lib/schoolSetupGuidedApi.ts");
const WIZARD_PATH = path.join(mobileSrc, "components/schoolSetup/GuidedSchoolSetupWizard.tsx");
const CARD_PATH = path.join(mobileSrc, "components/schoolSetup/GuidedSchoolSetupDashboardCard.tsx");
const WELCOME_PATH = path.join(mobileSrc, "screens/SchoolSetupWelcomeScreen.tsx");
const SETTINGS_PATH = path.join(mobileSrc, "screens/SchoolSetupSettingsScreen.tsx");
const HOME_PATH = path.join(mobileSrc, "screens/HomeScreen.tsx");
const LOGIN_PATH = path.join(mobileSrc, "screens/LoginScreen.tsx");
const STUDENTS_PATH = path.join(mobileSrc, "screens/StudentsScreen.tsx");
const NAV_PATH = path.join(mobileSrc, "navigation/AppNavigator.tsx");

const GUIDED_API = "/v2/school-setup/guided";
const GUIDED_STEP_KEYS = [
  "establishment",
  "academicYear",
  "structure",
  "subjects",
  "teachers",
  "students",
  "finance",
  "pedagogy",
  "communication",
  "users",
] as const;

function exists(abs: string) {
  return fs.existsSync(abs);
}

function read(abs: string) {
  return fs.readFileSync(abs, "utf8");
}

function assertHas(source: string, needle: string | RegExp, message: string) {
  const ok = typeof needle === "string" ? source.includes(needle) : needle.test(source);
  assert.ok(ok, message);
}

function assertLacks(source: string, needle: string | RegExp, message: string) {
  const found = typeof needle === "string" ? source.includes(needle) : needle.test(source);
  assert.ok(!found, message);
}

async function loadContract() {
  assert.ok(exists(CONTRACT_PATH), "Mobile/src/lib/schoolSetupGuidedMobile.ts manquant");
  return import(pathToFileURL(CONTRACT_PATH).href);
}

function guidedPayload(percent: number, overrides: Record<string, unknown> = {}) {
  const completedCount = percent / 10;
  const completedSteps = GUIDED_STEP_KEYS.slice(0, completedCount);
  const currentStep = Math.min(10, completedCount + 1);
  const nextKey = percent >= 100 ? null : GUIDED_STEP_KEYS[currentStep - 1];
  return {
    schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    status: percent >= 60 ? "operational" : "configuration_required",
    percent,
    currentStep: percent >= 100 ? 10 : currentStep,
    lastValidStep: completedCount,
    nextStepKey: nextKey,
    nextStepLabel:
      nextKey === "students" ? "Élèves" : nextKey === "subjects" ? "Matières" : nextKey ?? null,
    completedSteps,
    steps: GUIDED_STEP_KEYS.map((key, index) => ({
      key,
      index: index + 1,
      label: key,
      done: index < completedCount,
      unlocked: index <= completedCount,
    })),
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

const cases: { id: string; title: string; run: () => void | Promise<void> }[] = [
  {
    id: "M-SRC",
    title: "sources wizard / API / bienvenue / carte existent",
    run() {
      assert.ok(exists(API_PATH), "schoolSetupGuidedApi.ts manquant");
      assert.ok(exists(WIZARD_PATH), "GuidedSchoolSetupWizard.tsx manquant");
      assert.ok(exists(CARD_PATH), "GuidedSchoolSetupDashboardCard.tsx manquant");
      assert.ok(exists(WELCOME_PATH), "SchoolSetupWelcomeScreen.tsx manquant");
      const api = read(API_PATH);
      assertHas(api, GUIDED_API, `client n'appelle pas ${GUIDED_API}`);
      assertLacks(api, /schoolCode\s*[:=]/, "schoolCode interdit sur le client guidé");
      const wizard = read(WIZARD_PATH);
      assertHas(wizard, "Configuration de votre établissement", "titre wizard mobile manquant");
      assertHas(wizard, "Enregistrer et continuer", "CTA Enregistrer et continuer manquant");
      assertHas(wizard, "Précédent", "CTA Précédent manquant");
      assertHas(wizard, "Quitter et reprendre plus tard", "CTA quitter manquant");
      assertHas(wizard, "testID", "testID navigation/progression manquants");
      assertHas(read(WELCOME_PATH), "Bienvenue sur Somafrik", "bienvenue mobile manquante");
      assertHas(read(WELCOME_PATH), "Configurer mon établissement", "CTA bienvenue manquant");
      assertHas(read(NAV_PATH), "SchoolSetupWelcome", "route native SchoolSetupWelcome absente");
    },
  },
  {
    id: "M1",
    title: "school_admin non configuré voit Configurer mon établissement",
    async run() {
      const { shouldShowSchoolSetupWelcome } = await loadContract();
      assert.equal(
        shouldShowSchoolSetupWelcome({
          payload: guidedPayload(0),
          role: "school_admin",
          mustChangePassword: false,
        }),
        true,
      );
      assertHas(read(WELCOME_PATH), "Configurer mon établissement", "M1 CTA manquant");
      assertHas(
        read(LOGIN_PATH),
        /shouldShowSchoolSetupWelcome|SchoolSetupWelcome/,
        "Login mobile ne relie pas la bienvenue guidée",
      );
    },
  },
  {
    id: "M2",
    title: "wizard affiche Étape X sur 10",
    async run() {
      const { guidedStepHeading } = await loadContract();
      assert.equal(guidedStepHeading(1), "Étape 1 sur 10");
      assert.equal(guidedStepHeading(10), "Étape 10 sur 10");
      assertHas(read(WIZARD_PATH), "sur 10", "M2 Étape X sur 10 manquant");
    },
  },
  {
    id: "M3",
    title: "pourcentage déterministe = étapes valides × 10",
    async run() {
      const { guidedProgressLabel } = await loadContract();
      assert.equal(guidedProgressLabel(guidedPayload(40)), "Configuration 40 % terminée");
      assert.equal(guidedProgressLabel(guidedPayload(60)), "Configuration 60 % terminée");
    },
  },
  {
    id: "M4",
    title: "Enregistrer et continuer persiste via l'API guidée",
    run() {
      const wizard = read(WIZARD_PATH);
      assertHas(wizard, "Enregistrer et continuer", "M4 CTA manquant");
      assertHas(wizard, /schoolSetupGuidedApi|completeStep/, "M4 sans persist API");
    },
  },
  {
    id: "M5",
    title: "Précédent ne détruit pas l'avancement sauvegardé",
    run() {
      const wizard = read(WIZARD_PATH);
      assertHas(wizard, "Précédent", "M5 CTA manquant");
      assertLacks(wizard, /completedSteps\s*=\s*\[\]/, "M5 reset interdit");
    },
  },
  {
    id: "M6",
    title: "Quitter et reprendre plus tard quitte sans perdre l'avancement",
    run() {
      assertHas(read(WIZARD_PATH), "Quitter et reprendre plus tard", "M6 CTA manquant");
    },
  },
  {
    id: "M7",
    title: "carte Accueil affiche la prochaine étape",
    async run() {
      const { shouldShowGuidedSetupDashboardCard, guidedNextStepLabel } = await loadContract();
      const payload = guidedPayload(50, { nextStepKey: "students", nextStepLabel: "Élèves" });
      assert.equal(shouldShowGuidedSetupDashboardCard({ payload, role: "school_admin" }), true);
      assert.equal(guidedNextStepLabel(payload), "Élèves");
      assertHas(read(CARD_PATH), "Prochaine étape", "M7 libellé manquant");
      assertHas(read(HOME_PATH), "GuidedSchoolSetupDashboardCard", "M7 carte absente de HomeScreen");
    },
  },
  {
    id: "M8",
    title: "reprise ouvre l'étape serveur",
    async run() {
      const { guidedResumeStep } = await loadContract();
      assert.equal(guidedResumeStep(guidedPayload(40)), 5);
      assertHas(read(SETTINGS_PATH), /GuidedSchoolSetupWizard|schoolSetupGuidedApi/, "M8 settings n'ouvre pas le guidé");
    },
  },
  {
    id: "M9",
    title: "inscription Élève reste Classe → Élève",
    run() {
      const students = read(STUDENTS_PATH);
      const wizard = exists(WIZARD_PATH) ? read(WIZARD_PATH) : "";
      assertHas(students, "Inscrire un élève", "M9 CTA classe manquant");
      assertLacks(students, /Ajouter Élève|Ajouter un élève/, "M9 bouton global interdit");
      assertLacks(wizard, /Ajouter Élève|POST\s+\/students["'`]/, "M9 wizard sans création globale");
    },
  },
  {
    id: "M10",
    title: "100 % masque la carte configuration requise",
    async run() {
      const { shouldShowGuidedSetupDashboardCard } = await loadContract();
      assert.equal(
        shouldShowGuidedSetupDashboardCard({ payload: guidedPayload(100), role: "school_admin" }),
        false,
      );
    },
  },
  {
    id: "M11",
    title: "progression visible sur petits écrans",
    run() {
      const wizard = read(WIZARD_PATH);
      assertHas(wizard, /testID=["']guided-setup-progress["']/, "M11 testID progression manquant");
      assertHas(wizard, /flexShrink|flexWrap|numberOfLines/, "M11 progression non adaptée petit écran");
    },
  },
  {
    id: "M12",
    title: "boutons de navigation accessibles sans débordement (44 dp)",
    run() {
      const wizard = read(WIZARD_PATH);
      assertHas(wizard, /testID=["']guided-setup-actions["']/, "M12 zone actions manquante");
      assertHas(wizard, /minHeight:\s*44|MIN_TOUCH_TARGET_DP/, "M12 cible tactile < 44 dp");
    },
  },
  {
    id: "M13",
    title: "retour Android/iOS ne détruit pas l'avancement sauvegardé",
    run() {
      const wizard = read(WIZARD_PATH);
      assertHas(
        wizard,
        /usePreventRemove|beforeRemove|navigation.addListener\(\s*["']beforeRemove/,
        "M13 back hardware non géré",
      );
      assertLacks(wizard, /completeStep\([^)]*reset|completedSteps:\s*\[\]/, "M13 reset au back interdit");
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
    `GUIDED Mobile school-setup RED — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`,
  );
  for (const id of passedIds) console.log(`  PASS ${id}`);
  for (const item of failed) {
    console.log(`  FAIL [${item.id}] ${item.title}`);
    console.log(`    ${item.message}`);
  }
  console.log(
    `SCHOOL_SETUP_GUIDED_MOBILE_RED ${JSON.stringify({
      passedIds,
      failedIds: failed.map((item) => item.id),
      expectedIds: cases.map((item) => item.id),
    })}`,
  );
  if (failed.length) process.exitCode = 1;
  else console.log("OK: guided Mobile school-setup");
}

void main();
