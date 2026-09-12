/**
 * Contrat UX — professeur principal sur la carte dépliée Classe.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const classesScreen = read("screens/ClassesScreen.tsx");
const controls = read("components/ClassHeadTeacherControls.tsx");
const api = read("services/api.ts");
const inventory = read("lib/mobileMutationInventory.ts");

assert.match(classesScreen, /ClassHeadTeacherControls/);
assert.match(classesScreen, /formatHeadTeacherLine/);
assert.match(classesScreen, /classHeadTeacherPatches/);
assert.doesNotMatch(classesScreen, /\/backoffice\/state/);
assert.doesNotMatch(controls, /\/backoffice\/state/);
assert.doesNotMatch(controls, /DataContext/);

const assignIdx = classesScreen.indexOf("<ClassHeadTeacherControls");
const studentsIdx = classesScreen.indexOf("SCOLARITE_COPY.openClassStudents");
assert.ok(assignIdx > 0, "bouton professeur principal présent");
assert.ok(
  studentsIdx > assignIdx,
  "Affecter un professeur principal apparaît avant Voir les élèves",
);

assert.match(controls, /listClassHeadTeacherCandidates/);
assert.match(controls, /assignClassHeadTeacher/);
assert.match(controls, /removeClassHeadTeacher/);
assert.match(controls, /HEAD_TEACHER_COPY\.assign/);
assert.match(controls, /HEAD_TEACHER_COPY\.modify/);
assert.match(controls, /HEAD_TEACHER_COPY\.confirm/);
assert.match(controls, /HEAD_TEACHER_COPY\.cancel/);
assert.match(controls, /HEAD_TEACHER_COPY\.remove/);
assert.match(controls, /HEAD_TEACHER_COPY\.errorNetwork/);
assert.match(controls, /canAssignClassHeadTeacher/);
assert.match(controls, /isActiveClass/);
assert.match(controls, /Alert\.alert/);

assert.match(api, /\/classes\/\$\{encodeURIComponent\(classCode\)\}\/head-teacher\/candidates/);
assert.match(api, /method: "PUT"/);
assert.match(api, /method: "DELETE"/);
assert.match(inventory, /assignClassHeadTeacher/);
assert.match(inventory, /removeClassHeadTeacher/);
assert.doesNotMatch(inventory, /outbox: true, domain: "classes"/);

console.log("classHeadTeacher.ux.test.ts: OK");
