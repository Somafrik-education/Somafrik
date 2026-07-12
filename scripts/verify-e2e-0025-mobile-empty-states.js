/**
 * E2E 0025 : États vides mobile — classe sans élèves
 *
 * Scénario :
 *   Étant donné qu'une classe ne contient aucun élève
 *   Quand l'utilisateur ouvre cette classe
 *   Alors un message "Aucun élève disponible" est affiché
 *   Et l'écran reste propre
 *   Et l'utilisateur peut revenir à la liste des classes
 *
 * Prérequis :
 *   1. Backend API : npm run backend
 *   2. Mobile web  : cd Mobile && npx expo start --web --port 19006
 *
 *   npm run verify:e2e-0025
 */
const assert = require("assert");
const {
  login,
  getState,
  putStatePatch,
  newId,
  normalize,
  pushResult,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  ADMIN_PASSWORD,
  resolveSchoolContext,
  base,
} = require("./e2e-api-helpers");
const {
  pushResult: pushUiResult,
  loadPlaywright,
  loginAsSchoolAdmin,
  assertEmptyClassStudentsUi,
  DEFAULT_MOBILE_WEB_URL,
} = require("./e2e-mobile-ui-helpers");

const MOBILE_WEB_URL = DEFAULT_MOBILE_WEB_URL;
const VIEWPORT = { name: "iPhone 13", width: 390, height: 844 };

async function resolveAdminTestContext() {
  try {
    const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
    const context = await resolveSchoolContext(superToken);
    let state = await getState(context.adminToken);
    const users = (state.users ?? []).map((row) =>
      normalize(row.identifier) === normalize(context.schoolAdminIdentifier)
        ? {
            ...row,
            password: ADMIN_PASSWORD,
            temporaryPassword: ADMIN_PASSWORD,
            mustChangePassword: false,
          }
        : row,
    );
    state = await putStatePatch(context.adminToken, { users });
    return {
      ...context,
      adminPassword: ADMIN_PASSWORD,
    };
  } catch {
    const schoolCode = "CD-2026-0001";
    const schoolAdminIdentifier = "admin";
    const adminPassword = "1234";
    const adminToken = await login(schoolAdminIdentifier, adminPassword, schoolCode);
    return {
      schoolCode,
      schoolName: "Universite de Kinshasa",
      schoolAdminIdentifier,
      adminToken,
      adminPassword,
    };
  }
}

async function setupEmptyClassFixtures() {
  const stamp = Date.now();
  const className = `EMP-${String(stamp).slice(-4)}`;

  const { schoolCode, schoolName, schoolAdminIdentifier, adminToken, adminPassword } =
    await resolveAdminTestContext();
  let state = await getState(adminToken);

  state = await putStatePatch(adminToken, {
    classes: [
      {
        id: newId("CLASS"),
        name: className,
        className,
        level: "5ème",
        schoolCode,
        status: "Actif",
      },
      ...(state.classes ?? []),
    ],
  });

  const classStudents = (state.students ?? []).filter(
    (row) => normalize(row.className) === normalize(className),
  );
  assert.strictEqual(classStudents.length, 0, "La classe de test ne doit contenir aucun élève");

  return {
    schoolCode,
    schoolName,
    adminIdentifier: schoolAdminIdentifier,
    adminPassword,
    className,
  };
}

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return response.ok || response.status === 304;
  } catch {
    return false;
  }
}

async function runUiJourney(fixtures, results) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  try {
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await loginAsSchoolAdmin(page, MOBILE_WEB_URL, fixtures, results);
    pushUiResult(results, "Admin connecté", "visible", "visible", true);

    await assertEmptyClassStudentsUi(page, fixtures, results);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const results = [];

  const apiOk = await probe(`${base.replace(/\/api$/, "")}/api/health`).catch(() => probe(`${base}/health`));
  pushUiResult(results, "0. Backend API accessible", base, apiOk ? "OK" : "indisponible", Boolean(apiOk));

  const mobileOk = await probe(MOBILE_WEB_URL);
  pushUiResult(results, "1. Mobile web accessible", MOBILE_WEB_URL, mobileOk ? "OK" : "indisponible", mobileOk);

  if (!apiOk || !mobileOk) {
    console.error("\nPrérequis manquants. Backend + Mobile web requis.\n");
    printReport(results, null);
    process.exit(1);
  }

  let fixtures;
  try {
    fixtures = await setupEmptyClassFixtures();
    pushUiResult(results, "2. Classe vide préparée", fixtures.className, "0 élève", true);
  } catch (error) {
    pushUiResult(results, "2. Classe vide préparée", "OK", error.message, false);
    printReport(results, null);
    process.exit(1);
  }

  await runUiJourney(fixtures, results);
  printReport(results, fixtures);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0025 : OK");
}

function printReport(results, fixtures) {
  console.log("\n=== E2E 0025 : États vides — classe sans élèves ===");
  console.log(`URL mobile web : ${MOBILE_WEB_URL}`);
  console.log(`Viewport       : ${VIEWPORT.name} (${VIEWPORT.width}x${VIEWPORT.height})`);
  if (fixtures) {
    console.log(`Établissement  : ${fixtures.schoolCode} (${fixtures.schoolName})`);
    console.log(`Admin          : ${fixtures.adminIdentifier}`);
    console.log(`Classe vide    : ${fixtures.className}\n`);
  }
  console.table(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
