"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  normalizeEnrollmentStatus,
  canValidateEnrollmentStatus,
  canAssignClassEnrollmentStatus,
  canTransferEnrollmentStatus,
  canCloseEnrollmentStatus,
  isTerminalEnrollmentStatus,
  nextStatusAfterValidate,
  nextStatusAfterAssignClass,
  nextStatusAfterTransfer,
  nextStatusAfterClose,
  isParentOrStudentRole,
} = require("./studentEnrollmentC18");

test("C18 alias active → ENROLLED", () => {
  assert.equal(normalizeEnrollmentStatus("active"), "ENROLLED");
  assert.equal(normalizeEnrollmentStatus("ENROLLED"), "ENROLLED");
});

test("C18 validate PRE_REGISTERED|PENDING_REVIEW|INCOMPLETE → APPROVED", () => {
  assert.equal(canValidateEnrollmentStatus("PRE_REGISTERED"), true);
  assert.equal(canValidateEnrollmentStatus("PENDING_REVIEW"), true);
  assert.equal(canValidateEnrollmentStatus("INCOMPLETE"), true);
  assert.equal(canValidateEnrollmentStatus("APPROVED"), false);
  assert.equal(canValidateEnrollmentStatus("ENROLLED"), false);
  assert.equal(nextStatusAfterValidate(), "APPROVED");
});

test("C18 assign-class APPROVED|ENROLLED → ENROLLED", () => {
  assert.equal(canAssignClassEnrollmentStatus("APPROVED"), true);
  assert.equal(canAssignClassEnrollmentStatus("ENROLLED"), true);
  assert.equal(canAssignClassEnrollmentStatus("PENDING_REVIEW"), false);
  assert.equal(nextStatusAfterAssignClass("APPROVED"), "ENROLLED");
});

test("C18 transfer ENROLLED → TRANSFERRED terminal", () => {
  assert.equal(canTransferEnrollmentStatus("ENROLLED"), true);
  assert.equal(canTransferEnrollmentStatus("APPROVED"), false);
  assert.equal(nextStatusAfterTransfer(), "TRANSFERRED");
  assert.equal(isTerminalEnrollmentStatus("TRANSFERRED"), true);
  assert.equal(canValidateEnrollmentStatus("TRANSFERRED"), false);
  assert.equal(canAssignClassEnrollmentStatus("TRANSFERRED"), false);
  assert.equal(canCloseEnrollmentStatus("TRANSFERRED"), false);
});

test("C18 close ENROLLED|APPROVED → CLOSED terminal", () => {
  assert.equal(canCloseEnrollmentStatus("ENROLLED"), true);
  assert.equal(canCloseEnrollmentStatus("APPROVED"), true);
  assert.equal(canCloseEnrollmentStatus("PENDING_REVIEW"), false);
  assert.equal(nextStatusAfterClose(), "CLOSED");
  assert.equal(isTerminalEnrollmentStatus("CLOSED"), true);
});

test("C18 parent/student détectés pour interdire les mutations", () => {
  assert.equal(isParentOrStudentRole("Parent"), true);
  assert.equal(isParentOrStudentRole("Élève / Étudiant"), true);
  assert.equal(isParentOrStudentRole("Admin School"), false);
  assert.equal(isParentOrStudentRole("Enseignant"), false);
});
