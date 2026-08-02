"use strict";

const assert = require("assert");
const { buildFullAudit, aliasChain } = require("./teacherPostCleanupFullAudit");

const pgUsers = [
  { id: "P1", userCode: "U1", role: "TEACHER", status: "active" },
  { id: "OLD", userCode: "NONE", role: "TEACHER", status: "deleted" },
];
assert.deepStrictEqual(aliasChain("P1", new Map(pgUsers.map((user) => [user.id.toLowerCase(), user]))), ["P1", "U1"]);
const report = buildFullAudit(
  {
    teachers: [{ id: "T1", schoolCode: "S1", userId: "U1", identifier: "ENS-1", publicId: "S1-ENS-1" }],
    users: [
      { id: "U1", role: "Enseignant" },
      { id: "P1", role: "Enseignant" },
      { id: "OLD", role: "Enseignant" },
    ],
    grades: [{ id: "G1", teacherId: "T1" }],
  },
  pgUsers,
  [{ teacherCode: "T1", postgresUserId: "P1" }],
  { dangling: {}, removedIds: {} },
);
assert.strictEqual(report.counts.canonicalTeacherAccounts, 1);
assert.deepStrictEqual(report.collisions.userId, []);
assert.strictEqual(report.accounts.incoherentBackoffice.length, 0);
assert.deepStrictEqual(report.references.backofficeDangling, []);
assert.strictEqual(report.accounts.backoffice.find((row) => row.userId === "P1").classification, "POSTGRES_ALIAS_TO_TEACHER");
assert.strictEqual(report.accounts.backoffice.find((row) => row.userId === "OLD").classification, "DELETED_ACCOUNT_NO_TEACHER_EXPECTED");
console.log("teacherPostCleanupFullAudit.test.js : OK");
