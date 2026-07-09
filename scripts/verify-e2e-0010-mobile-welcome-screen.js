/**
 * E2E 0010 : Ouverture de l'application mobile — écran d'accueil
 *
 * Scénario :
 *   Étant donné que l'application Somafrik est installée
 *   Quand l'utilisateur ouvre l'application
 *   Alors le logo Somafrik est affiché
 *   Et le nom de la plateforme est lisible
 *   Et le bouton « Se connecter » est visible
 *   Et l'écran ne présente aucun élément coupé
 *   Et l'affichage est adapté à la taille de l'écran
 *
 * Prérequis :
 *   1. Version web Expo de l'app mobile (proxy du rendu mobile/tablette) :
 *        cd Mobile && npx expo start --web --port 19006
 *   2. Playwright :
 *        npm install -D playwright && npx playwright install chromium
 *
 *   npm run verify:e2e-0010
 *   SOMAFRIK_MOBILE_WEB_URL=http://127.0.0.1:19006 npm run verify:e2e-0010
 */
const {
  MOBILE_VIEWPORTS,
  WELCOME_MAX_DISPLAY_MS,
  pushResult,
  loadPlaywright,
  waitForWelcomeReady,
  measureWelcomeDisplayMs,
  assertWelcomeScreenUi,
} = require("./e2e-mobile-ui-helpers");

const MOBILE_WEB_URL = (process.env.SOMAFRIK_MOBILE_WEB_URL || "http://127.0.0.1:19006").replace(/\/$/, "");

async function probeMobileWeb(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return response.ok || response.status === 304;
  } catch {
    return false;
  }
}

async function main() {
  const results = [];
  const reachable = await probeMobileWeb(MOBILE_WEB_URL);
  pushResult(
    results,
    "0. Application mobile accessible",
    MOBILE_WEB_URL,
    reachable ? MOBILE_WEB_URL : "indisponible",
    reachable,
  );
  if (!reachable) {
    console.error(
      `\nServeur mobile web introuvable à ${MOBILE_WEB_URL}.\n` +
        "Lancez : cd Mobile && npx expo start --web --port 19006\n",
    );
    printReport(results);
    process.exit(1);
  }

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  try {
    // Warm-up : premier chargement Expo web (bundle) hors boucle viewports.
    const warmupContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const warmupPage = await warmupContext.newPage();
    await measureWelcomeDisplayMs(warmupPage, MOBILE_WEB_URL);
    await warmupContext.close();

    for (const viewport of MOBILE_VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();

      const displayMs = await measureWelcomeDisplayMs(page, MOBILE_WEB_URL);
      pushResult(
        results,
        `${viewport.name} — Temps d'affichage`,
        `≤ ${WELCOME_MAX_DISPLAY_MS} ms`,
        `${displayMs} ms`,
        displayMs <= WELCOME_MAX_DISPLAY_MS,
      );

      await waitForWelcomeReady(page);
      await assertWelcomeScreenUi(page, viewport, results, viewport.name);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  printReport(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0010 : OK");
}

function printReport(results) {
  console.log("\n=== E2E 0010 : Ouverture application mobile (Welcome) ===");
  console.log(`URL mobile web : ${MOBILE_WEB_URL}`);
  console.log(`Viewports      : ${MOBILE_VIEWPORTS.map((v) => v.name).join(", ")}\n`);
  console.table(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
