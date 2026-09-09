"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  principalIsParent,
  restrictStudentIdsToCanonicalChildren,
  scopeSchoolClassesForLinkedStudents,
  lookupCanonicalParentLinkedStudents,
  resolveParentLinkedHydration,
  CANONICAL_LOOKUP_OK,
  CANONICAL_LOOKUP_UNAVAILABLE,
  CANONICAL_LOOKUP_ERROR,
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

  it("relation canonique absente + JWT stale ⇒ 0 enfant", () => {
    const keys = restrictStudentIdsToCanonicalChildren(["STU-MAEVA"], []);
    assert.deepEqual(keys, []);
    const hydrated = resolveParentLinkedHydration(
      { status: CANONICAL_LOOKUP_OK, students: [] },
      { jwtStudentIds: ["STU-MAEVA"], schoolStudents: [{ id: "STU-MAEVA", studentCode: "STU-MAEVA" }] },
    );
    assert.deepEqual(hydrated.studentIds, []);
    assert.deepEqual(hydrated.linked, []);
  });

  it("erreur de lecture contact_relations ⇒ fail-closed, jamais fallback JWT", async () => {
    const lookup = await lookupCanonicalParentLinkedStudents({
      repository: {
        listLiveParentLinkedStudentIdsForSync: async () => {
          throw new Error("contact_relations unavailable");
        },
        getSchoolByCode: async () => ({ id: "school-a" }),
      },
      principal: { sub: "parent-1", schoolCode: "CD-LAC-26-001", studentIds: ["STU-MAEVA"] },
      schoolStudents: [{ id: "STU-MAEVA", studentCode: "STU-MAEVA" }],
    });
    assert.equal(lookup.status, CANONICAL_LOOKUP_ERROR);
    const hydrated = resolveParentLinkedHydration(lookup, {
      jwtStudentIds: ["STU-MAEVA"],
      schoolStudents: [{ id: "STU-MAEVA", studentCode: "STU-MAEVA" }],
      fallbackChildren: [{ id: "STU-MAEVA", studentCode: "STU-MAEVA" }],
    });
    assert.deepEqual(hydrated.studentIds, []);
    assert.deepEqual(hydrated.linked, []);
    assert.equal(hydrated.classCodes.length, 0);
  });

  it("lookup indisponible (mémoire) peut encore utiliser le JWT", () => {
    const hydrated = resolveParentLinkedHydration(
      { status: CANONICAL_LOOKUP_UNAVAILABLE, students: [] },
      {
        jwtStudentIds: ["STU-MAEVA"],
        schoolStudents: [{ id: "STU-MAEVA", studentCode: "STU-MAEVA", classCode: "CLS-2A" }],
      },
    );
    assert.ok(hydrated.studentIds.includes("STU-MAEVA"));
  });
});
