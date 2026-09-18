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

function main() {
  assert.equal(fs.existsSync(path.join(ROOT, "docs/audits/help-user-guide-current-state.md")), true);
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

  console.log("verify-help-user-guide: GO");
}

main();
