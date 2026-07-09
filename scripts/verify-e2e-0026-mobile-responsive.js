/**
 * E2E 0026 / UI-UX 11 : Adaptation aux tailles d'écran (responsive mobile)
 *
 * Scénarios :
 *   - Petit Android, grand Android, iPhone standard, tablette
 *   - Portrait prioritaire + paysage téléphone
 *   - Welcome : éléments visibles, pas de texte coupé
 *   - Authentifié : Accueil + Classes équilibrés, barre d'onglets, pas de scroll horizontal
 *
 * Prérequis :
 *   1. Backend : SOMAFRIK_SKIP_DEMO_SEED=false npm run backend
 *   2. Mobile web : cd Mobile && $env:EXPO_PUBLIC_API_URL='http://127.0.0.1:5000'; npx expo start --web --port 19006
 *
 *   npm run verify:e2e-0026
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
  pushResult,
  loadPlaywright,
  waitForWelcomeReady,
  assertWelcomeScreenUi,
  loginAsSchoolAdmin,
  assertResponsiveAuthenticatedUi,
  RESPONSIVE_VIEWPORTS,
} = require("./e2e-mobile-ui-helpers");

const MOBILE_WEB_URL = (process.env.SOMAFRIK_MOBILE_WEB_URL || "http://127.0.0.1:19006").replace(/\/$/, "");
const CLASS_NAME = "6ème A";

process.env.SOMAFRIK_E2E_LOGIN_MAX_MS = process.env.SOMAFRIK_E2E_LOGIN_MAX_MS || "24000";

async function probe(url, timeoutMs = 20000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok || response.status === 304;
  } catch {
    return false;
  }
}

const DEMO_SUPERADMIN_PASSWORD = "1234";

async function assertDemoSeedAvailable() {
  try {
    const response = await fetch(`${base.replace(/\/api$/, "")}/api/schools`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return false;
    const schools = await response.json();
    return Array.isArray(schools) && schools.length > 0;
  } catch {
    return false;
  }
}

async function detectDatabaseEngine() {
  const healthUrl = `${base.replace(/\/api$/, "")}/api/health`;
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return "postgresql";
    const payload = await response.json();
    return payload?.database === "memory" ? "memory" : "postgresql";
  } catch {
    return "postgresql";
  }
}

async function loginSuperAdmin() {
  const engine = await detectDatabaseEngine();
  const password = engine === "memory" ? DEMO_SUPERADMIN_PASSWORD : SUPERADMIN_PASSWORD;
  return login(SUPERADMIN_ID, password);
}

async function setupFixtures() {
  const superToken = await loginSuperAdmin();
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
  };
}

function printReport(results) {
  console.log("\n--- E2E 0026 Responsive mobile ---\n");
  for (const row of results) {
    const status = row.OK ? "OK" : "KO";
    console.log(`[${status}] ${row.Etape}`);
    if (!row.OK) {
      console.log(`      Attendu : ${row.Attendu}`);
      console.log(`      Obtenu  : ${row.Obtenu}`);
    }
  }
  const passed = results.filter((row) => row.OK).length;
  const failed = results.length - passed;
  console.log(`\nTotal : ${passed}/${results.length} OK${failed ? ` (${failed} KO)` : ""}\n`);
}

async function main() {
  const results = [];

  const apiOk = await probe(`${base.replace(/\/api$/, "")}/api/health`);
  const seedOk = await assertDemoSeedAvailable();
  pushResult(results, "0. Backend API accessible", "ok", apiOk ? "ok" : "indisponible", apiOk);
  pushResult(
    results,
    "1. Données démo disponibles",
    "seed actif",
    seedOk ? "seed actif" : "SOMAFRIK_SKIP_DEMO_SEED=true ou backend PostgreSQL requis",
    seedOk,
  );

  const mobileOk = await probe(MOBILE_WEB_URL);
  pushResult(results, "2. Application mobile web accessible", MOBILE_WEB_URL, mobileOk ? MOBILE_WEB_URL : "indisponible", mobileOk);

  if (!apiOk || !seedOk || !mobileOk) {
    console.error(
      "\nPrérequis manquants.\n" +
        "Backend : SOMAFRIK_SKIP_DEMO_SEED=false npm run backend\n" +
        "Mobile  : cd Mobile && npx expo start --web --port 19006\n",
    );
    printReport(results);
    process.exit(1);
  }

  const fixtures = await setupFixtures();
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  try {
    const warmupContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const warmupPage = await warmupContext.newPage();
    await warmupPage.goto(MOBILE_WEB_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
    await waitForWelcomeReady(warmupPage);
    await warmupContext.close();

    for (const viewport of RESPONSIVE_VIEWPORTS) {
      const stepPrefix = `${viewport.name} (${viewport.width}×${viewport.height})`;
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.isMobile !== false,
        hasTouch: true,
      });
      const page = await context.newPage();

      await page.goto(MOBILE_WEB_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitForWelcomeReady(page);
      await assertWelcomeScreenUi(page, viewport, results, `${stepPrefix} Welcome`);

      await loginAsSchoolAdmin(page, MOBILE_WEB_URL, fixtures, results);
      await assertResponsiveAuthenticatedUi(page, viewport, results, stepPrefix);

      await context.close();
    }
  } finally {
    await browser.close();
  }

  printReport(results);
  const allOk = results.every((row) => row.OK);
  process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
