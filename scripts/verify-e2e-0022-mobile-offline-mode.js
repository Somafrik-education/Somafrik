/**
 * E2E 0022 : Mode hors connexion mobile
 *
 * Scénario :
 *   Étant donné que l'utilisateur est connecté
 *   Quand la connexion internet est interrompue
 *   Alors un message indique que l'utilisateur est hors connexion
 *   Et les données déjà chargées restent consultables
 *   Et les actions nécessitant internet sont désactivées ou mises en attente
 *
 *   npm run verify:e2e-0022
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
  assertClassesLoadedUi,
  assertOfflineBannerVisible,
  assertOfflineBannerHidden,
  assertCachedClassVisible,
  assertOfflineActionBlocked,
  clickTab,
  testIdSelector,
  waitForWelcomeReady,
  waitForSchoolAdminHome,
  TAB_TEST_IDS,
  CLASSES_STUDENT_TEST_IDS,
  CLASSES_LOADING_TEST_IDS,
  classCardTestId,
  LOGIN_MAX_MS,
  DEFAULT_MOBILE_WEB_URL,
} = require("./e2e-mobile-ui-helpers");

const MOBILE_WEB_URL = DEFAULT_MOBILE_WEB_URL;

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return response.ok || response.status === 304;
  } catch {
    return false;
  }
}

async function setupFixtures() {
  const className = `CLS-OFF-${String(Date.now()).slice(-4)}`;
  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolName, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);
  let state = await getState(adminToken);

  const classFlow = saveSchoolClassFlow(
    state,
    {
      name: className,
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
    className,
  };
}

async function runOfflineUiTests(fixtures, results) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  const warmupPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await warmupPage.goto(MOBILE_WEB_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await waitForWelcomeReady(warmupPage);
  await warmupPage.close();

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();

  try {
    await loginAsSchoolAdmin(page, MOBILE_WEB_URL, fixtures, results);
    await waitForSchoolAdminHome(page);

    await clickTab(page, TAB_TEST_IDS.classes, "Classes");
    await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen)).waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    });
    await assertClassesLoadedUi(page, results, fixtures.className, "Connexion");

    await context.setOffline(true);
    pushUiResult(results, "Hors ligne — Mode activé", "offline", "offline", true);

    await clickTab(page, TAB_TEST_IDS.accueil, "Accueil");
    await clickTab(page, TAB_TEST_IDS.classes, "Classes");
    await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen)).waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    });
    await page.locator(testIdSelector(classCardTestId(fixtures.className))).waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    });

    await assertOfflineBannerVisible(page, results, "Hors ligne");
    await assertCachedClassVisible(page, results, fixtures.className, "Hors ligne");
    await assertOfflineActionBlocked(page, results, "Hors ligne");

    const stillOnClasses = await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen)).isVisible();
    pushUiResult(
      results,
      "Hors ligne — Pas de crash application",
      CLASSES_STUDENT_TEST_IDS.classesScreen,
      stillOnClasses ? "visible" : "absent",
      stillOnClasses,
    );

    await context.setOffline(false);
    pushUiResult(results, "Retour réseau — Mode en ligne", "online", "online", true);

    await clickTab(page, TAB_TEST_IDS.accueil, "Accueil");
    await clickTab(page, TAB_TEST_IDS.classes, "Classes");
    await assertOfflineBannerHidden(page, results, "Retour réseau");
    await page.locator(testIdSelector(classCardTestId(fixtures.className))).waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    });
    await assertCachedClassVisible(page, results, fixtures.className, "Retour réseau");
  } finally {
    await context.close();
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
    pushUiResult(results, "2. Données cache préparées", fixtures.schoolCode, fixtures.className, true);
  } catch (error) {
    pushUiResult(results, "2. Données cache préparées", "OK", error.message, false);
    printReport(results, null);
    process.exit(1);
  }

  await runOfflineUiTests(fixtures, results);
  printReport(results, fixtures);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0022 : OK");
}

function printReport(results, fixtures) {
  console.log("\n=== E2E 0022 : Mode hors connexion mobile ===");
  console.log(`URL mobile web : ${MOBILE_WEB_URL}`);
  if (fixtures) {
    console.log(`Établissement   : ${fixtures.schoolCode}`);
    console.log(`Admin           : ${fixtures.adminIdentifier}`);
    console.log(`Classe cache    : ${fixtures.className}\n`);
  }
  console.table(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
