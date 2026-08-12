"use strict";

const assert = require("node:assert/strict");
const { BusinessError } = require("../services/authService");
const {
  scopeClassStudentsForPrincipal,
  authorizeStudentReadForPrincipal,
  principalHasClassAccess,
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
      schoolCode: "CD-2026-0001",
    },
  ];
  assert.throws(
    () =>
      scopeClassStudentsForPrincipal(
        { role: "Enseignant", classNames: ["6ème A"], schoolCode: "CD-2026-0001" },
        "5ème B",
        rows,
        resolveAuthorizedStudentForPrincipal,
      ),
    (error) => error instanceof BusinessError && error.statusCode === 403,
  );

  const allowed = scopeClassStudentsForPrincipal(
    { role: "Enseignant", classNames: ["5ème B"], schoolCode: "CD-2026-0001" },
    "5ème B",
    rows,
    resolveAuthorizedStudentForPrincipal,
  );
  assert.equal(allowed.length, 1);
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
  testParentCannotReadOtherStudent();
  testAdminSchoolSeesAll();
  console.log("classStudentsAuthz.test.js: OK");
}

main();
