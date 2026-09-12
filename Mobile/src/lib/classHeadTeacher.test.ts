import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEAD_TEACHER_COPY,
  applyHeadTeacherClassPatch,
  classHasHeadTeacher,
  classHeadTeacherDisplayName,
  formatHeadTeacherDisplayName,
  formatHeadTeacherLine,
  isActiveClass,
} from "./classHeadTeacher";

assert.equal(formatHeadTeacherDisplayName("Awa", "Diop"), "Awa DIOP");
assert.equal(formatHeadTeacherLine("Awa DIOP"), "Professeur principal : Awa DIOP");
assert.equal(formatHeadTeacherLine(""), "Professeur principal : Non assigné");
assert.equal(classHasHeadTeacher({ teacherId: "T1" }), false);
assert.equal(classHasHeadTeacher({ headTeacherCode: "SCH-A-ENS-0001" }), true);
assert.equal(classHeadTeacherDisplayName({ teacher: "Non assigné" }), "");
assert.equal(isActiveClass("inactive"), false);
assert.equal(isActiveClass("active"), true);
assert.equal(HEAD_TEACHER_COPY.assign, "Affecter un professeur principal");
assert.match(HEAD_TEACHER_COPY.confirm, /Confirmer l.affectation/);
assert.match(HEAD_TEACHER_COPY.modify, /Modifier l.affectation/);

const restored = applyHeadTeacherClassPatch(
  {
    id: "CLS-1",
    classCode: "CLS-1",
    teacherId: "",
    teacher: "Non assigné",
    headTeacherCode: null,
    headTeacherDisplayName: null,
  },
  {
    teacherId: "SCH-A-ENS-0001",
    teacher: "Awa DIOP",
    headTeacherCode: "SCH-A-ENS-0001",
    headTeacherDisplayName: "Awa DIOP",
    headTeacher: { teacherCode: "SCH-A-ENS-0001", displayName: "Awa DIOP" },
  },
);
assert.equal(restored.headTeacherDisplayName, "Awa DIOP");
assert.equal(classHasHeadTeacher(restored), true);

const cleared = applyHeadTeacherClassPatch(restored, {
  teacherId: "",
  teacher: "Non assigné",
  headTeacher: null,
  headTeacherCode: null,
  headTeacherDisplayName: null,
});
assert.equal(classHasHeadTeacher(cleared), false);
assert.equal(cleared.teacher, "Non assigné");

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(srcRoot, "..", "..");
const webCopy = fs.readFileSync(path.join(repoRoot, "web/src/lib/classHeadTeacher.ts"), "utf8");
const mobileCopy = fs.readFileSync(path.join(srcRoot, "lib/classHeadTeacher.ts"), "utf8");
for (const key of [
  "Affecter un professeur principal",
  "Modifier l'affectation",
  "Confirmer l'affectation",
  "Retirer l'affectation",
  "Professeur principal :",
  "Non assigné",
]) {
  assert.ok(webCopy.includes(key), `web copy manquante: ${key}`);
  assert.ok(mobileCopy.includes(key), `mobile copy manquante: ${key}`);
}

console.log("classHeadTeacher.test.ts: OK");
