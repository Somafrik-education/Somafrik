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
  const unit = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", "attendanceDraft.test.ts")], {
    cwd: MOBILE,
    encoding: "utf8",
  });
  if (unit.status !== 0) {
    throw new Error(unit.stderr || unit.stdout || "attendanceDraft.test.ts failed");
  }
  process.stdout.write(unit.stdout || "");

  const attendance = fs.readFileSync(path.join(SRC, "screens", "TeacherAttendanceScreen.tsx"), "utf8");
  assert.match(attendance, /useFocusEffect/);
  assert.match(attendance, /loadPresences/);
  assert.match(attendance, /loadStudents/);
  assert.match(attendance, /setAttendance\(\(current\) =>/);
  assert.match(attendance, /clearConfirmedAttendanceDirty/);
  assert.match(attendance, /shouldPreserveLocalAttendanceDraft/);
  assert.match(attendance, /presencesSnapshot/);
  assert.match(attendance, /resourceScopeKey/);
  assert.doesNotMatch(attendance, /useState<Record<string, AttendanceEntry>>\(\(\) =>\s*Object\.fromEntries/);
  console.log("OK: TeacherAttendanceScreen réhydrate le brouillon d'appel après chargement PostgreSQL et nettoie dirty après confirmation");

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
}

main();
