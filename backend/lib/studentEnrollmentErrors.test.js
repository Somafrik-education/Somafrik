"use strict";

const assert = require("node:assert/strict");
const { mapStudentEnrollmentPgError } = require("./studentEnrollmentErrors");

function main() {
  const alreadyHttp = Object.assign(new Error("classe inactive"), { statusCode: 409 });
  assert.equal(mapStudentEnrollmentPgError(alreadyHttp), alreadyHttp);

  const initials = mapStudentEnrollmentPgError(new Error("STUDENT_INITIALS_REQUIRED"));
  assert.equal(initials.statusCode, 400);

  const unique = mapStudentEnrollmentPgError({
    code: "23505",
    constraint: "users_identity_code_unique",
    detail: "Key (identity_code)=(CD-IN-OE-26-00001) already exists.",
    message: "duplicate key value violates unique constraint",
  });
  assert.equal(unique.statusCode, 409);
  assert.equal(unique.code, "STUDENT_IDENTITY_TAKEN");
  assert.doesNotMatch(unique.message, /identity_code/);
  assert.doesNotMatch(unique.message, /CD-IN-OE/);

  const phone = mapStudentEnrollmentPgError({
    code: "23505",
    constraint: "uq_users_school_phone",
    message: "duplicate key",
  });
  assert.equal(phone.statusCode, 409);
  assert.equal(phone.code, "PARENT_PHONE_TAKEN");

  console.log("studentEnrollmentErrors.test.js: OK");
}

main();
