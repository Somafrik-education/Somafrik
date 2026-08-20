/**
 * Appel : charger roster + présences au focus et reconstruire le draft après hydratation.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");

function main() {
  const attendance = fs.readFileSync(path.join(SRC, "screens", "TeacherAttendanceScreen.tsx"), "utf8");
  assert.match(attendance, /useFocusEffect/);
  assert.match(attendance, /loadPresences/);
  assert.match(attendance, /loadStudents/);
  assert.match(attendance, /setAttendance\(\(current\) =>/);
  assert.match(attendance, /modifiedAt/);
  assert.match(attendance, /presencesSnapshot/);
  assert.doesNotMatch(attendance, /useState<Record<string, AttendanceEntry>>\(\(\) =>\s*Object\.fromEntries/);
  console.log("OK: TeacherAttendanceScreen réhydrate le brouillon d'appel après chargement PostgreSQL");

  const studentPresences = fs.readFileSync(path.join(SRC, "screens", "StudentPresencesScreen.tsx"), "utf8");
  assert.match(studentPresences, /loadPresences/);
  assert.match(studentPresences, /useFocusEffect/);
  console.log("OK: StudentPresences charge les présences au focus");

  const students = fs.readFileSync(path.join(SRC, "screens", "StudentsScreen.tsx"), "utf8");
  assert.match(students, /loadStudents/);
  assert.match(students, /useFocusEffect/);
  console.log("OK: StudentsScreen hydrate le roster au focus");
}

main();
