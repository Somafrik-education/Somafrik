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

  const scopeUnit = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", "scope.test.ts")], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (scopeUnit.status !== 0) {
    throw new Error(scopeUnit.stderr || scopeUnit.stdout || "scope.test.ts failed");
  }
  process.stdout.write(scopeUnit.stdout || "");

  const home = read(path.join("screens", "HomeScreen.tsx"));
  const context = read(path.join("context", "AdminDataContext.tsx"));

  assert.match(context, /usersSnapshot/);
  assert.match(context, /loadUsers/);
  assert.match(context, /getCanonicalUsers/);
  assert.match(context, /presencesSnapshot/);
  assert.match(context, /buildResourceScopeKey/);
  assert.match(context, /buildPrincipalScopeKey/);
  assert.match(context, /scopeHydrationPlan/);
  assert.match(context, /resetTenantResourceCaches/);
  assert.match(context, /resetPrincipalResourceCaches/);
  assert.match(context, /resetResourceCaches/);
  const tenantReset = context.match(
    /const resetTenantResourceCaches = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\);/,
  );
  assert.ok(tenantReset, "resetTenantResourceCaches must be present");
  assert.doesNotMatch(
    tenantReset[0],
    /setSchoolsData/,
    "changement d'école active ne doit pas purger schoolsData",
  );
  const principalReset = context.match(
    /const resetPrincipalResourceCaches = useCallback\(\(\) => \{[\s\S]*?\}, \[resetTenantResourceCaches\]\);/,
  );
  assert.ok(principalReset, "resetPrincipalResourceCaches must be present");
  assert.match(principalReset[0], /setSchoolsData\(\[\]\)/);
  assert.match(context, /resourceScopeKeyRef\.current !== scope/);
  assert.match(context, /withScopedSnapshotData/);
  assert.match(context, /scopeBackOfficeForSession/);
  assert.match(context, /scopeHydrationPlan/);
  const dataTruth = read(path.join("lib", "dataTruth.ts"));
  assert.match(dataTruth, /NO_SESSION_RESOURCE_SCOPE/);
  assert.match(dataTruth, /scopeHydrationPlan/);
  assert.match(dataTruth, /resourceCacheResetKind/);
  assert.match(context, /loadSchools/);
  assert.match(context, /getCanonicalSchools/);
  assert.match(context, /plan\.loadPrincipal/);
  assert.match(context, /loaders\.loadSchools\(\)/);
  assert.match(context, /principalScopeKeyRef\.current !== scope/);
  assert.doesNotMatch(tenantReset[0], /loadSchools/);
  assert.match(home, /loadSchools/);
  assert.match(home, /usersSnapshot/);
  assert.match(home, /loadUsers/);
  assert.match(home, /presencesSnapshot/);
  assert.match(home, /loadPresences/);
  assert.match(home, /loadAnnouncements/);
  assert.match(home, /loadMessages/);
  assert.match(home, /announcementsSnapshot/);
  assert.match(home, /messagesSnapshot/);
  assert.match(home, /metricLabelFromSnapshot/);
  assert.match(home, /DATA_TRUTH_TEST_IDS\.homeUsersValue/);
  assert.match(home, /DATA_TRUTH_TEST_IDS\.homePresenceValue/);
  assert.match(home, /DATA_TRUTH_TEST_IDS\.homePaymentsValue/);
  assert.doesNotMatch(home, /value=\{String\(activeUsersCount\)\}/);
  assert.doesNotMatch(home, /navigate\("AdminCrud", \{ entity: "users" \}/);
  assert.doesNotMatch(home, /navigate\("AdminCrud", \{ entity: "payments" \}/);
  assert.doesNotMatch(home, /announcementsData\.length\} communication/);
  assert.doesNotMatch(home, /messagesData\.length\} échange/);

  const students = read(path.join("screens", "StudentsScreen.tsx"));
  const studentDetail = read(path.join("screens", "StudentDetailScreen.tsx"));
  const studentPresences = read(path.join("screens", "StudentPresencesScreen.tsx"));
  const classes = read(path.join("screens", "ClassesScreen.tsx"));
  for (const [label, source] of [
    ["StudentsScreen", students],
    ["StudentDetailScreen", studentDetail],
    ["StudentPresencesScreen", studentPresences],
    ["ClassesScreen", classes],
  ]) {
    assert.match(source, /metricLabelFromSnapshot/, `${label} must use metricLabelFromSnapshot`);
  }
  assert.match(students, /presenceRateLabel/);
  assert.match(students, /paymentRateLabel/);
  assert.match(studentDetail, /notesValue/);
  assert.match(studentDetail, /presencesValue/);
  assert.match(studentPresences, /presenceMetaLabel/);
  assert.doesNotMatch(students, /summaryValue\}>\{presenceStats\.rate\}%/);
  assert.doesNotMatch(students, /summaryValue\}>\{paymentStats\.rate\}%/);
  assert.doesNotMatch(studentDetail, /: studentNotes\.length/);
  assert.doesNotMatch(studentDetail, /: presentCount/);

  const scopeTest = read(path.join("lib", "scope.test.ts"));
  const normalizeTest = read(path.join("lib", "canonicalResourceNormalize.test.ts"));
  assert.doesNotMatch(scopeTest, /CD-2026-0001|BI-2026-0001/);
  assert.doesNotMatch(normalizeTest, /CD-2026-0001|BI-2026-0001/);
  assert.match(scopeTest, /CD-IN-26-001/);
  assert.match(scopeTest, /BI-EC-26-001/);

  console.log("OK: Accueil hydrate users/presences/payments/annonces/messages ; isolation de scope ; pas de faux 0");
}

main();
