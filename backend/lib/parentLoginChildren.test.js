"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveParentLoginChildren } = require("./parentScope");

const SCHOOL = "CD-IN-26-001";
const SCHOOL_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_ID = "22222222-2222-4222-8222-222222222222";
const CHILD_UUID = "33333333-3333-4333-8333-333333333333";
const OTHER_UUID = "44444444-4444-4444-8444-444444444444";

function parentUser() {
  return {
    id: PARENT_ID,
    role: "Parent",
    roleKeys: ["PARENT"],
    identifier: "+243810000001",
    phone: "+243810000001",
    schoolCode: SCHOOL,
    schoolId: SCHOOL_ID,
  };
}

function students() {
  return [
    {
      id: "CD-IN-EL-26-001",
      studentUuid: CHILD_UUID,
      studentCode: "CD-IN-EL-26-001",
      schoolCode: SCHOOL,
      schoolId: SCHOOL_ID,
      name: "Maeva Kabila",
      className: "6ème A",
      status: "active",
    },
    {
      id: "CD-IN-EL-26-002",
      studentUuid: OTHER_UUID,
      studentCode: "CD-IN-EL-26-002",
      schoolCode: SCHOOL,
      schoolId: SCHOOL_ID,
      name: "Camarade Phone",
      className: "6ème A",
      parentPhone: "+243810000001",
      status: "active",
    },
    {
      id: "CD-KN-EL-26-009",
      studentUuid: "55555555-5555-4555-8555-555555555555",
      schoolCode: "CD-KN-26-009",
      schoolId: "99999999-9999-4999-8999-999999999999",
      name: "Autre établissement",
      parentPhone: "+243810000001",
      status: "active",
    },
  ];
}

describe("resolveParentLoginChildren — chaîne canonique tenant-safe", () => {
  it("retient l'élève du contact_relations et ignore le téléphone du même établissement", async () => {
    const children = await resolveParentLoginChildren({
      repository: {
        async listLiveParentLinkedStudentIdsForSync(userId, schoolId) {
          assert.equal(userId, PARENT_ID);
          assert.equal(schoolId, SCHOOL_ID);
          return [{ studentId: CHILD_UUID }];
        },
      },
      user: parentUser(),
      school: { id: SCHOOL_ID, code: SCHOOL, loginCode: "SOMA-TEST" },
      state: { students: students(), relations: [], contacts: [] },
      schoolCode: SCHOOL,
    });
    assert.equal(children.length, 1);
    assert.equal(children[0].id, "CD-IN-EL-26-001");
    assert.equal(children[0].name, "Maeva Kabila");
    assert.equal(children[0].className, "6ème A");
    assert.equal(children[0].studentUuid, CHILD_UUID);
  });

  it("0 lien canonique reste vide même si parentPhone coïncide", async () => {
    const children = await resolveParentLoginChildren({
      repository: {
        async listLiveParentLinkedStudentIdsForSync() {
          return [];
        },
      },
      user: parentUser(),
      school: { id: SCHOOL_ID, code: SCHOOL },
      state: { students: students() },
      schoolCode: SCHOOL,
    });
    assert.deepEqual(children, []);
  });

  it("erreur de lecture contact_relations = fail-closed, pas de téléphone", async () => {
    const children = await resolveParentLoginChildren({
      repository: {
        async listLiveParentLinkedStudentIdsForSync() {
          throw new Error("contact_relations unavailable");
        },
      },
      user: parentUser(),
      school: { id: SCHOOL_ID, code: SCHOOL },
      state: { students: students() },
      schoolCode: SCHOOL,
    });
    assert.deepEqual(children, []);
  });

  it("élève archivé canonique n'est pas exposé", async () => {
    const archived = students().map((row) =>
      row.studentUuid === CHILD_UUID ? { ...row, status: "archived" } : row,
    );
    const children = await resolveParentLoginChildren({
      repository: {
        async listLiveParentLinkedStudentIdsForSync() {
          return [{ studentId: CHILD_UUID }];
        },
      },
      user: parentUser(),
      school: { id: SCHOOL_ID, code: SCHOOL },
      state: { students: archived },
      schoolCode: SCHOOL,
    });
    assert.deepEqual(children, []);
  });

  it("multi-enfants reste ordonné et isolé de l'autre établissement", async () => {
    const secondUuid = "66666666-6666-4666-8666-666666666666";
    const rows = [
      ...students(),
      {
        id: "CD-IN-EL-26-003",
        studentUuid: secondUuid,
        schoolCode: SCHOOL,
        schoolId: SCHOOL_ID,
        name: "Awa Kabila",
        className: "5ème B",
        status: "active",
      },
    ];
    const children = await resolveParentLoginChildren({
      repository: {
        async listLiveParentLinkedStudentIdsForSync() {
          return [{ studentId: CHILD_UUID }, { studentId: secondUuid }];
        },
      },
      user: parentUser(),
      school: { id: SCHOOL_ID, code: SCHOOL },
      state: { students: rows },
      schoolCode: SCHOOL,
    });
    assert.deepEqual(
      children.map((row) => row.name),
      ["Awa Kabila", "Maeva Kabila"],
    );
    assert.equal(children.some((row) => row.schoolCode !== SCHOOL), false);
  });

  it("sans lecture PostgreSQL, la projection contact.user_id reste la source, pas le téléphone", async () => {
    const children = await resolveParentLoginChildren({
      repository: {},
      user: parentUser(),
      school: { id: SCHOOL_ID, code: SCHOOL },
      state: {
        students: students(),
        contacts: [{ id: "CNT-1", userId: PARENT_ID, schoolCode: SCHOOL, status: "Actif" }],
        relations: [
          {
            fromContactId: "CNT-1",
            toStudentId: CHILD_UUID,
            schoolCode: SCHOOL,
            status: "Actif",
          },
        ],
      },
      schoolCode: SCHOOL,
    });
    assert.equal(children.length, 1);
    assert.equal(children[0].studentUuid, CHILD_UUID);
  });
});
