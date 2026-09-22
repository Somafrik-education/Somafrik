import assert from "node:assert/strict";
import {
  composeClassPreviewName,
  countCanonicalClasses,
  countStudentsWithoutClass,
  filterCanonicalClasses,
  getClassDisplayName,
  selectCurrentAcademicYear,
} from "./schoolingTruth";

assert.deepEqual(
  filterCanonicalClasses([
    { id: "CLASS-6ème A", name: "6ème A" },
    { id: "cls-1", classCode: "CLS-1", name: "6ème A" },
    { id: "cls-2", publicId: "CLASS-fantome", name: "Fantôme" },
  ]).map((row) => row.id),
  ["cls-1"],
);
assert.equal(
  countCanonicalClasses([
    { id: "CLASS-X", name: "X" },
    { id: "cls-1", classCode: "CLS-1" },
    { id: "cls-2", classCode: "CLS-2" },
  ]),
  2,
);

const current = selectCurrentAcademicYear([
  { name: "2024-2025", isCurrent: false },
  { name: "2025-2026", isCurrent: true },
]);
assert.equal(current?.name, "2025-2026");
assert.equal(selectCurrentAcademicYear([]), null);
assert.equal(selectCurrentAcademicYear([{ name: "2025-2026", status: "current" }])?.name, "2025-2026");

assert.equal(countStudentsWithoutClass([{ className: "6ème A" }, { className: "" }, { classCode: "CLS-1" }]), 1);

assert.equal(getClassDisplayName({ name: "1ère A CD02", groupCode: "CD02" }), "1ère A");
assert.equal(composeClassPreviewName({ levelName: "1ère Primaire", groupCode: "A" }), "1ère Primaire A");

console.log("schoolingTruth.test.ts OK");
