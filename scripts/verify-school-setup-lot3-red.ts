/**
 * LOT 3 RED — Issue #693 — reprise, multi-admin et résilience school setup.
 *
 * Contrats L3-01 → L3-08. Réutilise les modules LOT 0/1/2
 * (`schoolSetupStatus.js`, `schoolSetupWeb.ts`, `schoolSetupMobile.ts`)
 * au lieu de dupliquer les fixtures PG. Aucun runtime LOT 3 dans ce dépôt.
 *
 * Les scénarios déjà satisfaits par LOT 0/1/2 peuvent être verts.
 * Ne pas inverser/affaiblir une assertion pour forcer du rouge.
 *
 *   npx --yes tsx scripts/verify-school-setup-lot3-red.ts
 *   npm run verify:school-setup-lot3-red
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendStatusPath = path.join(repoRoot, "backend/lib/schoolSetupStatus.js");
const webContractPath = path.join(repoRoot, "web/src/lib/schoolSetupWeb.ts");
const mobileContractPath = path.join(repoRoot, "Mobile/src/lib/schoolSetupMobile.ts");
const webLoginPath = path.join(repoRoot, "web/src/pages/LoginPage.tsx");
const mobileLoginPath = path.join(repoRoot, "Mobile/src/screens/LoginScreen.tsx");
const webOverviewPath = path.join(repoRoot, "web/src/pages/etablissement/EtablissementOverviewPage.tsx");
const webSettingsHubPath = path.join(repoRoot, "web/src/pages/parametres/SettingsHubPage.tsx");
const webSettingsPagePath = path.join(repoRoot, "web/src/pages/parametres/SchoolSetupSettingsPage.tsx");
const mobileHubPath = path.join(repoRoot, "Mobile/src/screens/SchoolingHubScreen.tsx");
const mobileConfigPath = path.join(repoRoot, "Mobile/src/screens/ConfigurationScreen.tsx");
const webAuthPath = path.join(repoRoot, "web/src/context/AuthContext.tsx");

const SCHOOL_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const LOGIN_A = "CD-IN-26-001";
const SYNTHETIC_SCHOOL_FIELDS = [
  "usersSchoolId",
  "usersLoginCode",
  "schoolId",
  "effectiveSchoolId",
  "effectiveSchoolCode",
] as const;
const CORE_TOTAL = 3;
const USER_KEYS = [
  "mustChangePassword",
  "must_change_password",
  "lastLoginAt",
  "last_login_at",
  "firstLogin",
  "hasSeenWizard",
  "userId",
  "email",
];

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
    if (/schoolSetup/i.test(entry.name) && !/\.test\./.test(entry.name) && !/lot3/i.test(entry.name)) {
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

function payload(status: SetupStatus, core: SchoolSetupPayload["core"], extra?: Partial<SchoolSetupPayload>): SchoolSetupPayload {
  const done = [core.academicYear, core.structure, core.classes].filter(Boolean).length;
  return {
    status,
    core,
    progress: { coreDone: extra?.progress?.coreDone ?? done, coreTotal: extra?.progress?.coreTotal ?? CORE_TOTAL },
    optional: extra?.optional,
  };
}

function notStarted() {
  return payload("NOT_STARTED", { academicYear: false, structure: false, classes: false });
}

function inProgressYearOnly() {
  return payload("IN_PROGRESS", { academicYear: true, structure: false, classes: false });
}

function ready(optional?: Record<string, boolean>) {
  return payload("READY", { academicYear: true, structure: true, classes: true }, { optional });
}

function jwtOnlySchoolAdmin(overrides: Record<string, unknown> = {}) {
  const principal: Record<string, unknown> = {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    schoolCode: LOGIN_A,
    permissions: ["Paramètres Établissement:READ"],
    ...overrides,
  };
  for (const key of SYNTHETIC_SCHOOL_FIELDS) {
    delete principal[key];
  }
  return principal;
}

function assertJwtOnlyPrincipal(principal: Record<string, unknown>) {
  for (const key of SYNTHETIC_SCHOOL_FIELDS) {
    assert.equal(principal[key], undefined, `champ synthétique interdit sur le principal JWT: ${key}`);
  }
  assert.ok(String(principal.sub ?? "").trim(), "principal.sub requis pour le lookup membership");
}

function membershipOneBySub(rowsBySub: Record<string, { school_id: string; login_code: string }>) {
  let membershipLookups = 0;
  const one = async (sql: string, params: unknown[] = []) => {
    const text = String(sql);
    if (/from\s+users/i.test(text) && /school_id/i.test(text)) {
      membershipLookups += 1;
      const sub = String(params[0] ?? "");
      return rowsBySub[sub] ?? null;
    }
    return null;
  };
  return {
    one,
    lookupCount: () => membershipLookups,
  };
}

async function loadWebContract() {
  assert.ok(exists(webContractPath), "web/src/lib/schoolSetupWeb.ts manquant — harness LOT 1 requis");
  return import(pathToFileURL(webContractPath).href);
}

async function loadMobileContract() {
  assert.ok(exists(mobileContractPath), "Mobile/src/lib/schoolSetupMobile.ts manquant — harness LOT 2 requis");
  return import(pathToFileURL(mobileContractPath).href);
}

function loadBackendContract() {
  assert.ok(exists(backendStatusPath), "backend/lib/schoolSetupStatus.js manquant — harness LOT 0 requis");
  return require(backendStatusPath) as {
    deriveSchoolSetupStatus: (raw?: Record<string, unknown>) => SchoolSetupPayload;
    getSchoolSetupStatus: (input: Record<string, unknown>) => Promise<SchoolSetupPayload>;
  };
}

function assertNoUserIdentity(payloadJson: SchoolSetupPayload, extraNeedles: string[]) {
  const encoded = JSON.stringify(payloadJson);
  for (const key of USER_KEYS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(payloadJson, key),
      false,
      `payload setup ne doit pas exposer ${key}`,
    );
  }
  for (const needle of extraNeedles) {
    assert.equal(encoded.includes(needle), false, `identité utilisateur fuitée dans le JSON métier: ${needle}`);
  }
  assert.doesNotMatch(encoded, /mustChangePassword|last_login_at|must_change_password/);
}

const cases: { id: string; title: string; run: () => void | Promise<void> }[] = [
  {
    id: "L3-01",
    title: "ST-05 — deux admins du même school_id → même JSON métier",
    async run() {
      const { getSchoolSetupStatus } = loadBackendContract();
      const snap = {
        hasCurrentOrOpenAcademicYear: true,
        activatedLevelCount: 1,
        activatedGroupCount: 1,
        classCount: 1,
        termCount: 0,
        teacherCount: 1,
      };
      const membershipA = { school_id: SCHOOL_A_ID, login_code: LOGIN_A };
      const { one, lookupCount } = membershipOneBySub({
        "admin-a-1": membershipA,
        "admin-a-2": membershipA,
      });
      const tenantIds: string[] = [];
      const loadSnapshot = async (tenant: { schoolId?: string }) => {
        tenantIds.push(String(tenant.schoolId));
        assert.equal(String(tenant.schoolId), SCHOOL_A_ID, "loadSnapshot doit recevoir le school_id membership");
        return snap;
      };
      const adminA = jwtOnlySchoolAdmin({
        sub: "admin-a-1",
        email: "aline@lot3.test",
        mustChangePassword: true,
        lastLoginAt: null,
      });
      const adminB = jwtOnlySchoolAdmin({
        sub: "admin-a-2",
        email: "binta@lot3.test",
        mustChangePassword: false,
        lastLoginAt: "2026-09-01T00:00:00Z",
      });
      assertJwtOnlyPrincipal(adminA);
      assertJwtOnlyPrincipal(adminB);
      assert.notEqual(adminA.sub, adminB.sub);

      const first = await getSchoolSetupStatus({ principal: adminA, one, loadSnapshot });
      const second = await getSchoolSetupStatus({ principal: adminB, one, loadSnapshot });

      assert.ok(lookupCount() >= 2, "L3-01: le lookup membership principal.sub → users.school_id n'a jamais été appelé");
      assert.deepEqual(tenantIds, [SCHOOL_A_ID, SCHOOL_A_ID], "les deux admins doivent résoudre le même tenant.schoolId");
      assert.deepEqual(first, second, "L3-01: comparer le JSON métier, pas les tokens/users");
      assert.equal(first.status, "READY");
      assertNoUserIdentity(first, ["admin-a-1", "admin-a-2", "aline@lot3.test", "binta@lot3.test"]);
      assertNoUserIdentity(second, ["admin-a-1", "admin-a-2", "aline@lot3.test", "binta@lot3.test"]);
    },
  },
  {
    id: "L3-02",
    title: "FL-02 — nouvel admin + école READY → pas d'auto wizard, pas de widget, Paramètres conservé",
    async run() {
      const web = await loadWebContract();
      const mobile = await loadMobileContract();
      const newAdminReady = {
        payload: ready(),
        role: "Admin School",
        mustChangePassword: false,
        firstLogin: true,
        lastLoginAt: null,
      };
      assert.equal(
        web.shouldAutoOpenSchoolSetupWizard(newAdminReady),
        false,
        "Web: aucun wizard auto lié au fait que l'admin est nouveau",
      );
      assert.equal(
        web.shouldShowDashboardSetupWidget(newAdminReady),
        false,
        "Web: aucun widget Configuration rapide si READY",
      );
      assert.equal(
        mobile.shouldShowDashboardSetupWidget({ payload: ready(), role: "school_admin", firstLogin: true }),
        false,
        "Mobile: school_admin + READY → widget absent",
      );
      assert.equal(
        mobile.shouldAutoOpenSchoolSetupWizard({
          payload: ready(),
          role: "school_admin",
          mustChangePassword: false,
        }),
        false,
        "Mobile: READY ne déclenche pas l'assistant auto",
      );
      assertHas(
        read(webSettingsHubPath),
        "Configuration de l'établissement",
        "Web: accès Paramètres → Configuration de l'établissement absent",
      );
      assertHas(
        read(webSettingsHubPath),
        "/parametres/configuration-etablissement",
        "Web: lien permanent configuration-etablissement absent",
      );
      assertHas(
        read(mobileConfigPath),
        /title:\s*["']Configuration de l['’]établissement["']/,
        "Mobile: carte permanente Configuration de l'établissement absente",
      );
    },
  },
  {
    id: "L3-03",
    title: "FL-05 — READY sans périodes → READY, optional.periods=false, pas de widget/auto assistant",
    async run() {
      const { deriveSchoolSetupStatus } = loadBackendContract();
      const derived = deriveSchoolSetupStatus({
        hasCurrentOrOpenAcademicYear: true,
        activatedLevelCount: 1,
        activatedGroupCount: 1,
        classCount: 1,
        termCount: 0,
      });
      assert.equal(derived.status, "READY");
      assert.equal(derived.optional?.periods, false, "périodes hors gate READY");
      const web = await loadWebContract();
      const mobile = await loadMobileContract();
      const snap = ready({ periods: false });
      assert.equal(web.shouldShowDashboardSetupWidget({ payload: snap, role: "Admin School" }), false);
      assert.equal(
        web.shouldAutoOpenSchoolSetupWizard({ payload: snap, role: "Admin School", mustChangePassword: false }),
        false,
      );
      assert.equal(mobile.shouldShowDashboardSetupWidget({ payload: snap, role: "school_admin" }), false);
    },
  },
  {
    id: "L3-04",
    title: "WZ-06 — logout puis nouvelle auth IN_PROGRESS → reprise payload serveur, jamais currentStep local",
    async run() {
      const web = await loadWebContract();
      const mobile = await loadMobileContract();
      web.resetSchoolSetupWizardSessionDismiss();
      mobile.resetSchoolSetupWizardSessionDismiss();
      web.dismissSchoolSetupWizardForSession();
      mobile.dismissSchoolSetupWizardForSession();
      assert.equal(web.isSchoolSetupWizardDismissedThisSession(), true);
      assert.equal(mobile.isSchoolSetupWizardDismissedThisSession(), true);

      web.resetSchoolSetupWizardSessionDismiss();
      mobile.resetSchoolSetupWizardSessionDismiss();
      assert.equal(web.isSchoolSetupWizardDismissedThisSession(), false, "nouvelle authentification perd le dismiss RAM");
      assert.equal(mobile.isSchoolSetupWizardDismissedThisSession(), false);

      const snap = inProgressYearOnly();
      const webSteps = web.schoolSetupWizardSteps(snap);
      const mobileSteps = mobile.schoolSetupWizardSteps(snap);
      const webYear = webSteps.find((step: { id?: string }) => step.id === "academicYear");
      const webStructure = webSteps.find((step: { id?: string }) => step.id === "structure");
      const webClasses = webSteps.find((step: { id?: string }) => step.id === "classes");
      assert.equal(webYear?.done, true, "reprise: année done depuis core.academicYear serveur");
      assert.equal(webStructure?.done, false);
      assert.equal(webStructure?.disabled, false);
      assert.equal(webClasses?.disabled, true, "classes gated par academicYear/structure serveur, pas currentStep");
      assert.equal(
        mobileSteps.find((step: { id?: string }) => step.id === "academicYear")?.done,
        true,
      );

      const setupSources = schoolSetupModuleSources()
        .map((row) => row.source)
        .join("\n");
      assertLacks(
        setupSources,
        /savedStep|wizardCursor|lastWizardStep/,
        "aucune progression locale persistée (savedStep / wizardCursor)",
      );
      assertLacks(
        setupSources,
        /localStorage[\s\S]{0,120}currentStep|sessionStorage[\s\S]{0,120}currentStep|AsyncStorage[\s\S]{0,120}currentStep|currentStep[\s\S]{0,80}(localStorage|sessionStorage|AsyncStorage)/,
        "currentStep serveur autorisé ; persistance client interdite",
      );
      assertHas(
        read(webLoginPath),
        "schoolSetupStatusApi",
        "Web: nouvelle authentification doit recharger GET school-setup/status",
      );
      assertHas(
        read(mobileLoginPath),
        /schoolSetupStatusApi|school-setup\/status/,
        "Mobile: nouvelle authentification doit recharger GET school-setup/status",
      );
      assertHas(
        read(mobileLoginPath),
        /shouldAutoOpenSchoolSetupWizard|resolveMobilePostLoginNavigation/,
        "Mobile login doit appliquer le gate auto-open",
      );
      assertHas(
        read(mobileHubPath),
        /schoolSetupStatusApi|school-setup\/status/,
        "Mobile: hub doit recharger GET school-setup/status après auth/focus",
      );
      assertHas(read(webLoginPath), "resetSchoolSetupWizardSessionDismiss", "Web login doit reset le dismiss");
      assertHas(read(mobileLoginPath), "resetSchoolSetupWizardSessionDismiss", "Mobile login doit reset le dismiss");
    },
  },
  {
    id: "L3-05",
    title: "dismiss Admin A ne contamine pas Admin B après nouvelle authentification",
    async run() {
      const web = await loadWebContract();
      const mobile = await loadMobileContract();
      web.resetSchoolSetupWizardSessionDismiss();
      mobile.resetSchoolSetupWizardSessionDismiss();

      web.dismissSchoolSetupWizardForSession();
      mobile.dismissSchoolSetupWizardForSession();
      assert.equal(
        web.shouldAutoOpenSchoolSetupWizard({
          payload: notStarted(),
          role: "Admin School",
          mustChangePassword: false,
        }),
        false,
        "Admin A a dismiss — wizard masqué pour A",
      );
      assert.equal(
        mobile.shouldAutoOpenSchoolSetupWizard({
          payload: notStarted(),
          role: "school_admin",
          mustChangePassword: false,
        }),
        false,
        "Admin A a dismiss — wizard Mobile masqué pour A",
      );

      web.resetSchoolSetupWizardSessionDismiss();
      mobile.resetSchoolSetupWizardSessionDismiss();
      assert.equal(
        web.shouldAutoOpenSchoolSetupWizard({
          payload: notStarted(),
          role: "Admin School",
          mustChangePassword: false,
        }),
        true,
        "Admin B après nouvelle auth: dismiss A ne masque pas l'assistant",
      );
      assert.equal(
        mobile.shouldAutoOpenSchoolSetupWizard({
          payload: notStarted(),
          role: "school_admin",
          mustChangePassword: false,
        }),
        true,
        "Admin B après nouvelle auth Mobile: dismiss A ne masque pas l'assistant",
      );
      assert.equal(
        web.shouldShowDashboardSetupWidget({ payload: inProgressYearOnly(), role: "Admin School" }),
        true,
        "Admin B: widget Web visible si établissement non READY",
      );
      assert.equal(
        mobile.shouldShowDashboardSetupWidget({ payload: inProgressYearOnly(), role: "school_admin" }),
        true,
        "Admin B: widget Mobile visible si établissement non READY",
      );
      assertHas(
        read(webLoginPath),
        "resetSchoolSetupWizardSessionDismiss",
        "isolation inter-admin: reset au login Web, pas un snooze school_id",
      );
      assertHas(
        read(mobileLoginPath),
        "resetSchoolSetupWizardSessionDismiss",
        "isolation inter-admin: reset au login Mobile",
      );
    },
  },
  {
    id: "L3-06",
    title: "WZ-07 — READY → widget absent Web/Mobile, entrée Paramètres permanente",
    async run() {
      const web = await loadWebContract();
      const mobile = await loadMobileContract();
      assert.equal(web.shouldShowDashboardSetupWidget({ payload: ready(), role: "Admin School" }), false);
      assert.equal(mobile.shouldShowDashboardSetupWidget({ payload: ready(), role: "school_admin" }), false);
      assertHas(read(webOverviewPath), /shouldShowDashboardSetupWidget|SchoolSetupDashboardWidget/);
      assertHas(read(mobileHubPath), /shouldShowDashboardSetupWidget|SchoolSetupDashboardWidget/);
      assertHas(read(webSettingsHubPath), "Configuration de l'établissement");
      assertHas(read(webSettingsPagePath), /schoolSetupStatusApi|school-setup\/status/);
      assertHas(read(mobileConfigPath), /title:\s*["']Configuration de l['’]établissement["']/);
      assertHas(
        read(path.join(repoRoot, "Mobile/src/navigation/AppNavigator.tsx")),
        'name="SchoolSetup"',
        "ouverture manuelle de l'écran Configuration établissement absente",
      );
    },
  },
  {
    id: "L3-07",
    title: "WZ-08 — READY → IN_PROGRESS après perte d'un prérequis → widget réapparaît après refresh/focus",
    async run() {
      const { deriveSchoolSetupStatus } = loadBackendContract();
      const lostClass = deriveSchoolSetupStatus({
        hasCurrentOrOpenAcademicYear: true,
        activatedLevelCount: 1,
        activatedGroupCount: 1,
        classCount: 0,
        termCount: 0,
      });
      assert.equal(lostClass.status, "IN_PROGRESS");
      assert.equal(lostClass.core.classes, false);
      const empty = deriveSchoolSetupStatus({
        hasCurrentOrOpenAcademicYear: false,
        activatedLevelCount: 0,
        activatedGroupCount: 0,
        classCount: 0,
      });
      assert.equal(empty.status, "NOT_STARTED");

      const web = await loadWebContract();
      const mobile = await loadMobileContract();
      assert.equal(web.shouldShowDashboardSetupWidget({ payload: ready(), role: "Admin School" }), false);
      assert.equal(
        web.shouldShowDashboardSetupWidget({ payload: lostClass, role: "Admin School" }),
        true,
        "Web: widget doit suivre le payload serveur, pas un READY mis en cache",
      );
      assert.equal(mobile.shouldShowDashboardSetupWidget({ payload: ready(), role: "school_admin" }), false);
      assert.equal(mobile.shouldShowDashboardSetupWidget({ payload: lostClass, role: "school_admin" }), true);

      const overview = read(webOverviewPath);
      assertHas(
        overview,
        /schoolSetupStatusApi[\s\S]{0,80}\.get\s*\(|school-setup\/status/,
        "Web hub ne recharge pas le statut",
      );
      assertHas(
        overview,
        /useEffect[\s\S]*schoolSetupStatusApi|schoolSetupStatusApi[\s\S]*useEffect/,
        "Web hub: refresh du statut requis (pas de vérité métier cachée)",
      );
      const hub = read(mobileHubPath);
      assertHas(hub, "useFocusEffect", "Mobile hub: widget READY→IN_PROGRESS exige un refetch au focus");
      assertHas(
        hub,
        /schoolSetupStatusApi[\s\S]{0,80}\.get\s*\(|school-setup\/status/,
        "Mobile hub ne recharge pas le statut au focus",
      );
      const setupSources = schoolSetupModuleSources()
        .map((row) => row.source)
        .join("\n");
      assertLacks(
        setupSources,
        /localStorage\.setItem\([^)]*school-setup|AsyncStorage\.setItem\([^)]*setup/,
        "statut setup ne doit pas être persisté comme vérité métier",
      );
    },
  },
  {
    id: "L3-08",
    title: "pas de persistance client du school setup (modules school setup uniquement)",
    run() {
      const rows = schoolSetupModuleSources();
      assert.ok(rows.length > 0, "aucun module school setup à inspecter");
      for (const { file, source } of rows) {
        const rel = path.relative(repoRoot, file);
        assertLacks(
          source,
          /localStorage|sessionStorage|AsyncStorage/,
          `${rel}: persistance client school setup interdite (auth sessionStorage / SecureStore hors scope)`,
        );
        assertLacks(source, /SecureStore/, `${rel}: SecureStore auth Mobile hors scope — ne pas l'utiliser pour le setup`);
        assertLacks(source, /snooze|dismissed_until|setup_status/, `${rel}: snooze serveur / setup_status interdit`);
      }
      assert.ok(exists(webAuthPath) && read(webAuthPath).includes("sessionStorage"), "garde: sessionStorage auth Web existe encore hors modules setup");
      assert.ok(
        exists(path.join(repoRoot, "Mobile/src/services/secureStorage.ts")),
        "garde: SecureStore auth Mobile existe encore hors modules setup",
      );
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
    `LOT 3 school-setup RED — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`,
  );
  for (const id of passedIds) console.log(`  PASS ${id}`);
  for (const item of failed) {
    console.log(`  FAIL [${item.id}] ${item.title}`);
    console.log(`    ${item.message}`);
  }
  console.log(
    `SCHOOL_SETUP_LOT3_RED ${JSON.stringify({
      passedIds,
      failedIds: failed.map((item) => item.id),
      expectedIds: cases.map((item) => item.id),
    })}`,
  );
  if (failed.length) process.exitCode = 1;
  else console.log("OK: LOT 3 school-setup (contrats déjà satisfaits par LOT 0/1/2)");
}

void main();
