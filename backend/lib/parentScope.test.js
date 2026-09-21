"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  principalIsParent,
  collectLinkedStudentKeys,
  restrictStudentIdsToCanonicalChildren,
  scopeSchoolClassesForLinkedStudents,
  lookupCanonicalParentLinkedStudents,
  resolveParentLinkedHydration,
  CANONICAL_LOOKUP_OK,
  CANONICAL_LOOKUP_UNAVAILABLE,
  CANONICAL_LOOKUP_ERROR,
} = require("./parentScope");

describe("parentScope — autorité canonique fail-closed", () => {
  it("reconnaît Parent par roleKeys", () => {
    assert.equal(principalIsParent({ roleKeys: ["PARENT"] }), true);
    assert.equal(principalIsParent({ role: "Parent" }), true);
    assert.equal(principalIsParent({ role: "Enseignant", roleKeys: ["TEACHER"] }), false);
  });

  it("fusionne les alias enfant sans ouvrir un autre élève", () => {
    const keys = collectLinkedStudentKeys({
      roleKeys: ["PARENT"],
      studentIds: ["STU-MAEVA"],
      children: [{ id: "STU-MAEVA", studentUuid: "uuid-maeva" }],
    });
    assert.ok(keys.includes("STU-MAEVA"));
    assert.ok(keys.includes("uuid-maeva"));
    assert.equal(keys.includes("STU-AISHA"), false);
  });

  it("un JWT camarade n'élargit jamais les enfants canoniques", () => {
    const keys = restrictStudentIdsToCanonicalChildren(
      ["STU-MAEVA", "STU-AISHA"],
      [{ id: "STU-MAEVA", studentCode: "STU-MAEVA", studentUuid: "uuid-maeva" }],
    );
    assert.ok(keys.includes("STU-MAEVA"));
    assert.ok(keys.includes("uuid-maeva"));
    assert.equal(keys.includes("STU-AISHA"), false);
  });

  it("GET /classes Parent : uniquement classes liées et effectif = enfants liés", () => {
    const scoped = scopeSchoolClassesForLinkedStudents(
      [
        { classCode: "CLS-2A", classId: "a", students: 35 },
        { classCode: "CLS-2B", classId: "b", students: 28 },
      ],
      [{ classCode: "CLS-2A", classId: "a" }],
    );
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].classCode, "CLS-2A");
    assert.equal(scoped[0].students, 1);
    assert.equal(scoped[0].studentCount, 1);
  });

  it("relation canonique supprimée + JWT stale => 0 enfant", () => {
    const hydrated = resolveParentLinkedHydration(
      { status: CANONICAL_LOOKUP_OK, students: [] },
      {
        jwtStudentIds: ["STU-MAEVA"],
        schoolStudents: [{ id: "STU-MAEVA", studentUuid: "uuid-maeva" }],
      },
    );
    assert.deepEqual(hydrated.studentIds, []);
    assert.deepEqual(hydrated.linked, []);
    assert.deepEqual(hydrated.classCodes, []);
  });

  it("erreur contact_relations => fail-closed", async () => {
    const lookup = await lookupCanonicalParentLinkedStudents({
      repository: {
        listLiveParentLinkedStudentIdsForSync: async () => {
          throw new Error("contact_relations unavailable");
        },
        getSchoolByCode: async () => ({ id: "school-a" }),
      },
      principal: { roleKeys: ["PARENT"], sub: "parent-1", schoolCode: "CD-LAC-26-001" },
      schoolStudents: [{ id: "STU-MAEVA", studentUuid: "uuid-maeva" }],
    });
    assert.equal(lookup.status, CANONICAL_LOOKUP_ERROR);
    const hydrated = resolveParentLinkedHydration(lookup, {
      jwtStudentIds: ["STU-MAEVA"],
      schoolStudents: [{ id: "STU-MAEVA", studentUuid: "uuid-maeva" }],
    });
    assert.deepEqual(hydrated.studentIds, []);
  });

  it("lookup mémoire indisponible peut utiliser le JWT fixture", () => {
    const hydrated = resolveParentLinkedHydration(
      { status: CANONICAL_LOOKUP_UNAVAILABLE, students: [] },
      {
        jwtStudentIds: ["STU-MAEVA"],
        schoolStudents: [
          { id: "STU-MAEVA", studentUuid: "uuid-maeva", classCode: "CLS-2A" },
          { id: "STU-AISHA", studentUuid: "uuid-aisha", classCode: "CLS-2A" },
        ],
      },
    );
    assert.ok(hydrated.studentIds.includes("STU-MAEVA"));
    assert.equal(hydrated.studentIds.includes("STU-AISHA"), false);
  });
});
