"use strict";

const assert = require("node:assert/strict");
const { BusinessError } = require("../services/authService");
const {
  scopeClassStudentsForPrincipal,
  authorizeStudentReadForPrincipal,
  principalHasClassAccess,
  teacherHasActiveClassAssignment,
  isExplicitlyActiveAssignmentStatus,
  collectTeacherAssignmentRefs,
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

function testActiveStatusHelper() {
  assert.equal(isExplicitlyActiveAssignmentStatus("active"), true);
  assert.equal(isExplicitlyActiveAssignmentStatus("Actif"), true);
  assert.equal(isExplicitlyActiveAssignmentStatus("OPEN"), true);
  assert.equal(isExplicitlyActiveAssignmentStatus(""), false);
  assert.equal(isExplicitlyActiveAssignmentStatus(undefined), false);
  assert.equal(isExplicitlyActiveAssignmentStatus("inactive"), false);
  assert.equal(isExplicitlyActiveAssignmentStatus("closed"), false);
  assert.equal(isExplicitlyActiveAssignmentStatus("historique"), false);
}

function testTeacherClassGateRequiresStableId() {
  // Nom seul → refus (plus de fallback className).
  assert.equal(
    principalHasClassAccess(
      {
        role: "Enseignant",
        classNames: ["6ème A"],
        assignments: [{ className: "6ème A", status: "active" }],
      },
      "6ème A",
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
        {
          role: "Enseignant",
          classNames: ["6ème A"],
          assignments: [{ className: "6ème A", classCode: "CLS-6A", status: "active" }],
          schoolCode: "CD-2026-0001",
        },
        { classCode: "CLS-5B", className: "5ème B" },
        rows,
        resolveAuthorizedStudentForPrincipal,
      ),
    (error) => error instanceof BusinessError && error.statusCode === 403,
  );

  const allowed = scopeClassStudentsForPrincipal(
    {
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
      assignments: [{ className: "5ème B", classCode: "CLS-5B", status: "active" }],
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
}

function testInactiveAssignmentDeniedDespiteClassCode() {
  const student = {
    id: "ELE-INACT",
    studentCode: "ELE-INACT",
    className: "6ème A",
    classCode: "CLS-6A-ACTIVE-TARGET",
    schoolCode: "CD-2026-0001",
  };
  const principal = {
    role: "Enseignant",
    schoolCode: "CD-2026-0001",
    // Agrégats top-level encore peuplés (fuite historique) — ne doivent pas autoriser.
    classNames: ["6ème A"],
    classCodes: ["CLS-6A-ACTIVE-TARGET"],
    assignments: [
      {
        className: "6ème A",
        classCode: "CLS-6A-ACTIVE-TARGET",
        status: "inactive",
      },
    ],
  };

  const refs = collectTeacherAssignmentRefs(principal);
  assert.equal(refs.classCodes.size, 0);
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

  // Statut absent → fail-closed.
  const missingStatus = {
    ...principal,
    assignments: [{ className: "6ème A", classCode: "CLS-6A-ACTIVE-TARGET" }],
  };
  assert.equal(teacherHasActiveClassAssignment(missingStatus, student), false);
}

function testHomonymousClassesNameOnlyDenied() {
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
  // Principal legacy : uniquement des noms, aucun classCode/classId.
  const principal = {
    role: "Enseignant",
    schoolCode: "CD-2026-0001",
    classNames: ["6ème A"],
    classCodes: [],
    assignments: [{ className: "6ème A", status: "active" }],
  };

  assert.equal(
    teacherHasActiveClassAssignment(principal, {
      classCode: yearOne.classCode,
      className: yearOne.className,
    }),
    false,
    "homonyme : classNames seuls ne doivent pas autoriser",
  );
  assert.equal(
    teacherHasActiveClassAssignment(principal, {
      classCode: yearTwo.classCode,
      className: yearTwo.className,
    }),
    false,
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

function testHomonymousClassesActiveCodeAllowsOnlyMatch() {
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
  const principal = {
    role: "Enseignant",
    schoolCode: "CD-2026-0001",
    assignments: [
      { className: "6ème A", classCode: "CLS-6A-2025", status: "active" },
    ],
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
  testActiveStatusHelper();
  testTeacherClassGateRequiresStableId();
  testTeacherWithoutAssignmentsDenied();
  testInactiveAssignmentDeniedDespiteClassCode();
  testHomonymousClassesNameOnlyDenied();
  testHomonymousClassesActiveCodeAllowsOnlyMatch();
  testParentCannotReadOtherStudent();
  testAdminSchoolSeesAll();
  console.log("classStudentsAuthz.test.js: OK");
}

main();
