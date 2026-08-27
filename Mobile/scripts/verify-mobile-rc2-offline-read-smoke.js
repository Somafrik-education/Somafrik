/**
 * Vérifie l'instrumentation et les gardes RC2 Offline Read Smoke.
 *
 * Exit 0 + BLOCKED_NATIVE_RC2_OFFLINE_READ_SMOKE si aucun device Android.
 * Le GO physique (avion + kill/relaunch + 5 ressources L1) n'est pas simulé ici.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "Mobile");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd || MOBILE,
    env: { ...process.env, ...(options.env || {}) },
    maxBuffer: 20 * 1024 * 1024,
  });
}

function main() {
  const marker = read(path.join(MOBILE, "src/offline/l1/rc2OfflineReadSmoke.ts"));
  const readModel = read(path.join(MOBILE, "src/offline/l1/readModel.ts"));
  const runtime = read(path.join(MOBILE, "src/offline/l1/L1CacheRuntime.tsx"));
  const syncEngine = read(path.join(MOBILE, "src/offline/l1/syncEngine.ts"));
  const establishment = read(path.join(MOBILE, "src/lib/establishment.ts"));
  const dataTruth = read(path.join(MOBILE, "src/lib/dataTruth.ts"));
  const students = read(path.join(MOBILE, "src/screens/StudentsScreen.tsx"));
  const classes = read(path.join(MOBILE, "src/screens/ClassesScreen.tsx"));
  const timetable = read(path.join(MOBILE, "src/screens/TimetableScreen.tsx"));
  const pedagogy = read(path.join(MOBILE, "src/screens/SchoolPedagogicalStructureScreen.tsx"));
  const admin = read(path.join(MOBILE, "src/context/AdminDataContext.tsx"));
  const gates = read(path.join(ROOT, ".github/workflows/pr-gates.yml"));
  const audit = read(path.join(ROOT, "docs/audits/mobile-rc2-offline-read-smoke-2026-08-27.md"));
  const rootPkg = JSON.parse(read(path.join(ROOT, "package.json")));
  const mobilePkg = JSON.parse(read(path.join(MOBILE, "package.json")));

  assert.match(marker, /export const RC2_L1_READ_TAG = "RC2_L1_READ"/);
  assert.match(marker, /export const RC2_L1_SYNC_TAG = "RC2_L1_SYNC"/);
  assert.match(marker, /export const RC2_L1_SYNC_START_TAG = "RC2_L1_SYNC_START"/);
  assert.match(marker, /export const RC2_L1_PAGE_TAG = "RC2_L1_PAGE"/);
  assert.match(marker, /export const RC2_L1_SYNC_EXCEPTION_TAG = "RC2_L1_SYNC_EXCEPTION"/);
  assert.match(marker, /export const RC2_L1_REFUSAL_TAG = "RC2_L1_REFUSAL"/);
  assert.match(marker, /export const RC2_OFFLINE_BOOT_TAG = "RC2_OFFLINE_BOOT"/);
  assert.match(marker, /export const RC2_OFFLINE_READ_SMOKE_TAG = "RC2_OFFLINE_READ_SMOKE"/);
  assert.match(marker, /permissions=ready_offline/);
  assert.match(marker, /RC2_OFFLINE_READ_SMOKE_TAG\} OK/);
  assert.match(marker, /metadata_absent/);
  assert.match(marker, /network_preserved/);
  assert.match(marker, /full_required/);
  assert.doesNotMatch(marker, /accessToken|refreshToken|l1DbKey|SecureStore/);
  assert.match(readModel, /logRc2L1ReadFromSnapshot/);
  assert.match(readModel, /logRc2L1Refusal/);
  assert.match(runtime, /logRc2OfflineBoot/);
  assert.match(runtime, /await syncL1Cache/);
  assert.doesNotMatch(runtime, /logRc2L1SyncResults/);
  assert.match(syncEngine, /logRc2L1SyncStart/);
  assert.match(syncEngine, /logRc2L1Page/);
  assert.match(syncEngine, /logRc2L1SyncException/);
  assert.match(syncEngine, /logRc2L1Sync\(result\)/);
  assert.match(runtime, /ready_offline/);
  assert.match(establishment, /export function l1AssignmentBelongsToTeacherSession/);
  assert.match(establishment, /teacherUserId === userId/);
  const l1MatcherStart = establishment.indexOf("export function l1AssignmentBelongsToTeacherSession");
  const l1MatcherRest = establishment.slice(l1MatcherStart);
  const l1MatcherEnd = l1MatcherRest.indexOf("\nexport function", 1);
  const l1MatcherFn = l1MatcherEnd === -1 ? l1MatcherRest : l1MatcherRest.slice(0, l1MatcherEnd);
  assert.doesNotMatch(l1MatcherFn, /teacherCode|teacherId/);
  assert.match(dataTruth, /METRIC_UNAVAILABLE_LABEL = "Indisponible"/);
  assert.match(dataTruth, /if \(snapshot\.status === "error"\) return METRIC_UNAVAILABLE_LABEL/);
  assert.match(students, /metricLabelFromSnapshot\(presencesSnapshot/);
  assert.match(students, /networkRequired=\{mutationsBlocked\}/);
  assert.match(classes, /networkRequired=\{mutationsBlocked\}/);
  assert.match(classes, /l1-offline-banner/);
  assert.match(timetable, /l1ReadOnly/);
  assert.match(timetable, /unverified:\s*true/);
  assert.match(timetable, /confirmedEmpty:\s*false/);
  assert.match(pedagogy, /mutationRequiresConnection|mutationsBlocked/);
  assert.match(admin, /resource: "classes"/);
  assert.match(admin, /resource: "students"/);
  assert.match(admin, /resource: "assignments"/);
  assert.match(admin, /resource: "school-courses"/);
  assert.match(admin, /resource: "course-schedules"/);
  assert.match(admin, /filterL1AssignmentsForTeacherSession/);

  for (const rel of [
    "src/screens/ClassesScreen.tsx",
    "src/screens/StudentsScreen.tsx",
    "src/screens/TimetableScreen.tsx",
    "src/screens/SchoolPedagogicalStructureScreen.tsx",
    "src/screens/StudentDetailScreen.tsx",
  ]) {
    const source = read(path.join(MOBILE, rel));
    assert.doesNotMatch(source, /expo-sqlite/);
    assert.doesNotMatch(source, /from ["'].*offline\/l1\/database/);
    assert.doesNotMatch(source, /listRows\(/);
    assert.doesNotMatch(source, /readL1Resource/);
  }

  assert.equal(
    mobilePkg.scripts["verify:mobile-rc2-offline-read-smoke"],
    "node scripts/verify-mobile-rc2-offline-read-smoke.js",
  );
  assert.equal(
    rootPkg.scripts["verify:mobile-rc2-offline-read-smoke"],
    "npm --prefix Mobile run verify:mobile-rc2-offline-read-smoke",
  );
  assert.match(gates, /verify:mobile-rc2-offline-read-smoke/);
  assert.match(audit, /RC2 OFFLINE READ SMOKE/);
  assert.match(audit, /874f9415cda8c1e3df1339001b8f0f437149f38d/);
  assert.match(audit, /HOLD|GO/);

  const markerTests = run("npx", ["--yes", "tsx", "src/offline/l1/rc2OfflineReadSmoke.test.ts"]);
  process.stdout.write(markerTests.stdout || "");
  process.stderr.write(markerTests.stderr || "");
  assert.equal(markerTests.status, 0, "rc2OfflineReadSmoke.test.ts");

  const l1Reads = run("npx", ["--yes", "tsx", "src/offline/l1/l1OfflineReads.test.ts"]);
  process.stdout.write(l1Reads.stdout || "");
  process.stderr.write(l1Reads.stderr || "");
  assert.equal(l1Reads.status, 0, "l1OfflineReads.test.ts");

  const adb = run("adb", ["devices"]);
  const deviceLines = String(adb.stdout || "")
    .trim()
    .split("\n")
    .slice(1)
    .filter((line) => /\tdevice\s*$/.test(line));
  if (!deviceLines.length) {
    console.log(
      "BLOCKED_NATIVE_RC2_OFFLINE_READ_SMOKE: aucun device Android physique (online 5× RC2_L1_SYNC_START + RC2_L1_PAGE + outcome=ready — Internet ON, pas de kill/relaunch tant que HOLD)",
    );
  } else {
    console.log(
      "BLOCKED_NATIVE_RC2_OFFLINE_READ_SMOKE: device présent mais smoke login/avion/kill/relaunch non branché dans cet agent — coller le transcript logcat sur la PR Draft",
    );
  }

  console.log("OK: verify:mobile-rc2-offline-read-smoke");
}

main();
