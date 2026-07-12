/**
 * Exécute la suite E2E API (sans mobile).
 *   npm run verify:e2e-api
 */
const { spawnSync } = require("child_process");

const API_SCRIPTS = [
  "verify:e2e-onboarding",
  "verify:e2e-0001",
  "verify:e2e-0002",
  "verify:e2e-0003",
  "verify:e2e-0004",
  "verify:e2e-0005",
  "verify:e2e-0006",
  "verify:e2e-0008",
  "verify:e2e-0009",
  "verify:e2e-0011",
  "verify:e2e-0012",
  "verify:e2e-0013",
  "verify:e2e-0028",
  "verify:e2e-0014",
  "verify:e2e-0015",
];

function runNpmScript(scriptName) {
  console.log(`\n=== ${scriptName} ===\n`);
  const result = spawnSync("npm", ["run", scriptName], {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      SOMAFRIK_E2E: process.env.SOMAFRIK_E2E ?? "true",
    },
  });
  return result.status ?? 1;
}

function main() {
  const preflight = spawnSync("npm", ["run", "verify:e2e-preflight"], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (preflight.status !== 0) {
    process.exit(preflight.status ?? 1);
  }

  const failures = [];
  for (const script of API_SCRIPTS) {
    const code = runNpmScript(script);
    if (code !== 0) {
      failures.push({ script, code });
    }
  }

  console.log("\n=== Résumé E2E API ===");
  if (!failures.length) {
    console.log(`OK : ${API_SCRIPTS.length} script(s) réussi(s).`);
    process.exit(0);
  }

  for (const failure of failures) {
    console.error(`KO : ${failure.script} (code ${failure.code})`);
  }
  process.exit(1);
}

main();
