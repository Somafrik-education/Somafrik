"use strict";

const assert = require("node:assert/strict");
const { BusinessError } = require("../services/authService");
const {
  scopeClassStudentsForPrincipal,
  authorizeStudentReadForPrincipal,
  principalHasClassAccess,
  teacherHasActiveClassAssignment,
} = require("./classStudentsAuthz");

function resolveAuthorizedStudentForPrincipal(students, principal, studentRef) {
  const { TenantScopeService } = require("../services/tenantScopeService");
  const tenantScopeService = new TenantScopeService();
  const scopedStudents = tenantScopeService.filterRows(students, principal);
  const key = String(studentRef ?? "").trim();
  const scopedMatch = scopedStudents.find((item) =>
    [item.id, item.publicId, item.matricule, item.studentCode].some(
      (value) => String(value ?? "").trim() === key,
    ),
  );
  if (scopedMatch) return scopedMatch;
  if (principal.role !== "Parent" && principal.role !== "Élève / Étudiant") {
    return undefined;
  }
  const linkedIds = new Set((principal.studentIds ?? []).map((value) => String(value ?? "").trim()));
  const raw = students.find((item) =>
    [item.id, item.publicId, item.matricule, item.studentCode].some(
      (value) => String(value ?? "").trim() === key,
    ),
  );
  if (!raw) return undefined;
  for (const value of [raw.id, raw.publicId, raw.matricule, raw.studentCode]) {
    const candidate = String(value ?? "").trim();
    if (candidate && linkedIds.has(candidate)) return raw;
  }
  return undefined;
}

function testTeacherClassGate() {
  assert.equal(
    principalHasClassAccess(
      { role: "Enseignant", classNames: ["6ème A"] },
      "6ème A",
    ),
    true,
  );
  assert.equal(
    principalHasClassAccess(
      { role: "Enseignant", classNames: ["6ème A"] },
      "5ème B",
    ),
    false,
  );

  const rows = [
    {
      id: "ELE-CD-0001-0001-000001",
      studentCode: "ELE-CD-0001-0001-000001",
      className: "5ème B",
      classCode: "CLS-5B",
      schoolCode: "CD-2026-0001",
    },
  ];
  assert.throws(
    () =>
      scopeClassStudentsForPrincipal(
        { role: "Enseignant", classNames: ["6ème A"], schoolCode: "CD-2026-0001" },
        { classCode: "CLS-5B", className: "5ème B" },
        rows,
        resolveAuthorizedStudentForPrincipal,
      ),
    (error) => error instanceof BusinessError && error.statusCode === 403,
  );

  const allowed = scopeClassStudentsForPrincipal(
    {
      role: "Enseignant",
      classNames: ["5ème B"],
      classCodes: ["CLS-5B"],
      schoolCode: "CD-2026-0001",
    },
    { classCode: "CLS-5B", className: "5ème B" },
    rows,
    resolveAuthorizedStudentForPrincipal,
  );
  assert.equal(allowed.length, 1);
}

function testTeacherWithoutAssignmentsDenied() {
  const student = {
    id: "ELE-CD-0001-0001-000099",
    publicId: "ELE-CD-0001-0001-000099",
    matricule: "ELE-CD-0001-0001-000099",
    studentCode: "ELE-CD-0001-0001-000099",
    className: "6ème A",
    classCode: "CLS-6A-2026",
    schoolCode: "CD-2026-0001",
  };
  const principal = {
    role: "Enseignant",
    schoolCode: "CD-2026-0001",
    classNames: [],
    classCodes: [],
    assignments: [],
  };

  assert.equal(teacherHasActiveClassAssignment(principal, student), false);
  assert.equal(
    authorizeStudentReadForPrincipal(
      student,
      principal,
      student.studentCode,
      resolveAuthorizedStudentForPrincipal,
    ),
    undefined,
  );
  assert.throws(
    () =>
      scopeClassStudentsForPrincipal(
        principal,
        { classCode: student.classCode, className: student.className },
        [student],
        resolveAuthorizedStudentForPrincipal,
      ),
    (error) => error instanceof BusinessError && error.statusCode === 403,
  );

  // Même fuite historique via TenantScopeService : classNames vides ne doivent plus tout ouvrir.
  const viaResolve = resolveAuthorizedStudentForPrincipal(
    [student],
    principal,
    student.studentCode,
  );
  assert.equal(viaResolve, undefined);
}

