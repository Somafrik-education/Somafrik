/**
 * LOT UI-DATA 1 — Accueil : compteurs depuis snapshots partagés, jamais un 0 technique.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const SRC = path.join(MOBILE, "src");

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

function main() {
  const unit = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", "dataTruth.test.ts")], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (unit.status !== 0) {
    throw new Error(unit.stderr || unit.stdout || "dataTruth.test.ts failed");
  }
  process.stdout.write(unit.stdout || "");

  const home = read(path.join("screens", "HomeScreen.tsx"));
  const context = read(path.join("context", "AdminDataContext.tsx"));

  assert.match(context, /usersSnapshot/);
  assert.match(context, /loadUsers/);
  assert.match(context, /getCanonicalUsers/);
  assert.match(context, /presencesSnapshot/);
  assert.match(home, /usersSnapshot/);
  assert.match(home, /loadUsers/);
  assert.match(home, /presencesSnapshot/);
  assert.match(home, /loadPresences/);
  assert.match(home, /metricLabelFromSnapshot/);
  assert.match(home, /DATA_TRUTH_TEST_IDS\.homeUsersValue/);
  assert.match(home, /DATA_TRUTH_TEST_IDS\.homePresenceValue/);
  assert.match(home, /DATA_TRUTH_TEST_IDS\.homePaymentsValue/);
  assert.doesNotMatch(home, /value=\{String\(activeUsersCount\)\}/);
  assert.doesNotMatch(home, /navigate\("AdminCrud", \{ entity: "users" \}/);
  assert.doesNotMatch(home, /navigate\("AdminCrud", \{ entity: "payments" \}/);
  console.log("OK: Accueil hydrate users/presences/payments et n'affiche pas un 0 avant réponse serveur");
}

main();
