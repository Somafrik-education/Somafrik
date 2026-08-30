"use strict";

/**
 * HELP-V1C — Gate d'intégration Mobile.
 * Catalogue partagé, host Mobile uniquement, pas d'API, pas d'IA, pas d'ACTION métier.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

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
  const helpDir = path.join(ROOT, "Mobile/src/help");
  assert.equal(fs.existsSync(helpDir), true, "Mobile/src/help doit exister");

  const navigator = readRepo("Mobile/src/navigation/AppNavigator.tsx");
  assert.match(navigator, /import HelpHost from ["']\.\.\/help\/HelpHost["']/);
  assert.match(navigator, /<HelpHost \/>/);
  assert.doesNotMatch(navigator, /@somafrik\/help-catalog/);

  const publicFiles = [
    "Mobile/src/screens/WelcomeScreen.tsx",
    "Mobile/src/screens/RoleSelectionScreen.tsx",
    "Mobile/src/screens/LoginScreen.tsx",
    "Mobile/src/screens/PermissionsScreen.tsx",
    "Mobile/src/components/ConfigurationErrorScreen.tsx",
    "Mobile/App.tsx",
  ];
  for (const file of publicFiles) {
    const src = readRepo(file);
    assert.doesNotMatch(src, /@somafrik\/help-catalog/, `${file} ne doit pas importer le catalogue`);
    assert.doesNotMatch(src, /HelpHost|HelpTrigger|HelpPanel|Besoin d['’]aide/, `${file} ne doit pas monter HELP`);
  }

  const support = readRepo("Mobile/src/screens/MvpUtilityScreens.tsx");
  assert.doesNotMatch(support, /@somafrik\/help-catalog/);
  assert.doesNotMatch(support, /HelpHost|HelpTrigger|HelpPanel/);
  assert.doesNotMatch(readRepo("Mobile/src/help/HelpHost.tsx"), /Support\s*→\s*Messages/);
  assert.doesNotMatch(readRepo("Mobile/src/help/helpAvailability.ts"), /Support\s*→\s*Messages/);

  const helpSources = walk(helpDir)
    .filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes(".test."))
    .map((file) => fs.readFileSync(file, "utf8"));
  const helpBlob = helpSources.join("\n");
  assert.match(helpBlob, /@somafrik\/help-catalog/);
  assert.match(helpBlob, /createHelpContext|isHelpAvailable/);
  assert.match(helpBlob, /searchHelpArticles/);
  assert.match(helpBlob, /suggestHelpArticles/);
  assert.match(helpBlob, /navigationIsAllowed|helpMobileRoute/);
  assert.match(helpBlob, /Besoin d['’]aide/);
  assert.doesNotMatch(helpBlob, /\/api\/help/);
  assert.doesNotMatch(helpBlob, /Intercom|Crisp|Zendesk|OpenAI|Anthropic/);
  assert.doesNotMatch(helpBlob, /google-services/);
  assert.doesNotMatch(helpBlob, /help\/grades\/create-evaluation|help\/grades\/enter/);
  assert.doesNotMatch(helpBlob, /level:\s*["']ACTION["']/);
  assert.doesNotMatch(helpBlob, /api\.(post|put|patch|delete)/i);
  assert.doesNotMatch(helpBlob, /Créer la classe|Enregistrer l['’]appel|Saisir un paiement/);
  assert.doesNotMatch(helpBlob, /\baccessToken\b|\brefreshToken\b|\bjwt\b/);
  assert.doesNotMatch(readRepo("Mobile/src/help/buildMobileHelpContext.ts"), /accessToken|jwt|studentId|password/);
  assert.doesNotMatch(readRepo("Mobile/src/help/HelpHost.tsx"), /createHelpContext\(/);

  const host = readRepo("Mobile/src/help/HelpHost.tsx");
  assert.match(host, /buildHelpContextFromSession|buildMobileHelpContext/);
  assert.match(host, /session/);
  assert.match(host, /permissionsBootstrap/);
  assert.match(host, /subscribeHelpBusinessModal/);
  assert.doesNotMatch(host, /businessModalOpen:\s*false/);
  assert.match(readRepo("Mobile/src/help/helpAvailability.ts"), /ready_offline/);
  assert.match(readRepo("Mobile/src/components/CanonicalMutationModal.tsx"), /reportHelpBusinessModal/);
  assert.match(readRepo("Mobile/src/help/helpBusinessModal.ts"), /reportHelpBusinessModal/);

  const overlay = readRepo("Mobile/src/help/helpOverlayPolicy.ts");
  assert.match(overlay, /HELP_TRIGGER_ZINDEX/);
  assert.match(overlay, /businessModalOpen/);
  assert.match(overlay, /keyboardVisible/);

  const metro = readRepo("Mobile/metro.config.js");
  assert.match(metro, /packages\/help-catalog/);
  assert.match(metro, /nodeModulesPaths/);
  assert.match(metro, /@babel\/runtime/);
  assert.match(metro, /resolveRequest/);
  assert.doesNotMatch(metro, /disableHierarchicalLookup\s*:\s*true/);

  for (const file of walk(path.join(ROOT, "Mobile/src")).filter((item) => /\.(ts|tsx)$/.test(item))) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    if (rel.startsWith("Mobile/src/help/")) continue;
    const src = fs.readFileSync(file, "utf8");
    assert.equal(
      src.includes("@somafrik/help-catalog"),
      false,
      `import catalogue hors host HELP : ${rel}`,
    );
  }

  assert.doesNotMatch(readRepo("backend/server.js"), /\/api\/help/);
  console.log("verify-help-v1c-mobile: source guards OK");
}

async function assertCatalogContract() {
  const mod = await import(pathToFileURL(path.join(ROOT, "packages/help-catalog/src/index.js")).href);
  const {
    HELP_CATALOG,
    createHelpContext,
    filterHelpArticles,
    searchHelpArticles,
    navigationIsAllowed,
  } = mod;

  const ids = HELP_CATALOG.map((article) => article.id);
  assert.equal(ids.includes("help/grades/create-evaluation"), false);
  assert.equal(ids.includes("help/grades/enter"), false);
  assert.equal(ids.includes("help/settings/profile"), true);
  assert.equal(ids.includes("help/settings/profile-edit"), true);

  const readProfile = createHelpContext({
    platform: "mobile",
    routeName: "EstablishmentProfile",
    role: "school_admin",
    permissions: ["Paramètres Établissement:READ"],
  });
  const readIds = filterHelpArticles(readProfile).map((article) => article.id);
  assert.equal(readIds.includes("help/settings/profile"), true);
  assert.equal(readIds.includes("help/settings/profile-edit"), false);

  const teacherHits = searchHelpArticles(
    createHelpContext({
      platform: "mobile",
      routeName: "TeacherGrades",
      role: "teacher",
      permissions: ["Notes:READ", "Utilisateurs:CREATE"],
    }),
    "créer utilisateur",
  );
  assert.equal(teacherHits.some((article) => article.id === "help/users/create"), false);

  const createClass = HELP_CATALOG.find((article) => article.id === "help/classes/create");
  const allowed = createHelpContext({
    platform: "mobile",
    routeName: "Classes",
    role: "school_admin",
    permissions: ["Classes:READ", "Classes:CREATE"],
  });
  const denied = createHelpContext({
    platform: "mobile",
    routeName: "Classes",
    role: "school_admin",
    permissions: ["Classes:READ"],
  });
  assert.equal(navigationIsAllowed(createClass, allowed), true);
  assert.equal(navigationIsAllowed(createClass, denied), false);
}

function runUnitTests() {
  const result = spawnSync("npm", ["run", "test:help-v1c"], {
    cwd: path.join(ROOT, "Mobile"),
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, "tests HELP-V1C Mobile ont échoué");
}

async function main() {
  assertSourceGuards();
  await assertCatalogContract();
  runUnitTests();
  console.log("verify-help-v1c-mobile: GO");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
