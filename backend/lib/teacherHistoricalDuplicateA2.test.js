"use strict";

const assert = require("assert");
const { buildPhaseA2, sanitize } = require("./teacherHistoricalDuplicateA2");

const group = (id, teachers, signals) => ({
  groupId: id,
  teacherIds: teachers.map((teacher) => teacher.teacherId),
  teachers: teachers.map((teacher) => ({ references: {}, referenceCounts: {}, referenceTotal: 0, ...teacher })),
  evidence: [{ left: teachers[0].teacherId, right: teachers[1].teacherId, signals }],
});

const report = {
  groups: [
    group("GROUP-0001", [
      { teacherId: "T1", userId: "U1", firstName: "Etienne", name: "Lupungu" },
      {
        teacherId: "T2",
        userId: "U1",
        firstName: "Etienne",
        name: "Lupungu",
        references: { users: [{ field: "id" }], grades: [{ field: "teacherId" }] },
      },
    ], ["userId"]),
    group("GROUP-0002", [
      { teacherId: "T3", userId: "U2", firstName: "Papy", name: "Ghislain" },
      { teacherId: "T4", userId: "U2", firstName: "Etienne", name: "Lupungu" },
    ], ["userId"]),
    group("GROUP-0003", [
      { teacherId: "T5", userId: "U3", firstName: "Mathieu", name: "Laurelle" },
      { teacherId: "T6", userId: "U4", firstName: "Jean", name: "Kimwemwe" },
    ], ["publicId"]),
  ],
};
const postgresTeachers = [
  { teacherCode: "T1", postgresUserId: "P1" },
  { teacherCode: "T2", postgresUserId: "P1" },
];
const postgresUsers = [{ id: "P1", userCode: "U1", firstName: "Etienne", lastName: "Lupungu" }];
const phase = buildPhaseA2(report, { users: [] }, { postgresTeachers, postgresUsers, generatedAt: "fixed" });
assert.strictEqual(phase.groups[0].finalClassificationA2, "CONFIRMED_DUPLICATE_REFERENCE_SPLIT");
assert.strictEqual(phase.groups[0].candidateMatrix.length, 2);
assert.strictEqual(phase.groups[0].reconciliationSimulations.length, 2);
assert.deepStrictEqual(phase.groups[0].reconciliationSimulations[0].referencesToRepoint, { grades: 1 });
assert.strictEqual(phase.groups[1].finalClassificationA2, "AMBIGUOUS_IDENTITY_CROSS_LINK");
assert.strictEqual(phase.groups[1].candidateMatrix.length, 0);
assert.strictEqual(phase.groups[2].finalClassificationA2, "IDENTIFIER_COLLISION_NOT_DUPLICATE");
assert.strictEqual(phase.groups[2].reconciliationSimulations.length, 0);
assert.deepStrictEqual(sanitize({ password: "secret", passwordHash: "hash", name: "safe" }), { name: "safe" });
console.log("teacherHistoricalDuplicateA2.test.js : OK");
