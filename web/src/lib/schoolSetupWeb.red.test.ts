/**
 * LOT 1 RED — Issue #683 — Web assistant + widget configuration établissement.
 *
 * Ces tests décrivent le contrat UX cible (FL-01/03/04, WZ-01/02/03/04/04b).
 * Ils doivent échouer tant que le wizard, le widget et le client
 * GET /api/v2/school-setup/status sont absents. Ne pas inverser les assertions.
 * Aucune implémentation GREEN dans ce lot. Aucun Mobile.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "vitest";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(webRoot, "..");

const CONTRACT_PATH = path.join(webRoot, "lib/schoolSetupWeb.ts");
const API_PATH = path.join(webRoot, "lib/schoolSetupStatusApi.ts");
const WIZARD_PATH = path.join(webRoot, "components/schoolSetup/SchoolSetupWizard.tsx");
const WIDGET_PATH = path.join(webRoot, "components/schoolSetup/SchoolSetupDashboardWidget.tsx");
const SETTINGS_PAGE_PATH = path.join(webRoot, "pages/parametres/SchoolSetupSettingsPage.tsx");

const APP = "App.tsx";
const LOGIN = "pages/LoginPage.tsx";
const OVERVIEW = "pages/etablissement/EtablissementOverviewPage.tsx";
const SETTINGS_HUB = "pages/parametres/SettingsHubPage.tsx";

const STATUS_API = "/v2/school-setup/status";
const SETTINGS_ROUTE = "/parametres/configuration-etablissement";
const YEAR_ROUTE = "/parametres/annee-scolaire";
const STRUCTURE_ROUTE = "/parametres/structure";
const CLASSES_ROUTE = "/etablissement/classes";
const USERS_ROUTE = "/etablissement/comptes-utilisateurs";
const FORBIDDEN_TEACHERS_POST = "/api/teachers";

const CORE_TOTAL = 3;

type SetupStatus = "NOT_STARTED" | "IN_PROGRESS" | "READY";

interface SchoolSetupPayload {
  status: SetupStatus;
  core: { academicYear: boolean; structure: boolean; classes: boolean };
  optional?: Record<string, boolean>;
  progress: { coreDone: number; coreTotal: number };
}

function read(relative: string) {
  return fs.readFileSync(path.join(webRoot, relative), "utf8");
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

function collectSchoolSetupSources() {
  const files = [
    CONTRACT_PATH,
    API_PATH,
    WIZARD_PATH,
    WIDGET_PATH,
    SETTINGS_PAGE_PATH,
    path.join(webRoot, LOGIN),
    path.join(webRoot, OVERVIEW),
    path.join(webRoot, SETTINGS_HUB),
    path.join(webRoot, APP),
  ];
  return files.filter((file) => exists(file)).map((file) => fs.readFileSync(file, "utf8"));
}

async function loadContract() {
  assert.ok(
    exists(CONTRACT_PATH),
    "web/src/lib/schoolSetupWeb.ts manquant — contrat LOT 1 Web non implémenté",
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

describe("LOT 1 RED — sources wizard / widget / API", () => {
  it("contrat — client GET /v2/school-setup/status sans schoolCode", () => {
    assert.ok(exists(API_PATH), "web/src/lib/schoolSetupStatusApi.ts manquant");
    const src = fs.readFileSync(API_PATH, "utf8");
    assertHas(src, STATUS_API, `client n'appelle pas ${STATUS_API}`);
    assertLacks(src, "school-setup/status/:schoolCode", "path :schoolCode interdit");
    assertLacks(src, /schoolCode\s*[:=]/, "schoolCode client interdit sur school-setup/status");
    assertLacks(src, /academicYearsApi|classesApi|education-reference/, "pas d'agrégation locale pour le statut");
  });

  it("contrat — module schoolSetupWeb exporte le mapping UX (pas de recalcul métier)", async () => {
    const mod = await loadContract();
    assert.equal(typeof mod.shouldAutoOpenSchoolSetupWizard, "function");
    assert.equal(typeof mod.shouldShowDashboardSetupWidget, "function");
    assert.equal(typeof mod.isSchoolSetupClassesStepEnabled, "function");
    assert.equal(typeof mod.schoolSetupWizardSteps, "function");
    assert.equal(typeof mod.dismissSchoolSetupWizardForSession, "function");
    assert.equal(typeof mod.isSchoolSetupWizardDismissedThisSession, "function");
    assert.equal(mod.SCHOOL_SETUP_SETTINGS_PATH, SETTINGS_ROUTE);
    assert.equal(mod.SCHOOL_SETUP_WEB_LINKS?.academicYear, YEAR_ROUTE);
    assert.equal(mod.SCHOOL_SETUP_WEB_LINKS?.structure, STRUCTURE_ROUTE);
    assert.equal(mod.SCHOOL_SETUP_WEB_LINKS?.classes, CLASSES_ROUTE);
    assert.equal(mod.SCHOOL_SETUP_WEB_LINKS?.teachers, USERS_ROUTE);
    const src = fs.readFileSync(CONTRACT_PATH, "utf8");
    assertLacks(
      src,
      /academicYearsApi\.list|filterCanonicalClasses|countCanonicalClasses/,
      "schoolSetupWeb ne doit pas recalculer le statut depuis les listes métier",
    );
    assertLacks(
      src,
      /last_login_at|firstLogin|mustChangePassword\s*\?\s*["']NOT_STARTED/,
      "statut établissement ≠ first login",
    );
  });

  it("contrat — shell wizard + widget Dashboard existent (aucun CRUD dupliqué)", () => {
    assert.ok(exists(WIZARD_PATH), "SchoolSetupWizard.tsx manquant");
    assert.ok(exists(WIDGET_PATH), "SchoolSetupDashboardWidget.tsx manquant");
    const wizard = fs.readFileSync(WIZARD_PATH, "utf8");
    const widget = fs.readFileSync(WIDGET_PATH, "utf8");
    assertHas(wizard, "Plus tard", "wizard sans CTA Plus tard");
    assertHas(widget, "Configuration rapide", "widget Dashboard sans titre Configuration rapide");
    assertHas(widget, "Continuer", "widget Dashboard sans CTA Continuer");
    assertLacks(
      wizard,
      /POST\s+\/teachers|createAcademicYear|academicYearsApi\.create/,
      "CRUD année/enseignants dupliqué dans le wizard",
    );
    assertLacks(wizard, FORBIDDEN_TEACHERS_POST, "POST /api/teachers interdit");
    assertHas(wizard, YEAR_ROUTE, `deep link année manquant (${YEAR_ROUTE})`);
    assertHas(wizard, USERS_ROUTE, `deep link comptes utilisateurs manquant (${USERS_ROUTE})`);
  });

  it("contrat — App déclare l'entrée permanente Paramètres", () => {
    const app = read(APP);
    assertHas(app, "configuration-etablissement", `route ${SETTINGS_ROUTE} absente de App.tsx`);
    assertHas(app, /SchoolSetupSettingsPage|SchoolSetupWizard/, "App.tsx n'importe pas le shell LOT 1");
  });

  it("contrat — hub Paramètres expose Configuration de l'établissement", () => {
    const hub = read(SETTINGS_HUB);
    assertHas(hub, "Configuration de l'établissement", "carte Paramètres absente");
    assertHas(hub, SETTINGS_ROUTE, `lien ${SETTINGS_ROUTE} absent du hub`);
    assert.ok(exists(SETTINGS_PAGE_PATH), "SchoolSetupSettingsPage.tsx manquant");
  });

  it("contrat — hub Scolarité affiche le widget avant READY", () => {
    const overview = read(OVERVIEW);
    assertHas(
      overview,
      /SchoolSetupDashboardWidget|Configuration rapide/,
      "widget Configuration rapide absent de EtablissementOverviewPage",
    );
    assertHas(
      overview,
      /schoolSetupStatusApi|school-setup\/status/,
      "hub Scolarité ne consomme pas GET school-setup/status",
    );
  });

  it("contrat — wizard auto après le gate mot de passe, pas pendant", () => {
    const login = read(LOGIN);
    assertHas(
      login,
      /shouldAutoOpenSchoolSetupWizard|SchoolSetupWizard/,
      "LoginPage ne relie pas le wizard LOT 1",
    );
    const start = login.indexOf("async function onPasswordChange");
    const changeFn = start >= 0 ? login.slice(start, start + 900) : "";
    assertHas(
      changeFn,
      /shouldAutoOpenSchoolSetupWizard|SchoolSetupWizard|configuration-etablissement/,
      "onPasswordChange ne relie pas le wizard après le MDP",
    );
    assertHas(login, "mustChangePassword", "gate MDP toujours requis avant le wizard");
  });

  it("LOT 1 — aucun fichier Mobile school-setup", () => {
    const mobileRoot = path.join(repoRoot, "Mobile");
    const hits: string[] = [];
    function walk(dir: string) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (/schoolSetupWeb|SchoolSetupDashboardWidget|SchoolSetupWizard/.test(entry.name)) {
          hits.push(path.relative(repoRoot, full));
        }
      }
    }
    walk(mobileRoot);
    assert.equal(hits.length, 0, `LOT 1 ne doit pas toucher Mobile: ${hits.join(", ")}`);
  });
});

describe("LOT 1 RED — FL première connexion / statut établissement", () => {
  it("FL-01 — NOT_STARTED + Admin School → wizard auto seulement après MDP", async () => {
    const { shouldAutoOpenSchoolSetupWizard } = await loadContract();
    assert.equal(
      shouldAutoOpenSchoolSetupWizard({
        payload: notStarted(),
        role: "Admin School",
        mustChangePassword: true,
      }),
      false,
      "wizard interdit tant que mustChangePassword",
    );
    assert.equal(
      shouldAutoOpenSchoolSetupWizard({
        payload: notStarted(),
        role: "Admin School",
        mustChangePassword: false,
      }),
      true,
    );
  });

  it("FL-03 — IN_PROGRESS → widget Dashboard, pas de logique firstLogin", async () => {
    const { shouldShowDashboardSetupWidget, shouldAutoOpenSchoolSetupWizard } = await loadContract();
    const input = {
      payload: inProgressYearOnly(),
      role: "Admin School",
      mustChangePassword: false,
      firstLogin: false,
      lastLoginAt: "2026-01-01T00:00:00Z",
    };
    assert.equal(shouldShowDashboardSetupWidget(input), true);
    assert.equal(
      shouldAutoOpenSchoolSetupWizard({ ...input, lastLoginAt: "2026-09-01T00:00:00Z" }),
      shouldAutoOpenSchoolSetupWizard({ ...input, lastLoginAt: null, firstLogin: true }),
      "FL-03: last_login_at / firstLogin ne changent pas l'ouverture du wizard",
    );
  });

  it("FL-04 — last_login_at null n'implique jamais NOT_STARTED côté Web", async () => {
    const { shouldShowDashboardSetupWidget, shouldAutoOpenSchoolSetupWizard } = await loadContract();
    const readyAdmin = {
      payload: ready(),
      role: "Admin School",
      mustChangePassword: false,
      lastLoginAt: null,
      firstLogin: true,
    };
    assert.equal(shouldShowDashboardSetupWidget(readyAdmin), false);
    assert.equal(shouldAutoOpenSchoolSetupWizard(readyAdmin), false);
    assert.equal(readyAdmin.payload.status, "READY");
  });
});

describe("LOT 1 RED — WZ wizard / deep links", () => {
  it("WZ-01 — étape Classes disabled tant que core.academicYear=false", async () => {
    const { isSchoolSetupClassesStepEnabled, schoolSetupWizardSteps } = await loadContract();
    assert.equal(
      isSchoolSetupClassesStepEnabled({ academicYear: false, structure: true, classes: false }),
      false,
    );
    assert.equal(
      isSchoolSetupClassesStepEnabled({ academicYear: true, structure: true, classes: false }),
      true,
    );
    const steps = schoolSetupWizardSteps(inProgressYearOnly());
    const classesStep = (steps ?? []).find((step: { id?: string }) => step.id === "classes");
    assert.ok(classesStep, "étape classes absente du shell wizard");
    assert.equal(classesStep.disabled, true);
    assert.equal(classesStep.to, CLASSES_ROUTE);
  });

  it("WZ-02 — CTA année → /parametres/annee-scolaire, aucun formulaire dupliqué", async () => {
    const { schoolSetupWizardSteps, SCHOOL_SETUP_WEB_LINKS } = await loadContract();
    assert.equal(SCHOOL_SETUP_WEB_LINKS.academicYear, YEAR_ROUTE);
    const steps = schoolSetupWizardSteps(notStarted());
    const yearStep = (steps ?? []).find((step: { id?: string }) => step.id === "academicYear");
    assert.equal(yearStep?.to, YEAR_ROUTE);
    const wizard = fs.readFileSync(WIZARD_PATH, "utf8");
    assertLacks(wizard, /academicYearsApi\.create|name="startDate"/, "formulaire année dupliqué dans le wizard");
    assertLacks(wizard, /<form[\s\S]*année/i, "form année interdit dans le shell wizard");
  });

  it("WZ-03 — CTA enseignant → /etablissement/comptes-utilisateurs, pas POST /teachers", async () => {
    const { SCHOOL_SETUP_WEB_LINKS, schoolSetupWizardSteps } = await loadContract();
    assert.equal(SCHOOL_SETUP_WEB_LINKS.teachers, USERS_ROUTE);
    assert.notEqual(SCHOOL_SETUP_WEB_LINKS.teachers, "/etablissement/enseignants");
    const steps = schoolSetupWizardSteps(ready());
    const teacherStep = (steps ?? []).find((step: { id?: string }) => step.id === "teachers");
    assert.equal(teacherStep?.to, USERS_ROUTE);
    const joined = collectSchoolSetupSources().join("\n");
    assertLacks(joined, /POST\s+["'`]\/api\/teachers/, "POST /api/teachers interdit (WZ-03)");
    assertLacks(joined, /api\.post\(\s*["'`]\/teachers/, "api.post(/teachers) interdit");
  });

  it("WZ-04 — Plus tard ferme le wizard ; dismiss session-only", async () => {
    const {
      dismissSchoolSetupWizardForSession,
      isSchoolSetupWizardDismissedThisSession,
      resetSchoolSetupWizardSessionDismiss,
      shouldAutoOpenSchoolSetupWizard,
    } = await loadContract();
    resetSchoolSetupWizardSessionDismiss?.();
    assert.equal(isSchoolSetupWizardDismissedThisSession(), false);
    dismissSchoolSetupWizardForSession();
    assert.equal(isSchoolSetupWizardDismissedThisSession(), true);
    assert.equal(
      shouldAutoOpenSchoolSetupWizard({
        payload: notStarted(),
        role: "Admin School",
        mustChangePassword: false,
      }),
      false,
      "wizard déjà dismiss cette session",
    );
  });

  it("WZ-04b — aucun write localStorage / sessionStorage / API snooze pour le dismiss", async () => {
    await loadContract();
    const sources = [
      fs.readFileSync(CONTRACT_PATH, "utf8"),
      exists(WIZARD_PATH) ? fs.readFileSync(WIZARD_PATH, "utf8") : "",
    ].join("\n");
    assertLacks(sources, /localStorage|sessionStorage|AsyncStorage/, "dismiss persisté en storage interdit (WZ-04b)");
    assertLacks(sources, /snooze|dismissed_until|setup_status/, "snooze serveur / setup_status interdit");
    assertLacks(sources, /api\.(post|patch|put)\([^\)]*school-setup/, "API write school-setup interdite");
  });
});

describe("LOT 1 RED — widget Dashboard / Paramètres", () => {
  it("école non READY → widget visible avec progress.coreDone/coreTotal", async () => {
    const { shouldShowDashboardSetupWidget, dashboardSetupProgressLabel } = await loadContract();
    const snap = inProgressYearOnly();
    assert.equal(shouldShowDashboardSetupWidget({ payload: snap, role: "Admin School" }), true);
    assert.equal(shouldShowDashboardSetupWidget({ payload: notStarted(), role: "Admin School" }), true);
    const label =
      typeof dashboardSetupProgressLabel === "function"
        ? dashboardSetupProgressLabel(snap)
        : `${snap.progress.coreDone} / ${snap.progress.coreTotal}`;
    assertHas(String(label), /1\s*\/\s*3/, "progression widget doit exposer 1 / 3");
    assert.equal(snap.progress.coreTotal, 3);
  });

  it("école READY → aucun widget Dashboard", async () => {
    const { shouldShowDashboardSetupWidget } = await loadContract();
    assert.equal(shouldShowDashboardSetupWidget({ payload: ready(), role: "Admin School" }), false);
    const overview = exists(path.join(webRoot, OVERVIEW)) ? read(OVERVIEW) : "";
    assertHas(
      overview,
      /shouldShowDashboardSetupWidget|SchoolSetupDashboardWidget/,
      "READY: le hub doit décider via shouldShowDashboardSetupWidget (masquer le widget)",
    );
  });

  it("entrée Paramètres → Configuration de l'établissement toujours disponible", () => {
    const hub = read(SETTINGS_HUB);
    assertHas(hub, "Configuration de l'établissement", "entrée permanente Paramètres absente");
    assertHas(hub, SETTINGS_ROUTE, `lien ${SETTINGS_ROUTE} absent`);
    const page = exists(SETTINGS_PAGE_PATH) ? fs.readFileSync(SETTINGS_PAGE_PATH, "utf8") : "";
    assertHas(
      page,
      /schoolSetupStatusApi|school-setup\/status/,
      "page Paramètres ne consomme pas le statut canonique",
    );
  });

  it("aucune agrégation Web locale academicYears / niveaux / groupes / classes pour le statut", async () => {
    await loadContract();
    const joined = [
      fs.readFileSync(CONTRACT_PATH, "utf8"),
      exists(API_PATH) ? fs.readFileSync(API_PATH, "utf8") : "",
      exists(WIDGET_PATH) ? fs.readFileSync(WIDGET_PATH, "utf8") : "",
      exists(WIZARD_PATH) ? fs.readFileSync(WIZARD_PATH, "utf8") : "",
    ].join("\n");
    assertHas(joined, "school-setup/status", "statut Web doit venir de GET school-setup/status");
    assertLacks(
      joined,
      /status\s*=\s*.*academicYears\.length|READY.*classes\.length|core\.classes\s*=\s*classes\.length/,
      "agrégation locale academicYears/classes interdite",
    );
  });
});
