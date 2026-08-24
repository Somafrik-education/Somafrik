/**
 * Appel : charger roster + présences au focus et reconstruire le draft après hydratation.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const SRC = path.join(MOBILE, "src");

function main() {
  for (const file of [
    "src/lib/attendanceDraft.test.ts",
    "src/lib/attendanceTruth.test.ts",
    "src/lib/attendanceStatusTheme.test.ts",
    "src/lib/attendanceClassIdentity.test.ts",
    "src/lib/attendanceOffline.test.ts",
    "src/domain/metrics/schoolMetrics.test.ts",
    "src/lib/classTodayPresenceBadge.test.ts",
    "src/lib/classesScreenPresenceContract.test.ts",
  ]) {
    const unit = spawnSync("npx", ["--yes", "tsx", file], {
      cwd: MOBILE,
      encoding: "utf8",
    });
    if (unit.status !== 0) {
      throw new Error(unit.stderr || unit.stdout || `${file} failed`);
    }
    process.stdout.write(unit.stdout || "");
  }

  const attendance = fs.readFileSync(path.join(SRC, "screens", "TeacherAttendanceScreen.tsx"), "utf8");
  assert.match(attendance, /useFocusEffect/);
  assert.match(attendance, /loadPresences/);
  assert.match(attendance, /loadStudents/);
  assert.match(attendance, /setAttendance\(\(current\) =>/);
  assert.match(attendance, /clearConfirmedAttendanceDirty/);
  assert.match(attendance, /shouldPreserveLocalAttendanceDraft/);
  assert.match(attendance, /applyConfirmedPresences/);
  assert.match(attendance, /presencesSnapshot/);
  assert.match(attendance, /resourceScopeKey/);
  assert.match(attendance, /findTodayPresenceForStudent/);
  assert.match(attendance, /rollCallEntryFromPresence/);
  assert.match(attendance, /assertRollCallReadyToSave/);
  assert.match(attendance, /attendanceStatusTheme/);
  assert.match(attendance, /USABILITY_TEST_IDS\.attendanceSave/);
  assert.match(attendance, /USABILITY_TEST_IDS\.attendanceMarkAllPresent/);
  assert.match(attendance, /USABILITY_TEST_IDS\.attendanceCurrentStatus/);
  assert.match(attendance, /USABILITY_TEST_IDS\.attendanceCurrentStatusValue/);
  assert.match(attendance, /overlayPresenceOutboxOnAttendance/);
  assert.match(attendance, /classId: identity\.classId/);
  assert.match(attendance, /filterStudentsByClassIdentity/);
  assert.doesNotMatch(attendance, /rollCallInitialStatus/);
  assert.doesNotMatch(attendance, /statusActionActive/);
  assert.doesNotMatch(attendance, /attendance\[student\.id\] \?\? \{ status: "Présent"/);
  assert.doesNotMatch(attendance, /useState<Record<string, AttendanceEntry>>\(\(\) =>\s*Object\.fromEntries/);
  console.log("OK: TeacherAttendanceScreen réhydrate le jour courant, refuse le faux Présent et applique le thème sémantique");

  const studentPresences = fs.readFileSync(path.join(SRC, "screens", "StudentPresencesScreen.tsx"), "utf8");
  assert.match(studentPresences, /loadPresences/);
  assert.match(studentPresences, /useFocusEffect/);
  assert.match(studentPresences, /metricLabelFromSnapshot/);
  console.log("OK: StudentPresences charge les présences au focus");

  const students = fs.readFileSync(path.join(SRC, "screens", "StudentsScreen.tsx"), "utf8");
  assert.match(students, /loadStudents/);
  assert.match(students, /useFocusEffect/);
  assert.match(students, /metricLabelFromSnapshot/);
  console.log("OK: StudentsScreen hydrate le roster au focus");

  const classes = fs.readFileSync(path.join(SRC, "screens", "ClassesScreen.tsx"), "utf8");
  assert.match(classes, /filterStudentsByClassIdentity/);
  assert.match(classes, /resolveClassTodayPresenceBadge/);
  assert.match(classes, /classPresenceBadgeTestId/);
  assert.doesNotMatch(classes, /getPresenceStats/);
  assert.doesNotMatch(classes, /classNameMatches\(student\.className/);
  console.log("OK: ClassesScreen badge = présence du jour, scope classId");
}

main();
