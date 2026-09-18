"use strict";

/**
 * Gate du guide utilisateur « Besoin d’aide ? » (catalogue + Web + Mobile).
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function readRepo(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", ...options });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} ${args.join(" ")} a échoué`);
}

function runMobileTypecheck() {
  const mobileDir = path.join(ROOT, "Mobile");
  const tscLocal = path.join(mobileDir, "node_modules", "typescript", "bin", "tsc");
  assert.equal(
    fs.existsSync(tscLocal),
    true,
    "Mobile/node_modules/typescript manquant — npm ci --prefix Mobile est requis pour le gate HELP",
  );
  run(process.execPath, [tscLocal, "--noEmit", "--project", "tsconfig.json"], { cwd: mobileDir });
}

function main() {
  const workflow = readRepo(".github/workflows/help-user-guide.yml");
  assert.match(readRepo("packages/help-catalog/src/context.js"), /export function sessionHasPermission\(permissions, required\)/);
  assert.match(
    readRepo("packages/help-catalog/src/index.d.ts"),
    /sessionHasPermission\(\s*permissions:\s*readonly string\[\] \| null \| undefined/,
  );
  assert.doesNotMatch(
    readRepo("packages/help-catalog/src/index.d.ts"),
    /sessionHasPermission\(context: HelpContext/,
  );
  assert.match(readRepo("Mobile/metro.config.js"), /nodeModulesPaths/);
  assert.match(readRepo("Mobile/metro.config.js"), /@babel\/runtime/);
  assert.match(readRepo("Mobile/src/help/HelpHost.tsx"), /isMobileHelpSessionReady/);
  assert.doesNotMatch(readRepo("Mobile/src/help/HelpHost.tsx"), /permissionsBootstrap === ["']ready["']/);

  assert.equal(fs.existsSync(path.join(ROOT, "docs/audits/help-user-guide-current-state.md")), true);
  assert.equal(fs.existsSync(path.join(ROOT, "docs/audits/help-web-route-coverage.md")), true);
  assert.match(readRepo("packages/help-catalog/src/screens.js"), /path\.startsWith\("\/examens"\)/);
  assert.match(readRepo("packages/help-catalog/src/screens.js"), /HELP_SCREEN\.EXAMS/);
  assert.match(readRepo("packages/help-catalog/src/articles-refresh.js"), /help\/exams\/sessions/);
  assert.match(readRepo("packages/help-catalog/src/articles-refresh.js"), /help\/platform\/console/);
  assert.match(readRepo("packages/help-catalog/test/web-route-coverage.test.js"), /anti-omission/);
  assert.match(readRepo(".github/workflows/help-user-guide.yml"), /web\/src\/App\.tsx/);
  assert.match(readRepo("packages/help-catalog/src/articles-refresh.js"), /help\/start\/school-setup/);
  assert.match(readRepo("packages/help-catalog/src/articles-refresh.js"), /help\/assistance\/contact/);
  assert.match(readRepo("packages/help-catalog/src/articles-refresh.js"), /Je n’ai pas trouvé la réponse/);
  assert.doesNotMatch(readRepo("packages/help-catalog/src/articles-refresh.js"), /Ajouter un élève/);
  assert.doesNotMatch(readRepo("packages/help-catalog/src/articles.js"), /help\/grades\/create-evaluation/);

  assert.match(readRepo("web/src/help/HelpPanel.tsx"), /Catégories/);
  assert.match(readRepo("web/src/help/HelpPanel.tsx"), /groupHelpArticlesByCategory/);

  assert.equal(fs.existsSync(path.join(ROOT, "Mobile/src/help/HelpHost.tsx")), true);
  assert.match(readRepo("Mobile/src/navigation/AppNavigator.tsx"), /<HelpHost \/>/);
  assert.match(readRepo("Mobile/src/help/HelpHost.tsx"), /buildMobileHelpContext/);
  assert.doesNotMatch(readRepo("Mobile/src/screens/MvpUtilityScreens.tsx"), /help-catalog|HelpHost/);
  assert.doesNotMatch(readRepo("backend/server.js"), /\/api\/help/);

  run(process.execPath, ["--test"], { cwd: path.join(ROOT, "packages/help-catalog") });
  run("npx", ["--yes", "tsx", "--test", "src/help/buildMobileHelpContext.test.ts", "src/help/helpHost.contract.test.ts"], {
    cwd: path.join(ROOT, "Mobile"),
  });
  run("npm", ["--prefix", "web", "run", "test", "--", "src/help/HelpHost.test.tsx", "src/help/buildWebHelpContext.test.ts"], {
    env: { ...process.env, VITE_API_URL: "https://api.somafrik.app" },
  });
  runMobileTypecheck();

  console.log("verify-help-user-guide: GO");
}

main();
