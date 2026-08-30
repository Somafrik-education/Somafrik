"use strict";

/**
 * HELP-V1A — Gate du catalogue d'aide embarqué.
 * Pas d'UI, pas d'API, pas d'IA, pas de serveur HTTP.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE_DIR = path.join(ROOT, "packages/help-catalog");

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target);
    return [target];
  });
}

function readRepo(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function packageSources() {
  return walk(path.join(PACKAGE_DIR, "src")).filter((file) => file.endsWith(".js"));
}

function assertSourceGuards() {
  assert.equal(fs.existsSync(path.join(PACKAGE_DIR, "package.json")), true);
  assert.equal(fs.existsSync(path.join(PACKAGE_DIR, "src/index.js")), true);
  assert.equal(fs.existsSync(path.join(PACKAGE_DIR, "src/articles.js")), true);

  const pkg = JSON.parse(readRepo("packages/help-catalog/package.json"));
  assert.equal(pkg.name, "@somafrik/help-catalog");

  const blob = packageSources()
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");

  assert.match(blob, /export const HELP_CATALOG/);
  assert.match(blob, /createHelpContext/);
  assert.match(blob, /filterHelpArticles/);
  assert.match(blob, /searchHelpArticles/);
  assert.match(blob, /suggestHelpArticles/);
  assert.match(blob, /help\/users\/create/);
  assert.match(blob, /help\/parent\/home/);
  assert.match(blob, /help\/grades\/evaluations/);
  assert.doesNotMatch(blob, /help\/grades\/create-evaluation/);
  assert.doesNotMatch(blob, /help\/grades\/enter/);
  assert.doesNotMatch(blob, /from ["']react/);
  assert.doesNotMatch(blob, /require\(["']express/);
  assert.doesNotMatch(blob, /require\(["']pg["']\)/);
  assert.doesNotMatch(blob, /\/api\/help/);
  assert.doesNotMatch(blob, /Intercom|Crisp|Zendesk|OpenAI|Anthropic/);
  assert.doesNotMatch(readRepo("packages/help-catalog/src/articles.js"), /google-services/);
  assert.doesNotMatch(blob, /HelpTrigger|HelpPanel|Besoin d['’]aide/);
  assert.doesNotMatch(blob, /(?:from\s+|import\s*\()\s*["'][^"']*(?:backend|web|Mobile)(?:\/|["'])/);
  assert.doesNotMatch(blob, /CREATE TABLE/);
  assert.ok(
    !/étapes? pour lier un parent/i.test(blob),
    "HELP-V1A ne doit pas publier un parcours d'écriture parent-enfant",
  );

  const mobileSrc = walk(path.join(ROOT, "Mobile/src"))
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(mobileSrc, /@somafrik\/help-catalog/);
  assert.doesNotMatch(mobileSrc, /HelpTrigger|HelpPanel/);

  console.log("verify-help-v1a-catalogue: source guards OK");
}

function runUnitTests() {
  const result = spawnSync(process.execPath, ["--test"], {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, "packages/help-catalog tests ont échoué");
}

function main() {
  assertSourceGuards();
  runUnitTests();
  console.log("verify-help-v1a-catalogue: GO");
}

main();
