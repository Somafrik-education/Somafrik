/**
 * Préparation des tests E2E API : backend joignable, verrous login réinitialisés.
 *
 *   npm run verify:e2e-preflight
 */
const { spawnSync } = require("child_process");
const { base, clearLoginLockout, probeBackend } = require("./e2e-api-helpers");

async function main() {
  const ok = await probeBackend();
  if (!ok) {
    console.error(`Backend inaccessible (${base}). Lancez : npm run docker:up:core`);
    process.exit(1);
  }
  console.log(`Backend OK (${base})`);

  await clearLoginLockout();
  console.log("Verrous de connexion E2E réinitialisés (si endpoint actif).");

  if (process.env.SOMAFRIK_E2E_SKIP_BOOTSTRAP === "true") {
    console.log("Bootstrap superadmin ignoré (SOMAFRIK_E2E_SKIP_BOOTSTRAP=true).");
    return;
  }

  console.log("Bootstrap mot de passe E2E superadmin…");
  const bootstrap = spawnSync(
    "docker",
    ["compose", "exec", "-T", "backend", "node", "scripts/bootstrap-e2e-superadmin.js", "--confirm"],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (bootstrap.status !== 0) {
    console.warn(
      "Bootstrap E2E non exécuté (Docker indisponible ?). Utilisez le mot de passe SOMAFRIK_E2E_SUPERADMIN_PASSWORD.",
    );
  } else {
    console.log("Bootstrap E2E terminé.");
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
