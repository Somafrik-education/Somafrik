/**
 * E2E 0019 : Navigation principale mobile (bottom tabs)
 *
 * Scénarios :
 *   - Admin établissement connecté
 *   - Navigation Accueil → Classes → Enseignants → Menu
 *   - Barre toujours visible, transitions fluides, retour fonctionnel
 *
 * Prérequis : backend + mobile web (voir verify:e2e-0017)
 *
 *   SOMAFRIK_MOBILE_WEB_URL=http://127.0.0.1:19006 npm run verify:e2e-0019
 */
const assert = require("assert");
const {
  login,
  getState,
  putStatePatch,
  newId,
  pushResult,
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
  navigateToTabScreen,
  assertTabBarVisible,
  clickTab,
  testIdSelector,
  waitForWelcomeReady,
  TAB_TEST_IDS,
  HOME_TEST_IDS,
  NAVIGATION_TEST_IDS,
  CLASSES_STUDENT_TEST_IDS,
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

async function setupNavigationFixtures() {
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

async function runNavigationUiTests(fixtures, results) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  const warmupPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await warmupPage.goto(MOBILE_WEB_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await waitForWelcomeReady(warmupPage);
  await warmupPage.close();

  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });

  try {
    await loginAsSchoolAdmin(page, MOBILE_WEB_URL, fixtures, results);
    await assertTabBarVisible(page, results, "Connexion — Barre de navigation");

    await navigateToTabScreen(
      page,
      TAB_TEST_IDS.accueil,
      "Accueil",
      HOME_TEST_IDS.adminDashboard,
      results,
      'Onglet "Accueil"',
    );
    pushUiResult(
      results,
      'Accueil — Repère "Vue d\'ensemble"',
      NAVIGATION_TEST_IDS.homeOverviewTitle,
      (await page.locator(testIdSelector(NAVIGATION_TEST_IDS.homeOverviewTitle)).isVisible())
        ? "visible"
        : "absent",
      await page.locator(testIdSelector(NAVIGATION_TEST_IDS.homeOverviewTitle)).isVisible(),
    );

    await navigateToTabScreen(
      page,
      TAB_TEST_IDS.classes,
      "Classes",
      CLASSES_STUDENT_TEST_IDS.classesScreen,
      results,
      'Onglet "Classes"',
    );
    const classesTitle = (await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesTitle)).innerText()).trim();
    pushUiResult(results, 'Classes — Titre écran', "Classes", classesTitle, classesTitle === "Classes");

    await navigateToTabScreen(
      page,
      TAB_TEST_IDS.teachers,
      "Enseignants",
      NAVIGATION_TEST_IDS.teachersScreen,
      results,
      'Onglet "Enseignants"',
    );
    const teachersTitle = (await page.locator(testIdSelector(NAVIGATION_TEST_IDS.teachersTitle)).innerText()).trim();
    pushUiResult(results, 'Enseignants — Titre écran', "Enseignants", teachersTitle, teachersTitle === "Enseignants");

    await navigateToTabScreen(
      page,
      TAB_TEST_IDS.menu,
      "Menu",
      NAVIGATION_TEST_IDS.menuScreen,
      results,
      'Onglet "Menu"',
    );
    const menuTitle = (await page.locator(testIdSelector(NAVIGATION_TEST_IDS.menuTitle)).innerText()).trim();
    pushUiResult(results, 'Menu — Titre écran', "Menu", menuTitle, menuTitle === "Menu");

    // Retour depuis liste élèves → classes, barre toujours visible
    await clickTab(page, TAB_TEST_IDS.classes, "Classes");
    await page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    });
    await page.locator(testIdSelector(classCardTestId(fixtures.className))).click();
    await page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsScreen), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    });
    await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsBackButton)).click();
    await page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    });
    pushUiResult(
      results,
      "Retour — Liste classes affichée",
      CLASSES_STUDENT_TEST_IDS.classesScreen,
      "visible",
      await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen)).isVisible(),
    );
    await assertTabBarVisible(page, results, "Retour — Barre de navigation");

    // Cycle complet sans perte de barre
    await clickTab(page, TAB_TEST_IDS.menu, "Menu");
    await page.waitForSelector(testIdSelector(NAVIGATION_TEST_IDS.menuScreen), { timeout: LOGIN_MAX_MS });
    await clickTab(page, TAB_TEST_IDS.accueil, "Accueil");
    await page.locator(testIdSelector(HOME_TEST_IDS.adminDashboard)).waitFor({ state: "visible", timeout: LOGIN_MAX_MS });
    pushUiResult(
      results,
      "Navigation — Pas de crash après cycle onglets",
      "accueil visible",
      (await page.locator(testIdSelector(HOME_TEST_IDS.adminDashboard)).isVisible()) ? "accueil visible" : "absent",
      await page.locator(testIdSelector(HOME_TEST_IDS.adminDashboard)).isVisible(),
    );
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
    fixtures = await setupNavigationFixtures();
    pushUiResult(results, "2. Données navigation préparées", fixtures.schoolCode, fixtures.className, true);
  } catch (error) {
    pushUiResult(results, "2. Données navigation préparées", "OK", error.message, false);
    printReport(results, null);
    process.exit(1);
  }

  await runNavigationUiTests(fixtures, results);
  printReport(results, fixtures);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0019 : OK");
}

function printReport(results, fixtures) {
  console.log("\n=== E2E 0019 : Navigation principale mobile ===");
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
