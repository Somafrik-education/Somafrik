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

assert.match(home, /scopedStudentsForSession/);
assert.match(home, /visibleStudents/);
assert.doesNotMatch(home, /metricLabelFromSnapshot\(studentsSnapshot, \(rows\) => String\(rows\.length\)\)/);

assert.match(students, /scopedStudentsForSession/);
assert.match(students, /projectScopedStudentsForSession/);

assert.match(classes, /scopedStudentsForSession/);
assert.match(attendance, /scopedStudentsForSession/);
assert.match(messages, /scopedStudentsForSession/);
assert.match(menu, /scopedStudentsForSession/);

assert.match(l1Projection, /schoolId: partition.schoolId/);

assert.match(mvp, /studentsData\.length/, "MvpUtilityScreens : compte brut documenté, hors SCHOOL_ADMIN Élèves");

console.log("OK: audit consommateurs — Accueil/Élèves/Classes/Appel/Messages observent la projection schoolId");
