/**
 * S2.4 — Contrôle local des secrets via Gitleaks (équivalent job Secrets).
 *
 * Prérequis : binaire `gitleaks` sur le PATH (https://github.com/gitleaks/gitleaks)
 * Usage : npm run verify:secrets
 */
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const GITLEAKS_VERSION_PIN = "8.24.3";

function main() {
  const version = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  if (version.error || version.status !== 0) {
    console.error(
      [
        "gitleaks introuvable sur le PATH.",
        `Installez la version pinée ${GITLEAKS_VERSION_PIN} :`,
        "  https://github.com/gitleaks/gitleaks/releases",
        "Puis relancez : npm run verify:secrets",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(String(version.stdout || version.stderr || "").trim());
  const detect = spawnSync(
    "gitleaks",
    ["detect", "--source", ROOT, "--verbose", "--redact", "--exit-code", "1"],
    { encoding: "utf8", cwd: ROOT },
  );

  if (detect.stdout) process.stdout.write(detect.stdout);
  if (detect.stderr) process.stderr.write(detect.stderr);

  if (detect.status !== 0) {
    console.error("verify:secrets FAILED — fuite(s) détectée(s)");
    process.exit(detect.status || 1);
  }

  console.log("verify:secrets SUCCESS");
}

main();
