"use strict";

const assert = require("node:assert/strict");
const {
  TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX,
  TEACHER_ASSIGNMENTS_ACTIVE_DUPLICATES_CODE,
  CREATE_TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX_SQL,
  formatActiveAssignmentDuplicateDiagnostic,
  isTeacherAssignmentsActiveUniquenessViolation,
  createTeacherAssignmentsUniquenessError,
  ensureTeacherAssignmentsActiveUniqueness,
} = require("./teacherAssignmentsUniqueness");

async function main() {
  const message = formatActiveAssignmentDuplicateDiagnostic(
    [
      {
        school_code: "CD-2026-0001",
        teacher_code: "CD-2026-0001-ENS-0001",
        duplicate_count: 2,
        assignment_ids: ["a-1", "a-2"],
      },
    ],
    1,
  );
  assert.match(message, /Affectations : 1 groupe/);
  assert.match(message, /uq_teacher_assignments_active_tuple/);
  assert.match(message, /Aucune suppression automatique/);
  assert.match(message, /CD-2026-0001\/CD-2026-0001-ENS-0001×2/);

  assert.equal(TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX, "uq_teacher_assignments_active_tuple");
  assert.match(CREATE_TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX_SQL, /WHERE/i);
  assert.match(CREATE_TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX_SQL, /status/);
  assert.equal(
    isTeacherAssignmentsActiveUniquenessViolation({
      code: "23505",
      constraint: TEACHER_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX,
    }),
    true,
  );
  assert.equal(
    isTeacherAssignmentsActiveUniquenessViolation({ code: "23505", constraint: "other" }),
    false,
  );

  const domainError = createTeacherAssignmentsUniquenessError(message, {
    code: TEACHER_ASSIGNMENTS_ACTIVE_DUPLICATES_CODE,
  });
  assert.equal(domainError.code, TEACHER_ASSIGNMENTS_ACTIVE_DUPLICATES_CODE);

  const duplicateDb = {
    async one(sql) {
      if (/duplicate_groups/i.test(sql)) return { duplicate_groups: 1 };
      return null;
    },
    async all() {
      return [
        {
          school_code: "CD-2026-0001",
          teacher_code: "CD-2026-0001-ENS-0001",
          duplicate_count: 2,
          assignment_ids: ["a-1", "a-2"],
        },
      ];
    },
    async query() {
      throw new Error("CREATE INDEX ne doit pas s'exécuter en présence de doublons actifs");
    },
  };
  await assert.rejects(
    () => ensureTeacherAssignmentsActiveUniqueness(duplicateDb, { info() {}, error() {} }),
    (error) =>
      error.code === TEACHER_ASSIGNMENTS_ACTIVE_DUPLICATES_CODE &&
      /Aucune suppression automatique/.test(error.message),
  );

  console.log("teacherAssignmentsUniqueness.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