function testHomonymousClassesAcrossYears() {
  const yearOne = {
    id: "ELE-Y1",
    studentCode: "ELE-Y1",
    className: "6ème A",
    classCode: "CLS-6A-2025",
    schoolCode: "CD-2026-0001",
  };
  const yearTwo = {
    id: "ELE-Y2",
    studentCode: "ELE-Y2",
    className: "6ème A",
    classCode: "CLS-6A-2026",
    schoolCode: "CD-2026-0001",
  };
  // Affectation historique sur l'année N-1 uniquement (même nom de classe).
  const principal = {
    role: "Enseignant",
    schoolCode: "CD-2026-0001",
    classNames: ["6ème A"],
    classCodes: ["CLS-6A-2025"],
    assignments: [{ className: "6ème A", classCode: "CLS-6A-2025" }],
  };

  assert.equal(
    teacherHasActiveClassAssignment(principal, {
      classCode: yearOne.classCode,
      className: yearOne.className,
    }),
    true,
  );
  assert.equal(
    teacherHasActiveClassAssignment(principal, {
      classCode: yearTwo.classCode,
      className: yearTwo.className,
    }),
    false,
    "homonyme d'une autre année scolaire doit être refusé",
  );

  assert.ok(
    authorizeStudentReadForPrincipal(
      yearOne,
      principal,
      yearOne.studentCode,
      resolveAuthorizedStudentForPrincipal,
    ),
  );
  assert.equal(
    authorizeStudentReadForPrincipal(
      yearTwo,
      principal,
      yearTwo.studentCode,
      resolveAuthorizedStudentForPrincipal,
    ),
    undefined,
  );

  assert.throws(
    () =>
      scopeClassStudentsForPrincipal(
        principal,
        { classCode: yearTwo.classCode, className: yearTwo.className },
        [yearTwo],
        resolveAuthorizedStudentForPrincipal,
      ),
    (error) => error instanceof BusinessError && error.statusCode === 403,
  );
}

function testParentCannotReadOtherStudent() {
  const own = {
    id: "ELE-OWN",
    publicId: "ELE-OWN",
    matricule: "ELE-OWN",
    studentCode: "ELE-OWN",
    className: "6ème A",
    schoolCode: "CD-2026-0001",
  };
  const other = {
    id: "ELE-OTHER",
    publicId: "ELE-OTHER",
    matricule: "ELE-OTHER",
    studentCode: "ELE-OTHER",
    className: "6ème A",
    schoolCode: "CD-2026-0001",
  };
  const principal = {
    role: "Parent",
    schoolCode: "CD-2026-0001",
    studentIds: ["ELE-OWN"],
  };

  assert.ok(
    authorizeStudentReadForPrincipal(
      own,
      principal,
      "ELE-OWN",
      resolveAuthorizedStudentForPrincipal,
    ),
  );
  assert.equal(
    authorizeStudentReadForPrincipal(
      other,
      principal,
      "ELE-OTHER",
      resolveAuthorizedStudentForPrincipal,
    ),
    undefined,
  );

  assert.throws(
    () =>
      scopeClassStudentsForPrincipal(
        principal,
        "6ème A",
        [other],
        resolveAuthorizedStudentForPrincipal,
      ),
    (error) => error instanceof BusinessError && error.statusCode === 403,
  );

  const scoped = scopeClassStudentsForPrincipal(
    principal,
    "6ème A",
    [own, other],
    resolveAuthorizedStudentForPrincipal,
  );
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].id, "ELE-OWN");
}

function testAdminSchoolSeesAll() {
  const rows = [
    { id: "A", className: "6ème A", schoolCode: "CD-2026-0001" },
    { id: "B", className: "5ème B", schoolCode: "CD-2026-0001" },
  ];
  const scoped = scopeClassStudentsForPrincipal(
    { role: "Admin School", schoolCode: "CD-2026-0001" },
    "6ème A",
    rows,
    resolveAuthorizedStudentForPrincipal,
  );
  assert.equal(scoped.length, 2);
}

function main() {
  testTeacherClassGate();
  testTeacherWithoutAssignmentsDenied();
  testHomonymousClassesAcrossYears();
  testParentCannotReadOtherStudent();
  testAdminSchoolSeesAll();
  console.log("classStudentsAuthz.test.js: OK");
}

main();
