"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  formatHeadTeacherDisplayName,
  formatAlreadyHeadTeacherHint,
  validateAssignHeadTeacherInput,
  assertClassAcceptsHeadTeacherAssignment,
  assertTeacherEligibleForHeadTeacher,
  HEAD_TEACHER_ERROR,
  UNASSIGNED_HEAD_TEACHER_LABEL,
  isActiveTeacherStatus,
} = require("./classHeadTeachersManagement");

test("formatHeadTeacherDisplayName : Prénom NOM", () => {
  assert.equal(formatHeadTeacherDisplayName("Awa", "Diop"), "Awa DIOP");
  assert.equal(formatHeadTeacherDisplayName(" Jean ", "  ndiaye "), "Jean NDIAYE");
  assert.equal(formatHeadTeacherDisplayName("", ""), "");
});

test("formatAlreadyHeadTeacherHint", () => {
  assert.equal(formatAlreadyHeadTeacherHint([]), "");
  assert.equal(formatAlreadyHeadTeacherHint(["6ème A"]), "Déjà professeur principal de 6ème A");
  assert.equal(
    formatAlreadyHeadTeacherHint(["6ème A", "5ème B"]),
    "Déjà professeur principal de 6ème A, 5ème B",
  );
});

test("validateAssignHeadTeacherInput refuse le tenant client", () => {
  assert.throws(
    () => validateAssignHeadTeacherInput({ teacherCode: "ENS-1", schoolCode: "CD-1" }),
    (error) => error.statusCode === 400 && error.code === HEAD_TEACHER_ERROR.TENANT_FIELD_FORBIDDEN,
  );
  assert.throws(
    () => validateAssignHeadTeacherInput({}),
    (error) => error.statusCode === 400 && error.code === HEAD_TEACHER_ERROR.TEACHER_REQUIRED,
  );
  assert.deepEqual(validateAssignHeadTeacherInput({ teacherCode: "CD-2026-0001-ENS-0001" }), {
    teacherCode: "CD-2026-0001-ENS-0001",
  });
});

test("classe inactive refusée", () => {
  assert.throws(
    () => assertClassAcceptsHeadTeacherAssignment({ status: "inactive" }),
    (error) => error.statusCode === 409 && error.code === HEAD_TEACHER_ERROR.CLASS_INACTIVE,
  );
  assert.doesNotThrow(() => assertClassAcceptsHeadTeacherAssignment({ status: "active" }));
});

test("enseignant hors établissement ou inactif refusé", () => {
  assert.throws(
    () =>
      assertTeacherEligibleForHeadTeacher(
        { school_id: "school-b", status: "active" },
        "school-a",
      ),
    (error) => error.statusCode === 403 && error.code === HEAD_TEACHER_ERROR.TEACHER_OTHER_SCHOOL,
  );
  assert.throws(
    () =>
      assertTeacherEligibleForHeadTeacher(
        { school_id: "school-a", status: "archived", user_status: "archived" },
        "school-a",
      ),
    (error) => error.statusCode === 409 && error.code === HEAD_TEACHER_ERROR.TEACHER_INACTIVE,
  );
  assert.equal(isActiveTeacherStatus("Actif"), true);
  assert.equal(UNASSIGNED_HEAD_TEACHER_LABEL, "Non assigné");
});

test("unicité active concurrente → 409 HEAD_TEACHER_CONCURRENT", () => {
  const { isClassHeadTeacherActiveUniquenessViolation, mapHeadTeacherWriteConflict } = require("./classHeadTeachersManagement");
  const pgError = { code: "23505", constraint: "uq_class_head_teachers_one_active" };
  assert.equal(isClassHeadTeacherActiveUniquenessViolation(pgError), true);
  assert.throws(
    () => mapHeadTeacherWriteConflict(pgError),
    (error) => error.statusCode === 409 && error.code === HEAD_TEACHER_ERROR.CONCURRENT,
  );
});

test("mapClassRow expose Prénom NOM sans inventer un PP", () => {
  const { mapClassRow } = require("../db/classesRepository");
  const assigned = mapClassRow({
    id: "c1",
    class_code: "CLS-1",
    name: "6ème A",
    status: "active",
    school_code: "SCH-A",
    academic_year_id: "ay-a",
    academic_year_name: "2025-2026",
    head_teacher_code: "SCH-A-ENS-0001",
    head_teacher_first_name: "Awa",
    head_teacher_last_name: "Diop",
    enrollment_count: 2,
  });
  assert.equal(assigned.headTeacherDisplayName, "Awa DIOP");
  assert.equal(assigned.teacher, "Awa DIOP");
  assert.equal(assigned.teacherId, "SCH-A-ENS-0001");

  const vacant = mapClassRow({
    id: "c2",
    class_code: "CLS-2",
    name: "5ème B",
    status: "active",
    school_code: "SCH-A",
    academic_year_id: "ay-a",
    academic_year_name: "2025-2026",
    enrollment_count: 0,
  });
  assert.equal(vacant.headTeacher, null);
  assert.equal(vacant.teacher, "Non assigné");
  assert.equal(vacant.teacherId, "");
});
