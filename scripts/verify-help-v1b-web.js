"use strict";

/**
 * HELP-V1B — Gate d'intégration Web.
 * Pas de Mobile, pas d'API, pas d'IA.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") return [];
      return walk(target);
    }
    return [target];
  });
}

function readRepo(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertSourceGuards() {
  const layout = readRepo("web/src/components/layout/AppLayout.tsx");
  assert.match(layout, /lazy\(\(\) =>\s*import\("\.\.\/\.\.\/help\/HelpHost"/);
  assert.match(layout, /<HelpHost \/>/);

  const landing = readRepo("web/src/pages/LandingPage.tsx");
  const login = readRepo("web/src/pages/LoginPage.tsx");
  assert.doesNotMatch(landing, /help-catalog|HelpHost|HelpTrigger|HelpPanel|Besoin d['’]aide/);
  assert.doesNotMatch(login, /help-catalog|HelpHost|HelpTrigger|HelpPanel|Besoin d['’]aide/);
  assert.doesNotMatch(landing, /@somafrik\/help-catalog/);
  assert.doesNotMatch(login, /@somafrik\/help-catalog/);

  const helpDir = walk(path.join(ROOT, "web/src/help"))
    .filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes(".test."))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  assert.match(helpDir, /@somafrik\/help-catalog/);
  assert.match(helpDir, /createHelpContext|isHelpAvailable|searchHelpArticles/);
  assert.doesNotMatch(helpDir, /\/api\/help/);
  assert.doesNotMatch(helpDir, /Intercom|Crisp|Zendesk|OpenAI|Anthropic/);
  assert.doesNotMatch(helpDir, /google-services/);
  assert.doesNotMatch(helpDir, /from ["']react-native/);
  assert.doesNotMatch(helpDir, /help\/grades\/create-evaluation|help\/grades\/enter/);

  const host = readRepo("web/src/help/HelpHost.tsx");
  assert.match(host, /buildWebHelpContext/);
  assert.match(host, /session\?\.user\?\.role/);
  assert.match(host, /permissions/);
  assert.doesNotMatch(host, /\baccessToken\b|\brefreshToken\b|\bjwt\b|\bstudentId\b/);
  assert.doesNotMatch(host, /createHelpContext\(/);
  assert.doesNotMatch(readRepo("web/src/help/buildWebHelpContext.ts"), /accessToken|jwt|studentId|password/);

  const trigger = readRepo("web/src/help/HelpTrigger.tsx");
  assert.match(trigger, /aria-label="Ouvrir l.aide"/);
  assert.match(trigger, /aria-expanded/);

  const panel = readRepo("web/src/help/HelpPanel.tsx");
  assert.match(panel, /navigationIsAllowed/);
  assert.match(panel, /role="dialog"/);
  assert.doesNotMatch(panel, /api\.(post|put|patch|delete)/);
  assert.doesNotMatch(panel, /Créer la classe|Enregistrer l['’]appel|Saisir un paiement/);
  assert.doesNotMatch(panel, /\/support/);

  const viteConfig = readRepo("web/vite.config.ts");
  assert.match(viteConfig, /packages\/help-catalog/);
  assert.doesNotMatch(
    viteConfig,
    /packages\/help-catalog[\s\S]{0,80}\/src\/help\//,
    "ne pas fusionner web/src/help dans le chunk catalogue (vitrine)",
  );
  assert.equal(fs.existsSync(path.join(ROOT, "Mobile/src/help")), false, "HELP-V1B ne doit pas ajouter Mobile/src/help");
  assert.doesNotMatch(readRepo("backend/server.js"), /\/api\/help/);

  console.log("verify-help-v1b-web: source guards OK");
}

function runUnitTests() {
  const result = spawnSync(
    "npm",
    [
      "--prefix",
      "web",
      "run",
      "test",
      "--",
      "src/help/HelpHost.test.tsx",
      "src/help/buildWebHelpContext.test.ts",
      "src/pages/LandingPage.test.tsx",
      "src/pages/LoginPage.helpAbsence.test.tsx",
    ],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, VITE_API_URL: "https://api.somafrik.app" } },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, "tests HELP-V1B Web ont échoué");
}

function main() {
  assertSourceGuards();
  runUnitTests();
  console.log("verify-help-v1b-web: GO");
}

main();
