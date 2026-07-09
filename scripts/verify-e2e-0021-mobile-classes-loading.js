/**
 * E2E 0021 : États de chargement mobile — écran Classes
 *
 * Scénario :
 *   Étant donné que l'utilisateur est connecté
 *   Quand il ouvre l'écran des classes
 *   Alors un indicateur de chargement est affiché
 *   Et la liste des classes s'affiche après récupération des données
 *   Et l'indicateur disparaît
 *
 * Prérequis :
 *   1. Backend API : npm run backend
 *   2. Mobile web  : cd Mobile && npx expo start --web --port 19006
 *
 *   npm run verify:e2e-0021
 */
const assert = require("assert");
const {
  login,
  getState,
  putStatePatch,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  ADMIN_PASSWORD,
  resolveSchoolContext,
  base,
} = require("./e2e-api-helpers");
const { saveSchoolClassFlow } = require("./e2e-class-rules");
const {
  pushResult: pushUiResult,
  loadPlaywright,
  loginAsSchoolAdmin,
  armClassesLoadingDelay,
  assertClassesLoadingUi,
  assertClassesLoadedUi,
  clickTab,
  testIdSelector,
  waitForWelcomeReady,
  waitForSchoolAdminHome,
  TAB_TEST_IDS,
  CLASSES_STUDENT_TEST_IDS,
  CLASSES_LOADING_TEST_IDS,
  classCardTestId,
  LOGIN_MAX_MS,
} = require("./e2e-mobile-ui-helpers");

const MOBILE_WEB_URL = (process.env.SOMAFRIK_MOBILE_WEB_URL || "http://127.0.0.1:19006").replace(/\/$/, "");
const CLASS_NAME = "6ème A";

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return response.ok || response.status === 304;
  } catch {
    return false;
  }
}

async function setupFixtures() {
  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolName, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);
  let state = await getState(adminToken);

  const classFlow = saveSchoolClassFlow(
    state,
    {
      name: CLASS_NAME,
      level: "6ème",
      track: "Générale",
      cycle: "Collège",
      schoolYear: "2025-2026",
      capacity: "30",
      status: "Active",
    },
    schoolCode,
  );
  assert.ok(classFlow.ok, classFlow.error);
  state = await putStatePatch(adminToken, classFlow.patch);

  return {
    schoolCode,
    schoolName,
    adminIdentifier: schoolAdminIdentifier,
    adminPassword: ADMIN_PASSWORD,
    className: CLASS_NAME,
  };
}

async function runLoadingUiTests(fixtures, results) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  const warmupPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await warmupPage.goto(MOBILE_WEB_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await waitForWelcomeReady(warmupPage);
  await warmupPage.close();

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });

  try {
    await loginAsSchoolAdmin(page, MOBILE_WEB_URL, fixtures, results);
    await waitForSchoolAdminHome(page);

    const triggerClassesLoadingDelay = await armClassesLoadingDelay(page);
    triggerClassesLoadingDelay();
    await clickTab(page, TAB_TEST_IDS.classes, "Classes");
    await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen)).waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    });

    await page.locator(testIdSelector(CLASSES_LOADING_TEST_IDS.loadingIndicator)).waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    });
    await assertClassesLoadingUi(page, results, "Classes");

    const addButton = page.locator(testIdSelector(CLASSES_LOADING_TEST_IDS.addClassButton));
    if ((await addButton.count()) > 0) {
      await addButton.click({ force: true }).catch(() => null);
      await addButton.click({ force: true }).catch(() => null);
      const stillOnClasses = await page
        .locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen))
        .isVisible();
      pushUiResult(
        results,
        "Classes — Pas de double action pendant chargement",
        "écran Classes",
        stillOnClasses ? "écran Classes" : "navigation",
        stillOnClasses,
      );
    }

    await assertClassesLoadedUi(page, results, fixtures.className, "Classes");
  } finally {
    await browser.close();
  }
}

async function main() {
  const results = [];
  const apiOk = await probe(`${base.replace(/\/api$/, "")}/api/health`);
  const mobileOk = await probe(MOBILE_WEB_URL);
  pushUiResult(results, "0. Backend API accessible", base, apiOk ? "OK" : "indisponible", apiOk);
  pushUiResult(results, "1. Mobile web accessible", MOBILE_WEB_URL, mobileOk ? "OK" : "indisponible", mobileOk);
  if (!apiOk || !mobileOk) {
    printReport(results, null);
    process.exit(1);
  }

  let fixtures;
  try {
    fixtures = await setupFixtures();
    pushUiResult(results, "2. Données classes préparées", fixtures.schoolCode, fixtures.className, true);
  } catch (error) {
    pushUiResult(results, "2. Données classes préparées", "OK", error.message, false);
    printReport(results, null);
    process.exit(1);
  }

  await runLoadingUiTests(fixtures, results);
  printReport(results, fixtures);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0021 : OK");
}

function printReport(results, fixtures) {
  console.log("\n=== E2E 0021 : États de chargement — Classes ===");
  console.log(`URL mobile web : ${MOBILE_WEB_URL}`);
  if (fixtures) {
    console.log(`Établissement   : ${fixtures.schoolCode}`);
    console.log(`Admin           : ${fixtures.adminIdentifier}`);
    console.log(`Classe test     : ${fixtures.className}\n`);
  }
  console.table(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
