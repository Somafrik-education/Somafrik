"use strict";

const assert = require("node:assert/strict");
const {
  TEACHERS_SCHOOL_USER_UNIQUE_INDEX,
  TEACHERS_DOMAIN_CONSTRAINTS_CODE,
  formatTeachersSchoolUserDuplicateDiagnostic,
  isTeachersSchoolUserUniquenessViolation,
  isTeachersDomainConstraintsError,
  createTeachersDomainConstraintsError,
} = require("./teachersUniqueness");

function main() {
  const message = formatTeachersSchoolUserDuplicateDiagnostic(
    [
      {
        school_code: "CD-2026-0001",
        user_id: "u-1",
        duplicate_count: 2,
        teacher_codes: ["CD-2026-0001-ENS-0001", "CD-2026-0001-ENS-0009"],
      },
    ],
    1,
  );
  assert.match(message, /Teachers : 1 groupe/);
  assert.match(message, /teachers_school_user_unique/);
  assert.match(message, /Aucune suppression automatique/);
  assert.match(message, /CD-2026-0001\/user=u-1×2/);

  assert.equal(TEACHERS_SCHOOL_USER_UNIQUE_INDEX, "teachers_school_user_unique");
  assert.equal(TEACHERS_DOMAIN_CONSTRAINTS_CODE, "TEACHERS_SCHOOL_USER_DUPLICATES");
  assert.equal(
    isTeachersSchoolUserUniquenessViolation({
      code: "23505",
      constraint: TEACHERS_SCHOOL_USER_UNIQUE_INDEX,
    }),
    true,
  );
  assert.equal(isTeachersSchoolUserUniquenessViolation({ code: "23505", constraint: "other" }), false);

  const domainError = createTeachersDomainConstraintsError(message, {
    code: TEACHERS_DOMAIN_CONSTRAINTS_CODE,
  });
  assert.equal(isTeachersDomainConstraintsError(domainError), true);

  console.log("teachersUniqueness.test.js: OK");
}

main();
