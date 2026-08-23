/**
 * Fixture QA Appel — déterministe, préfixé QA, jamais un élève métier réel.
 *
 * Variables :
 *   SOMAFRIK_E2E_ATTENDANCE_CLASS
 *   SOMAFRIK_E2E_ATTENDANCE_STUDENT_A|B|C|D
 */
"use strict";

const QA_CLASS_PATTERN = /^QA-APPEL(-[A-Z0-9]+)+$/i;
const QA_STUDENT_PATTERN = /^QA-ATT-[A-Z0-9-]+$/i;

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function isQaAttendanceClass(value) {
  return QA_CLASS_PATTERN.test(asTrimmed(value));
}

function isQaAttendanceStudent(value) {
  return QA_STUDENT_PATTERN.test(asTrimmed(value));
}

function attendanceQaFixtureFrom(env = {}) {
  return {
    className: asTrimmed(env.SOMAFRIK_E2E_ATTENDANCE_CLASS),
    students: {
      A: asTrimmed(env.SOMAFRIK_E2E_ATTENDANCE_STUDENT_A),
      B: asTrimmed(env.SOMAFRIK_E2E_ATTENDANCE_STUDENT_B),
      C: asTrimmed(env.SOMAFRIK_E2E_ATTENDANCE_STUDENT_C),
      D: asTrimmed(env.SOMAFRIK_E2E_ATTENDANCE_STUDENT_D),
    },
  };
}

function validateAttendanceQaFixture(env = {}) {
  const fixture = attendanceQaFixtureFrom(env);
  if (!fixture.className || !fixture.students.A || !fixture.students.B || !fixture.students.C || !fixture.students.D) {
    return {
      ok: false,
      code: "MUTATION_ATTENDANCE_BLOCKED_NO_QA_FIXTURE",
      message: "Fixture QA Appel incomplet. Fournir SOMAFRIK_E2E_ATTENDANCE_CLASS + STUDENT_A/B/C/D.",
    };
  }
  if (!isQaAttendanceClass(fixture.className)) {
    return {
      ok: false,
      code: "MUTATION_ATTENDANCE_BLOCKED_NO_QA_FIXTURE",
      message: "La classe QA doit matcher QA-APPEL-<suffixe> (pas une classe métier).",
    };
  }
  for (const [slot, studentId] of Object.entries(fixture.students)) {
    if (!isQaAttendanceStudent(studentId)) {
      return {
        ok: false,
        code: "MUTATION_ATTENDANCE_BLOCKED_NO_QA_FIXTURE",
        message: `Élève ${slot} hors préfixe QA-ATT- (collision métier interdite).`,
      };
    }
  }
  const unique = new Set(Object.values(fixture.students));
  if (unique.size !== 4) {
    return {
      ok: false,
      code: "MUTATION_ATTENDANCE_BLOCKED_NO_QA_FIXTURE",
      message: "Les quatre identifiants élèves QA doivent être distincts.",
    };
  }
  return { ok: true, fixture };
}

function hasAttendanceQaFixture(env = {}) {
  return validateAttendanceQaFixture(env).ok === true;
}

function slugify(value) {
  return asTrimmed(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function maestroAttendanceEnvFrom(env = {}) {
  const validated = validateAttendanceQaFixture(env);
  if (!validated.ok) return {};
  const { fixture } = validated;
  return {
    SOMAFRIK_E2E_ATTENDANCE_CLASS: fixture.className,
    SOMAFRIK_E2E_ATTENDANCE_CLASS_SLUG: slugify(fixture.className),
    SOMAFRIK_E2E_ATTENDANCE_STUDENT_A: fixture.students.A,
    SOMAFRIK_E2E_ATTENDANCE_STUDENT_B: fixture.students.B,
    SOMAFRIK_E2E_ATTENDANCE_STUDENT_C: fixture.students.C,
    SOMAFRIK_E2E_ATTENDANCE_STUDENT_D: fixture.students.D,
  };
}

module.exports = {
  QA_CLASS_PATTERN,
  QA_STUDENT_PATTERN,
  asTrimmed,
  isQaAttendanceClass,
  isQaAttendanceStudent,
  attendanceQaFixtureFrom,
  validateAttendanceQaFixture,
  hasAttendanceQaFixture,
  maestroAttendanceEnvFrom,
  slugify,
};
