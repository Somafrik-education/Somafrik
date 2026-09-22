/**
 * RED — assistant guidé Web (10 étapes).
 *
 * Contrats W1–W10. Doivent échouer tant que le wizard guidé, la bienvenue,
 * la carte Tableau de bord et le client POST guided sont absents.
 * Le checklist LOT 1 (3 core / deep links) reste en place.
 *
 *   npm --prefix web run test -- src/lib/schoolSetupGuidedWeb.red.test.ts src/components/schoolSetup/GuidedSchoolSetupWizard.red.test.tsx
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "vitest";

const webSrc = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(webSrc, "..", "..");

const CONTRACT_PATH = path.join(webSrc, "lib/schoolSetupGuidedWeb.ts");
const API_PATH = path.join(webSrc, "lib/schoolSetupGuidedApi.ts");
const WIZARD_PATH = path.join(webSrc, "components/schoolSetup/GuidedSchoolSetupWizard.tsx");
const CARD_PATH = path.join(webSrc, "components/schoolSetup/GuidedSchoolSetupDashboardCard.tsx");
const WELCOME_PATH = path.join(webSrc, "pages/schoolSetup/SchoolSetupWelcomePage.tsx");
const SETTINGS_PATH = path.join(webSrc, "pages/parametres/SchoolSetupSettingsPage.tsx");
const OVERVIEW_PATH = path.join(webSrc, "pages/OverviewPage.tsx");
const STUDENTS_PATH = path.join(webSrc, "pages/etablissement/StudentsListPage.tsx");
const APP_PATH = path.join(webSrc, "App.tsx");
const LOGIN_PATH = path.join(webSrc, "pages/LoginPage.tsx");

const GUIDED_API = "/v2/school-setup/guided";
const WELCOME_ROUTE = "/bienvenue-etablissement";
const WIZARD_ROUTE = "/parametres/configuration-etablissement";

export const GUIDED_STEP_KEYS = [
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
  assert.ok(exists(CONTRACT_PATH), "web/src/lib/schoolSetupGuidedWeb.ts manquant — contrat Web guidé absent");
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
      nextKey === "students"
        ? "Élèves"
        : nextKey === "subjects"
          ? "Matières"
          : nextKey ?? null,
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

describe("RED Web — sources assistant guidé", () => {
  it("contrat — client GET/POST /v2/school-setup/guided sans schoolCode", () => {
    assert.ok(exists(API_PATH), "web/src/lib/schoolSetupGuidedApi.ts manquant");
    const src = read(API_PATH);
    assertHas(src, GUIDED_API, `client n'appelle pas ${GUIDED_API}`);
    assertHas(src, /complete|steps\/.*complete/, "client complete step manquant");
    assertLacks(src, "school-setup/guided/:schoolCode", "path :schoolCode interdit");
    assertLacks(src, /POST\s+["'`]\/teachers/, "POST /teachers interdit");
    assertLacks(src, /POST\s+["'`]\/students["'`]/, "POST /students global interdit");
  });

  it("contrat — module schoolSetupGuidedWeb exporte le mapping UX 10 étapes", async () => {
    const mod = await loadContract();
    assert.equal(typeof mod.guidedProgressLabel, "function");
    assert.equal(typeof mod.guidedStepHeading, "function");
    assert.equal(typeof mod.shouldShowGuidedSetupDashboardCard, "function");
    assert.equal(typeof mod.shouldShowSchoolSetupWelcome, "function");
    assert.equal(typeof mod.guidedResumeStep, "function");
    assert.equal(mod.SCHOOL_SETUP_WELCOME_PATH, WELCOME_ROUTE);
    assert.equal(mod.GUIDED_STEP_TOTAL, 10);
    assert.deepEqual([...mod.GUIDED_STEP_KEYS], [...GUIDED_STEP_KEYS]);
  });

  it("contrat — shell wizard / bienvenue / carte dashboard existent", () => {
    assert.ok(exists(WIZARD_PATH), "GuidedSchoolSetupWizard.tsx manquant");
    assert.ok(exists(CARD_PATH), "GuidedSchoolSetupDashboardCard.tsx manquant");
    assert.ok(exists(WELCOME_PATH), "SchoolSetupWelcomePage.tsx manquant");
    const wizard = read(WIZARD_PATH);
    const welcome = read(WELCOME_PATH);
    const card = read(CARD_PATH);
    assertHas(wizard, "Configuration de votre établissement", "titre wizard manquant");
    assertHas(wizard, "Étape", "indicateur Étape X sur 10 manquant");
    assertHas(wizard, "sur 10", "Étape X sur 10 manquant");
    assertHas(wizard, "Enregistrer et continuer", "CTA Enregistrer et continuer manquant");
    assertHas(wizard, "Précédent", "CTA Précédent manquant");
    assertHas(wizard, "Quitter et reprendre plus tard", "CTA quitter manquant");
    assertHas(wizard, "Vérifier la configuration", "CTA vérification dernière étape manquant");
    assertHas(wizard, "Terminer la configuration", "CTA terminer manquant");
    assertHas(welcome, "Bienvenue sur Somafrik", "bienvenue manquante");
    assertHas(welcome, "Configurer mon établissement", "CTA première connexion manquant");
    assertHas(card, "Terminez la configuration de votre établissement", "titre carte dashboard manquant");
    assertHas(card, "Reprendre la configuration", "CTA reprise manquant");
    assertLacks(wizard, /POST\s+\/api\/students["'`]/, "création élève globale interdite dans le wizard");
    assertLacks(wizard, /Ajouter Élève|Ajouter un élève/, "bouton global Ajouter Élève interdit");
  });

  it("contrat — routes App + Login + Tableau de bord branchés", () => {
    const app = read(APP_PATH);
    const login = read(LOGIN_PATH);
    const overview = read(OVERVIEW_PATH);
    const settings = exists(SETTINGS_PATH) ? read(SETTINGS_PATH) : "";
    assertHas(app, "bienvenue-etablissement", `route ${WELCOME_ROUTE} absente`);
    assertHas(app, "configuration-etablissement", `route ${WIZARD_ROUTE} absente`);
    assertHas(app, /SchoolSetupWelcomePage|GuidedSchoolSetupWizard/, "App n'importe pas le parcours guidé");
    assertHas(login, /shouldShowSchoolSetupWelcome|bienvenue-etablissement|Configurer mon établissement/, "Login ne relie pas la bienvenue guidée");
    assertHas(
      overview,
      /GuidedSchoolSetupDashboardCard|Terminez la configuration de votre établissement/,
      "carte guidée absente du Tableau de bord",
    );
    assertHas(settings, /GuidedSchoolSetupWizard|schoolSetupGuidedApi/, "page configuration n'orchestre pas le wizard guidé");
  });
});

describe("RED Web — W1 à W10", () => {
  it("W1 — administrateur non configuré voit Configurer mon établissement", async () => {
    const { shouldShowSchoolSetupWelcome } = await loadContract();
    assert.equal(
      shouldShowSchoolSetupWelcome({
        payload: guidedPayload(0),
        role: "Admin School",
        mustChangePassword: false,
      }),
      true,
    );
    assert.equal(
      shouldShowSchoolSetupWelcome({
        payload: guidedPayload(100),
        role: "Admin School",
        mustChangePassword: false,
      }),
      false,
    );
    const welcome = read(WELCOME_PATH);
    assertHas(welcome, "Bienvenue sur Somafrik", "W1: Bienvenue sur Somafrik");
    assertHas(welcome, "Configurer mon établissement", "W1: Configurer mon établissement");
  });

  it("W2 — le wizard affiche Étape X sur 10", async () => {
    const { guidedStepHeading } = await loadContract();
    assert.equal(guidedStepHeading(1), "Étape 1 sur 10");
    assert.equal(guidedStepHeading(4), "Étape 4 sur 10");
    assert.equal(guidedStepHeading(10), "Étape 10 sur 10");
  });

  it("W3 — le pourcentage affiché correspond à l'avancement réel", async () => {
    const { guidedProgressLabel } = await loadContract();
    assert.equal(guidedProgressLabel(guidedPayload(0)), "Configuration 0 % terminée");
    assert.equal(guidedProgressLabel(guidedPayload(40)), "Configuration 40 % terminée");
    assert.equal(guidedProgressLabel(guidedPayload(60)), "Configuration 60 % terminée");
    assert.equal(guidedProgressLabel(guidedPayload(100)), "Configuration 100 % terminée");
    const forty = guidedPayload(40);
    assert.equal(forty.percent, forty.completedSteps.length * 10);
  });

  it("W4 — Enregistrer et continuer sauvegarde puis passe à l'étape suivante", () => {
    const wizard = read(WIZARD_PATH);
    assertHas(wizard, "Enregistrer et continuer", "W4 CTA manquant");
    assertHas(wizard, /schoolSetupGuidedApi|completeGuidedStep|guidedApi/, "W4 ne persist pas via l'API guidée");
  });

  it("W5 — Précédent ne supprime pas les données déjà enregistrées", () => {
    const wizard = read(WIZARD_PATH);
    assertHas(wizard, "Précédent", "W5 CTA manquant");
    assertLacks(
      wizard,
      /completeGuidedStep\([^)]*reset|deleteGuided|completedSteps\s*=\s*\[\]/,
      "W5 ne doit pas reset la progression au Précédent",
    );
  });

  it("W6 — Quitter et reprendre plus tard quitte sans perdre l'avancement", () => {
    const wizard = read(WIZARD_PATH);
    assertHas(wizard, "Quitter et reprendre plus tard", "W6 CTA manquant");
    assertLacks(wizard, /progressStore\.save\([^)]*completedSteps:\s*\[\]/, "W6 ne doit pas vider l'avancement");
  });

  it("W7 — la carte Tableau de bord affiche la prochaine étape", async () => {
    const { shouldShowGuidedSetupDashboardCard, guidedNextStepLabel } = await loadContract();
    const payload = guidedPayload(60, { nextStepKey: "finance", nextStepLabel: "Finance" });
    assert.equal(shouldShowGuidedSetupDashboardCard({ payload, role: "Admin School" }), true);
    assert.equal(guidedNextStepLabel(payload), "Finance");
    const card = read(CARD_PATH);
    assertHas(card, "Prochaine étape", "W7 libellé prochaine étape manquant");
    assertHas(read(OVERVIEW_PATH), "GuidedSchoolSetupDashboardCard", "W7 carte absente du dashboard");
  });

  it("W8 — la reprise ouvre la bonne étape", async () => {
    const { guidedResumeStep } = await loadContract();
    assert.equal(guidedResumeStep(guidedPayload(40)), 5);
    assert.equal(guidedResumeStep(guidedPayload(50)), 6);
    assert.equal(guidedResumeStep(guidedPayload(60)), 7);
    assert.equal(guidedResumeStep(guidedPayload(0)), 1);
    assert.equal(guidedResumeStep(guidedPayload(100)), 10);
  });

  it("W9 — l'inscription Élève reste dépendante d'une Classe", () => {
    const students = read(STUDENTS_PATH);
    const wizard = exists(WIZARD_PATH) ? read(WIZARD_PATH) : "";
    assertHas(students, "Inscrire un élève", "W9: parcours Classe → Élève");
    assertLacks(students, /Ajouter Élève|Ajouter un élève/, "W9: bouton global Ajouter Élève interdit");
    assertHas(students, "primaryActions={null}", "W9: pas de création globale sur l'annuaire");
    assertLacks(wizard, /Ajouter Élève|POST\s+\/api\/students["'`]/, "W9: wizard sans création élève globale");
    const joined = [wizard, students].join("\n");
    assertLacks(joined, /\/api\/backoffice\/students/, "W9: endpoint student legacy interdit");
  });

  it("HOLD UX — settings n'empile pas Guided et l'ancien SchoolSetupWizard", () => {
    const settings = read(SETTINGS_PATH);
    assertHas(settings, "GuidedSchoolSetupWizard", "HOLD: wizard guidé requis");
    assertHas(settings, "SchoolSetupWizard", "HOLD: ancien contrat conservé en fallback");
    const exclusive =
      /guided\s*\?\s*\([\s\S]*<GuidedSchoolSetupWizard[\s\S]*\)\s*:\s*payload\s*\?\s*[\s\S]*<SchoolSetupWizard/.test(
        settings,
      ) || /!guided[\s\S]{0,240}<SchoolSetupWizard/.test(settings);
    assert.ok(
      exclusive,
      "HOLD P1 UX: Guided et ancien SchoolSetupWizard ne doivent pas être rendus simultanément",
    );
    assertLacks(
      settings,
      /Ces actions ouvrent les écrans existants[\s\S]*GuidedSchoolSetupWizard|GuidedSchoolSetupWizard[\s\S]*Ces actions ouvrent les écrans existants/,
      "HOLD: le texte de l'ancien assistant ne doit pas cohabiter avec le guidé",
    );
  });

  it("HOLD — à 100 % Terminer la configuration renvoie au Tableau de bord", () => {
    const wizard = read(WIZARD_PATH);
    const settings = read(SETTINGS_PATH);
    assertHas(wizard, "onFinish", "HOLD: GuidedSchoolSetupWizard doit exposer onFinish");
    assertHas(settings, "onFinish", "HOLD: settings doit brancher onFinish");
    assertHas(settings, "/tableau-de-bord", "HOLD: Terminer → /tableau-de-bord");
  });

  it("W10 — une configuration complète supprime l'état configuration requise", async () => {
    const { shouldShowGuidedSetupDashboardCard, shouldShowSchoolSetupWelcome } = await loadContract();
    const complete = guidedPayload(100);
    assert.equal(complete.status, "operational");
    assert.equal(complete.percent, 100);
    assert.equal(shouldShowGuidedSetupDashboardCard({ payload: complete, role: "Admin School" }), false);
    assert.equal(shouldShowSchoolSetupWelcome({ payload: complete, role: "Admin School" }), false);
    assertHas(read(CARD_PATH), /percent\s*===?\s*100|status.*operational|shouldShowGuidedSetupDashboardCard/, "W10: masquage 100 %");
  });
});

describe("RED Web — anti-régression périmètre", () => {
  it("ne touche pas au contrat LOT 1 3/3 et n'introduit pas de CRUD Classes/Students/Teachers", async () => {
    await loadContract();
    const lot1 = read(path.join(webSrc, "lib/schoolSetupWeb.ts"));
    assertHas(lot1, "coreTotal ?? 3", "LOT 1 progress 3/3 doit rester");
    const changedHint = [CONTRACT_PATH, WIZARD_PATH, API_PATH]
      .filter((file) => exists(file))
      .map((file) => read(file))
      .join("\n");
    assertLacks(changedHint, /createTeacherIdentity|POST\s+\/api\/teachers/, "refonte Teachers interdite");
    assertLacks(changedHint, /BackOffice\/app\.js|backoffice_state/, "BackOffice interdit");
    const mobileHits: string[] = [];
    const mobileRoot = path.join(repoRoot, "Mobile");
    if (fs.existsSync(mobileRoot)) {
      for (const name of ["schoolSetupGuidedWeb.ts"]) {
        const walk = (dir: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name === name) mobileHits.push(path.relative(repoRoot, full));
          }
        };
        walk(mobileRoot);
      }
    }
    assert.equal(mobileHits.length, 0, `fichiers Web guidés copiés dans Mobile: ${mobileHits.join(", ")}`);
  });
});
