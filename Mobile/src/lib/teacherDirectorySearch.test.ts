/** Exécuter: npx tsx Mobile/src/lib/teacherDirectorySearch.test.ts */
import assert from "node:assert/strict";
import { filterTeachersForSearch, normalizeDirectoryQuery } from "./teacherDirectorySearch";

const teachers = [
  { id: "a", name: "Élodie Okito", teacherCode: "PROF-001", publicId: "T-001" },
  { id: "b", name: "Jean Dupont", teacherCode: "PROF-002", publicId: "T-002" },
  { id: "c", name: null, teacherCode: "PROF-003", publicId: null },
];
assert.equal(normalizeDirectoryQuery("  ÉLÔDIE  "), "elodie");
assert.deepEqual(filterTeachersForSearch(teachers, "elodie").map((t) => t.id), ["a"]);
assert.deepEqual(filterTeachersForSearch(teachers, "DUP").map((t) => t.id), ["b"]);
assert.deepEqual(filterTeachersForSearch(teachers, "prof-003").map((t) => t.id), ["c"]);
assert.deepEqual(filterTeachersForSearch(teachers, "t-001").map((t) => t.id), ["a"]);
assert.deepEqual(filterTeachersForSearch(teachers, "absent"), []);
assert.equal(filterTeachersForSearch(teachers, ""), teachers);
assert.equal(filterTeachersForSearch(teachers, "  "), teachers);
console.log("OK: recherche enseignants nom/code/identifiant, accents, casse, vides");
