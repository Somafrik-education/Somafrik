"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  principalIsParent,
  restrictStudentIdsToCanonicalChildren,
  scopeSchoolClassesForLinkedStudents,
} = require("./parentScope");

describe("parentScope — role et rattachement canonique", () => {
  it("reconnaît PARENT par roleKeys sans libellé role", () => {
    assert.equal(principalIsParent({ roleKeys: ["PARENT"] }), true);
    assert.equal(principalIsParent({ role: "Parent" }), true);
    assert.equal(principalIsParent({ role: "Enseignant", roleKeys: ["TEACHER"] }), false);
  });

  it("un JWT camarade n'élargit pas les enfants canoniques", () => {
    const keys = restrictStudentIdsToCanonicalChildren(
      ["STU-MAEVA", "STU-AISHA"],
      [{ id: "STU-MAEVA", studentCode: "STU-MAEVA", studentUuid: "uuid-maeva" }],
    );
    assert.ok(keys.includes("STU-MAEVA"));
    assert.ok(keys.includes("uuid-maeva"));
    assert.equal(keys.includes("STU-AISHA"), false);
  });

  it("GET /classes Parent : effectif = enfants liés, pas les camarades", () => {
    const scoped = scopeSchoolClassesForLinkedStudents(
      [
        { classCode: "CLS-2A", classId: "a", students: 4 },
        { classCode: "CLS-2B", classId: "b", students: 28 },
      ],
      [{ classCode: "CLS-2A", classId: "a" }],
    );
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].classCode, "CLS-2A");
    assert.equal(scoped[0].students, 1);
  });
});
