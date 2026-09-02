/**
 * Audit consommateurs élèves Mobile — leftover vs schoolId.
 *   npx tsx src/lib/establishmentStudents.audit.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const establishment = read("lib/establishment.ts");
const studentsScope = read("lib/studentsScope.ts");
const adminData = read("context/AdminDataContext.tsx");
const alert = read("components/StudentsScopeAlert.tsx");
const home = read("screens/HomeScreen.tsx");
const students = read("screens/StudentsScreen.tsx");
const classes = read("screens/ClassesScreen.tsx");
const attendance = read("screens/TeacherAttendanceScreen.tsx");
const messages = read("screens/MessagesScreen.tsx");
const menu = read("screens/MenuScreen.tsx");
const mvp = read("screens/MvpUtilityScreens.tsx");
const l1Projection = read("offline/l1/uiProjection.ts");

assert.match(studentsScope, /projectScopedStudentsForSession/);
assert.match(studentsScope, /schoolId membership uniquement/);
assert.match(establishment, /projectScopedStudentsForSession/);
assert.doesNotMatch(establishment, /normalize\(student\.schoolCode\) === normalize\(schoolCode\)/);

assert.match(adminData, /projectScopedStudentsForSession/);
assert.match(adminData, /studentsProjection/);
assert.match(adminData, /studentsScopeError/);
assert.match(adminData, /establishmentStudents/);
assert.match(alert, /studentsScopeError/);
assert.match(alert, /students-scope-error/);

for (const [name, src] of [
  ["HomeScreen", home],
  ["StudentsScreen", students],
  ["ClassesScreen", classes],
  ["TeacherAttendanceScreen", attendance],
  ["MessagesScreen", messages],
  ["MenuScreen", menu],
] as const) {
  assert.match(src, /StudentsScopeAlert/, `${name} doit exposer studentsScopeError via StudentsScopeAlert`);
  assert.doesNotMatch(src, /projectScopedStudentsForSession/, `${name} ne recalcule pas la projection`);
  assert.doesNotMatch(src, /scopedStudentsForSession/, `${name} consomme establishmentStudents du context`);
}

assert.match(home, /establishmentStudents/);
assert.match(home, /visibleStudents/);
assert.doesNotMatch(home, /metricLabelFromSnapshot\(studentsSnapshot, \(rows\) => String\(rows\.length\)\)/);

assert.match(students, /establishmentStudents/);
assert.match(classes, /establishmentStudents/);
assert.match(attendance, /establishmentStudents/);
assert.match(messages, /establishmentStudents/);
assert.match(menu, /establishmentStudents/);

assert.match(l1Projection, /schoolId: partition.schoolId/);

assert.match(mvp, /studentsData\.length/, "MvpUtilityScreens : compte brut documenté, hors SCHOOL_ADMIN Élèves");

console.log("OK: audit consommateurs — projection canonique AdminDataContext + fail-closed visible");
