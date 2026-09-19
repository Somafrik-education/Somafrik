"use strict";

/**
 * P0 Parent Attendance Isolation — RED authz.
 * Contrat : un Parent ne voit jamais le roster des camarades, ni le catalogue
 * de classes de l'établissement. Fail-closed si le rôle n'est pas reconnu.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { BusinessError } = require("../services/authService");
const {
  scopeClassStudentsForPrincipal,
  scopeSchoolClassesForPrincipal,
  scopeSchoolStudentsForPrincipal,
  authorizeStudentReadForPrincipal,
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

const MAEVA = {
  id: "STU-MAEVA",
  publicId: "STU-MAEVA",
  matricule: "STU-MAEVA",
  studentCode: "STU-MAEVA",
  name: "Maeva A",
  classCode: "CLS-2A",
  className: "2ème A",
  schoolCode: "CD-LAC-26-001",
};
const AISHA = {
  id: "STU-AISHA",
  publicId: "STU-AISHA",
  matricule: "STU-AISHA",
  studentCode: "STU-AISHA",
  name: "Aisha B",
  classCode: "CLS-2A",
  className: "2ème A",
  schoolCode: "CD-LAC-26-001",
};
const JEAN = {
  id: "STU-JEAN",
  publicId: "STU-JEAN",
  matricule: "STU-JEAN",
  studentCode: "STU-JEAN",
  name: "Jean C",
  classCode: "CLS-2A",
  className: "2ème A",
  schoolCode: "CD-LAC-26-001",
};
const LUC = {
  id: "STU-LUC",
  publicId: "STU-LUC",
  matricule: "STU-LUC",
  studentCode: "STU-LUC",
  name: "Luc D",
  classCode: "CLS-2A",
  className: "2ème A",
  schoolCode: "CD-LAC-26-001",
};
const SIBLING = {
  id: "STU-SIB",
  publicId: "STU-SIB",
  matricule: "STU-SIB",
  studentCode: "STU-SIB",
  name: "Sibling E",
  classCode: "CLS-2B",
  className: "2ème B",
  schoolCode: "CD-LAC-26-001",
};
const ROSTER_2A = [MAEVA, AISHA, JEAN, LUC];
const CLASSES = [
  { id: "uuid-2a", classId: "uuid-2a", classCode: "CLS-2A", name: "2ème A", students: 4 },
  { id: "uuid-2b", classId: "uuid-2b", classCode: "CLS-2B", name: "2ème B", students: 28 },
];

function expectBusinessForbidden(fn) {
  assert.throws(fn, (error) => error instanceof BusinessError && error.statusCode === 403);
}

describe("P0-1 Parent un enfant — roster uniquement cet enfant", () => {
  it("GET classe 2ème A ne renvoie que Maeva", () => {
    const scoped = scopeClassStudentsForPrincipal(
      { role: "Parent", schoolCode: "CD-LAC-26-001", studentIds: ["STU-MAEVA"] },
      { classCode: "CLS-2A", classId: "uuid-2a", className: "2ème A" },
      ROSTER_2A,
      resolveAuthorizedStudentForPrincipal,
    );
    assert.deepEqual(
      scoped.map((row) => row.studentCode),
      ["STU-MAEVA"],
    );
  });
});

describe("P0-2 Parent deux enfants — uniquement ces deux élèves", () => {
  it("filtre le roster 2ème A à Maeva et ignore les camarades", () => {
    const scoped = scopeClassStudentsForPrincipal(
      { role: "Parent", schoolCode: "CD-LAC-26-001", studentIds: ["STU-MAEVA", "STU-SIB"] },
      { classCode: "CLS-2A", classId: "uuid-2a", className: "2ème A" },
      ROSTER_2A,
      resolveAuthorizedStudentForPrincipal,
    );
    assert.deepEqual(
      scoped.map((row) => row.studentCode),
      ["STU-MAEVA"],
    );
  });

  it("l'annuaire établissement ne contient que les deux enfants", () => {
    const scoped = scopeSchoolStudentsForPrincipal(
      { role: "Parent", schoolCode: "CD-LAC-26-001", studentIds: ["STU-MAEVA", "STU-SIB"] },
      [...ROSTER_2A, SIBLING],
      resolveAuthorizedStudentForPrincipal,
    );
    assert.deepEqual(
      scoped.map((row) => row.studentCode).sort(),
      ["STU-MAEVA", "STU-SIB"],
    );
  });
});

describe("P0-3 Parent ne lit jamais un autre élève par studentId", () => {
  it("authorizeStudentRead refuse Aisha", () => {
    assert.equal(
      authorizeStudentReadForPrincipal(
        AISHA,
        { role: "Parent", schoolCode: "CD-LAC-26-001", studentIds: ["STU-MAEVA"] },
        "STU-AISHA",
        resolveAuthorizedStudentForPrincipal,
      ),
      undefined,
    );
  });
});

describe("P0-4 classCode forgé — jamais le roster d'une autre classe", () => {
  it("2ème B sans enfant lié → 403", () => {
    expectBusinessForbidden(() =>
      scopeClassStudentsForPrincipal(
        { role: "Parent", schoolCode: "CD-LAC-26-001", studentIds: ["STU-MAEVA"] },
        { classCode: "CLS-2B", classId: "uuid-2b", className: "2ème B" },
        [SIBLING],
        resolveAuthorizedStudentForPrincipal,
      ),
    );
  });
});

describe("P0-6 Parent sans enfant lié — 0 donnée, jamais fallback établissement", () => {
  it("roster 2ème A → 403", () => {
    expectBusinessForbidden(() =>
      scopeClassStudentsForPrincipal(
        { role: "Parent", schoolCode: "CD-LAC-26-001", studentIds: [] },
        { classCode: "CLS-2A", classId: "uuid-2a", className: "2ème A" },
        ROSTER_2A,
        resolveAuthorizedStudentForPrincipal,
      ),
    );
  });

  it("annuaire établissement → []", () => {
    const scoped = scopeSchoolStudentsForPrincipal(
      { role: "Parent", schoolCode: "CD-LAC-26-001", studentIds: [] },
      ROSTER_2A,
      resolveAuthorizedStudentForPrincipal,
    );
    assert.deepEqual(scoped, []);
  });
});

describe("P0-7 Enseignant — uniquement classes affectées", () => {
  it("voit le roster 2ème A si affectation active", () => {
    const scoped = scopeClassStudentsForPrincipal(
      {
        role: "Enseignant",
        schoolCode: "CD-LAC-26-001",
        assignments: [{ classCode: "CLS-2A", classId: "uuid-2a", status: "active" }],
      },
      { classCode: "CLS-2A", classId: "uuid-2a", className: "2ème A" },
      ROSTER_2A,
      resolveAuthorizedStudentForPrincipal,
    );
    assert.equal(scoped.length, 4);
  });

  it("refuse 2ème B hors affectation", () => {
    expectBusinessForbidden(() =>
      scopeClassStudentsForPrincipal(
        {
          role: "Enseignant",
          schoolCode: "CD-LAC-26-001",
          assignments: [{ classCode: "CLS-2A", classId: "uuid-2a", status: "active" }],
        },
        { classCode: "CLS-2B", classId: "uuid-2b", className: "2ème B" },
        [SIBLING],
        resolveAuthorizedStudentForPrincipal,
      ),
    );
  });

  it("GET /classes ne renvoie que la classe affectée", () => {
    const scoped = scopeSchoolClassesForPrincipal(
      {
        role: "Enseignant",
        assignments: [{ classCode: "CLS-2A", classId: "uuid-2a", status: "active" }],
      },
      CLASSES,
    );
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].classCode, "CLS-2A");
  });
});

describe("P0-8 Admin établissement — vue classe complète", () => {
  it("voit les 4 élèves de 2ème A", () => {
    const scoped = scopeClassStudentsForPrincipal(
      { role: "Admin School", schoolCode: "CD-LAC-26-001" },
      { classCode: "CLS-2A", classId: "uuid-2a", className: "2ème A" },
      ROSTER_2A,
      resolveAuthorizedStudentForPrincipal,
    );
    assert.equal(scoped.length, 4);
  });
});

describe("P0 GET /classes — Parent ne reçoit jamais le catalogue établissement", () => {
  it("ne renvoie pas 2ème B ni l'effectif nominatif de 2ème A", () => {
    const scoped = scopeSchoolClassesForPrincipal(
      { role: "Parent", schoolCode: "CD-LAC-26-001", studentIds: ["STU-MAEVA"] },
      CLASSES,
    );
    assert.equal(
      scoped.some((row) => row.classCode === "CLS-2B"),
      false,
      "Parent ne doit pas voir une classe sans enfant lié",
    );
    assert.equal(
      scoped.some((row) => Number(row.students) >= 4),
      false,
      "Parent ne doit pas recevoir l'effectif camarades (students: 4)",
    );
  });
});

describe("P0 fail-closed — roleKeys PARENT sans libellé role", () => {
  it("ne tombe pas en return rows (fuite roster complet)", () => {
    expectBusinessForbidden(() =>
      scopeClassStudentsForPrincipal(
        { roleKeys: ["PARENT"], studentIds: ["STU-MAEVA"] },
        { classCode: "CLS-2A", classId: "uuid-2a", className: "2ème A" },
        ROSTER_2A,
        resolveAuthorizedStudentForPrincipal,
      ),
    );
  });
});
