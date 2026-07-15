/**
 * Vérifie la connexion superadmin via l'API locale (sans journaliser le mot de passe).
 */
const { spawnSync } = require("child_process");
const path = require("path");
const { loadPreprodEnv } = require("../../scripts/validate-preprod-env");

const repoRoot = path.join(__dirname, "..", "..");

function main() {
  const validation = loadPreprodEnv();
  if (!validation.ok) {
    console.error("Configuration invalide.");
    process.exit(1);
  }

  const identifier = validation.env.BOOTSTRAP_SUPERADMIN_ID || "superadmin";
  const password = validation.env.BOOTSTRAP_SUPERADMIN_PASSWORD;
  const payload = JSON.stringify({ identifier, password });

  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      "docker-compose.preprod.yml",
      "--env-file",
      ".env.preproduction",
      "exec",
      "-T",
      "backend",
      "wget",
      "-qO-",
      "--header=Content-Type: application/json",
      `--post-data=${payload}`,
      "http://127.0.0.1:5000/api/backoffice/login",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  if (result.status !== 0) {
    console.error("Echec appel login:", result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  try {
    const body = JSON.parse(result.stdout);
    if (body.user?.role) {
      console.log("Login OK:", body.user.role, body.user.identifier ?? identifier);
      process.exit(0);
    }
    console.error("Reponse inattendue:", result.stdout.slice(0, 300));
    process.exit(1);
  } catch {
    console.error("Reponse non JSON:", result.stdout.slice(0, 300));
    process.exit(1);
  }
}

main();
