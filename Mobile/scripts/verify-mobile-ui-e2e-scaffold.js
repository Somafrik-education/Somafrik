/**
 * Scaffold Maestro (fichiers YAML présents). Ce n'est PAS une exécution black-box de l'APK.
 * Lot runtime : SOMAFRIK_RUN_MAESTRO=1.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const MAESTRO = path.join(MOBILE, "maestro");

const REQUIRED = [
  "01-login-admin-school.yaml",
  "02-home-metrics.yaml",
  "03-users-matches-home.yaml",
  "04-classes-presence.yaml",
  "05-payments.yaml",
  "06-teachers.yaml",
  "07-attendance.yaml",
  "08-notes.yaml",
  "09-partial-domain-error.yaml",
  "10-relaunch-no-catalog.yaml",
];

function main() {
  for (const name of REQUIRED) {
    const file = path.join(MAESTRO, name);
    assert.ok(fs.existsSync(file), `parcours manquant: ${name}`);
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /appId:\s*com\.somafrik\.app/);
  }
  console.log(`OK: scaffold Maestro ${REQUIRED.length} YAML (appId com.somafrik.app) — pas d'exécution APK`);

  if (process.env.SOMAFRIK_RUN_MAESTRO === "1") {
    const result = spawnSync("maestro", ["test", MAESTRO], { encoding: "utf8", cwd: MOBILE });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "maestro test failed");
    }
    process.stdout.write(result.stdout || "");
    return;
  }
  console.log("SKIP run: définir SOMAFRIK_RUN_MAESTRO=1 pour piloter l'APK installé");
}

main();
