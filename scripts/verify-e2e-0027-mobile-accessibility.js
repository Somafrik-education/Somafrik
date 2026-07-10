/**
 * E2E 0027 : Accessibilité mobile
 *
 * Scénarios :
 *   - Textes principaux lisibles
 *   - Boutons avec taille tactile suffisante
 *   - Contrastes suffisants
 *   - Champs de formulaire avec libellés compréhensibles
 *   - Messages d'erreur lisibles (rôle alerte)
 *   - Onglets étiquetés pour lecteur d'écran
 *
 * Prérequis :
 *   1. Backend API : npm run backend
 *   2. Mobile web  : cd Mobile && npx expo start --web --port 19006
 *
 *   npm run verify:e2e-0027
 */
const {
  login,
  getState,
  putStatePatch,
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
  assertMobileAccessibilityUi,
} = require("./e2e-mobile-ui-helpers");

const MOBILE_WEB_URL = (process.env.SOMAFRIK_MOBILE_WEB_URL || "http://127.0.0.1:19006").replace(/\/$/, "");
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

    await assertMobileAccessibilityUi(page, MOBILE_WEB_URL, fixtures, results);
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
    const context = await resolveAdminTestContext();
    fixtures = {
      ...context,
      adminIdentifier: context.schoolAdminIdentifier ?? context.adminIdentifier,
    };
    pushUiResult(results, "2. Contexte admin préparé", fixtures.schoolCode, fixtures.schoolName, true);
  } catch (error) {
    pushUiResult(results, "2. Contexte admin préparé", "OK", error.message, false);
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
  console.log("E2E 0027 : OK");
}

function printReport(results, fixtures) {
  console.log("\n=== E2E 0027 : Accessibilité mobile ===");
  console.log(`URL mobile web : ${MOBILE_WEB_URL}`);
  console.log(`Viewport       : ${VIEWPORT.name} (${VIEWPORT.width}x${VIEWPORT.height})`);
  if (fixtures) {
    console.log(`Établissement  : ${fixtures.schoolCode} (${fixtures.schoolName})`);
    console.log(`Admin          : ${fixtures.adminIdentifier}\n`);
  }
  console.table(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
