/**
 * Exécute la suite E2E mobile (Expo web requis — port 8083 par défaut via Docker).
 *   npm run verify:e2e-mobile
 *   SOMAFRIK_SKIP_MOBILE_E2E=true npm run verify:e2e-mobile
 */
const { spawnSync } = require("child_process");
const { probeMobileWeb, DEFAULT_MOBILE_WEB_URL } = require("./e2e-mobile-ui-helpers");

const MOBILE_SCRIPTS = [
  "verify:e2e-0010",
  "verify:e2e-0017",
  "verify:e2e-0018",
  "verify:e2e-0019",
  "verify:e2e-0020",
  "verify:e2e-0021",
  "verify:e2e-0022",
  "verify:e2e-0023",
  "verify:e2e-0024",
  "verify:e2e-0025",
  "verify:e2e-0026",
  "verify:e2e-0027",
];

async function main() {
  if (process.env.SOMAFRIK_SKIP_MOBILE_E2E === "true") {
    console.log("SKIP : suite mobile E2E désactivée (SOMAFRIK_SKIP_MOBILE_E2E=true).");
    process.exit(0);
  }

  const reachable = await probeMobileWeb(DEFAULT_MOBILE_WEB_URL);
  if (!reachable) {
    console.error(
      `Serveur mobile introuvable (${DEFAULT_MOBILE_WEB_URL}).\n` +
        "Lancez : npm run docker:up  (Expo port 8083) ou npm run mobile:web\n" +
        "Ou : SOMAFRIK_SKIP_MOBILE_E2E=true npm run verify:e2e-mobile",
    );
    if (process.env.SOMAFRIK_REQUIRE_MOBILE_E2E === "true") {
      process.exit(1);
    }
    console.log("SKIP : suite mobile E2E ignorée.");
    process.exit(0);
  }

  const failures = [];
  for (const script of MOBILE_SCRIPTS) {
    console.log(`\n=== ${script} ===\n`);
    const result = spawnSync("npm", ["run", script], {
      stdio: "inherit",
      shell: true,
      env: process.env,
    });
    if ((result.status ?? 1) !== 0) {
      failures.push({ script, code: result.status ?? 1 });
    }
  }

  console.log("\n=== Résumé E2E mobile ===");
  if (!failures.length) {
    console.log(`OK : ${MOBILE_SCRIPTS.length} script(s) réussi(s).`);
    process.exit(0);
  }

  for (const failure of failures) {
    console.error(`KO : ${failure.script} (code ${failure.code})`);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
