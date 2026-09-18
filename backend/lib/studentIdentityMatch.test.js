"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  collectStudentIdentityKeys,
  findStudentByIdentity,
  studentLinkedToPrincipal,
} = require("./studentIdentityMatch");

const UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccc11";
const CODE = "STU-A-001";
const MATRICULE = "CD-LAC-AE-26-00001";

const student = {
  id: UUID,
  publicId: UUID,
  studentCode: CODE,
  matricule: MATRICULE,
  schoolCode: "CD-LAC-26-001",
};

test("C18/fiche : studentCode, UUID et matricule convergent sur le même élève", () => {
  const roster = [student, { id: "other", studentCode: "STU-B-001", matricule: "BI-BUJ-AE-26-00001" }];
  const byCode = findStudentByIdentity(roster, CODE);
  const byUuid = findStudentByIdentity(roster, UUID);
  const byMatricule = findStudentByIdentity(roster, MATRICULE);
  assert.equal(byCode, student);
  assert.equal(byUuid, student);
  assert.equal(byMatricule, student);
  assert.deepEqual(collectStudentIdentityKeys(student).sort(), [CODE, MATRICULE, UUID].sort());
});

test("C18/fiche : studentCode ne matche pas un autre élève (pas d'élargissement)", () => {
  const other = { id: "uuid-b", studentCode: "STU-B-001", matricule: "BI-X" };
  assert.equal(findStudentByIdentity([other], CODE), undefined);
  assert.equal(findStudentByIdentity([student], "STU-B-001"), undefined);
});

test("parent/student : liaison via studentCode conservée, autre élève refusé", () => {
  assert.equal(studentLinkedToPrincipal(student, [CODE]), true);
  assert.equal(studentLinkedToPrincipal(student, [UUID]), true);
  assert.equal(studentLinkedToPrincipal(student, [MATRICULE]), true);
  assert.equal(studentLinkedToPrincipal(student, ["STU-A-C18"]), false);
});
