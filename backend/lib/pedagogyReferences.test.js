"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { PEDAGOGY_ERROR, createPedagogyError } = require("./pedagogyManagement");
const {
  resolveCanonicalClass,
  resolveCanonicalSubject,
  assertOpenAcademicYearForClass,
  resolveCanonicalPeriod,
  resolveTeacherWithActiveAssignment,
  mapPedagogyPersistenceError,
  isClosedAcademicYearStatus,
} = require("./pedagogyReferences");

function mockTx(overrides = {}) {
  return {
    findClass: async () => null,
    findSubject: async () => null,
    getAcademicYearById: async () => null,
    findTermByName: async () => null,
    findTeacher: async () => null,
    findActiveTeacherAssignment: async () => null,
    ...overrides,
  };
}

test("isClosedAcademicYearStatus détecte les années fermées", () => {
  assert.equal(isClosedAcademicYearStatus("closed"), true);
  assert.equal(isClosedAcademicYearStatus("archived"), true);
  assert.equal(isClosedAcademicYearStatus("fermee"), true);
  assert.equal(isClosedAcademicYearStatus("open"), false);
});

test("resolveCanonicalClass refuse une classe inconnue", async () => {
  await assert.rejects(
    () => resolveCanonicalClass(mockTx(), "school-1", "Inconnue"),
    (error) => error.code === PEDAGOGY_ERROR.COURSE_NOT_FOUND && error.statusCode === 404,
  );
});

test("resolveCanonicalSubject refuse une matière inconnue", async () => {
  await assert.rejects(
    () => resolveCanonicalSubject(mockTx(), "school-1", "Inventée"),
    (error) => error.code === PEDAGOGY_ERROR.COURSE_NOT_FOUND && error.statusCode === 404,
  );
});

test("assertOpenAcademicYearForClass refuse une année fermée", async () => {
  const tx = mockTx({
    getAcademicYearById: async () => ({ id: "year-1", status: "closed" }),
  });
  await assert.rejects(
    () => assertOpenAcademicYearForClass(tx, { academic_year_id: "year-1" }),
    (error) => error.code === PEDAGOGY_ERROR.ACADEMIC_YEAR_CLOSED && error.statusCode === 409,
  );
});

test("resolveCanonicalPeriod refuse une période inconnue", async () => {
  await assert.rejects(
    () => resolveCanonicalPeriod(mockTx(), "year-1", "Trimestre 9"),
    (error) => error.code === PEDAGOGY_ERROR.PERIOD_NOT_FOUND && error.statusCode === 404,
  );
});

test("resolveTeacherWithActiveAssignment : enseignant introuvable sans code affectation", async () => {
  const tx = mockTx({
    findTeacher: async () => null,
  });
  await assert.rejects(
    () =>
      resolveTeacherWithActiveAssignment(tx, {
        schoolId: "school-1",
        teacherKey: "ENS-MISSING",
        classId: "class-1",
        subjectId: "sub-1",
        academicYearId: "year-1",
      }),
    (error) => error.statusCode === 404 && !error.code,
  );
});

test("resolveTeacherWithActiveAssignment exige une affectation active", async () => {
  const tx = mockTx({
    findTeacher: async () => ({ id: "teacher-1", teacher_code: "ENS-1" }),
    findActiveTeacherAssignment: async () => null,
  });
  await assert.rejects(
    () =>
      resolveTeacherWithActiveAssignment(tx, {
        schoolId: "school-1",
        teacherKey: "ENS-1",
        classId: "class-1",
        subjectId: "sub-1",
        academicYearId: "year-1",
      }),
    (error) => error.code === PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED && error.statusCode === 403,
  );
});

test("resolveTeacherWithActiveAssignment accepte une affectation active", async () => {
  const tx = mockTx({
    findTeacher: async () => ({ id: "teacher-1", teacher_code: "ENS-1" }),
    findActiveTeacherAssignment: async () => ({ id: "assign-1", status: "active" }),
  });
  const resolved = await resolveTeacherWithActiveAssignment(tx, {
    schoolId: "school-1",
    teacherKey: "ENS-1",
    classId: "class-1",
    subjectId: "sub-1",
    academicYearId: "year-1",
  });
  assert.equal(resolved.teacherId, "teacher-1");
});

test("mapPedagogyPersistenceError normalise les erreurs métier", () => {
  const gradeError = mapPedagogyPersistenceError(
    createPedagogyError(400, "Score hors barème", "RAW"),
  );
  assert.equal(gradeError.code, PEDAGOGY_ERROR.GRADE_INVALID);

  const enrollmentError = mapPedagogyPersistenceError({
    statusCode: 404,
    message: "Eleve introuvable",
  });
  assert.equal(enrollmentError.code, PEDAGOGY_ERROR.STUDENT_NOT_ENROLLED);
});
