"use strict";

/**
 * P0 Parent Attendance Isolation — TenantScopeService fail-closed (matrice GREEN).
 * Une ligne « classe seule » (className, sans studentId / matricule) ne doit
 * jamais être visible de tous les parents.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { TenantScopeService } = require("./tenantScopeService");

const SCHOOL = "CD-LAC-26-001";
const parent = {
  role: "Parent",
  schoolCode: SCHOOL,
  studentIds: ["STU-MAEVA"],
};

describe("TenantScopeService — Parent fail-closed", () => {
  it("conserve uniquement l'enfant lié", () => {
    const scoped = new TenantScopeService().filterRows(
      [
        { id: "STU-MAEVA", matricule: "STU-MAEVA", className: "2ème A", schoolCode: SCHOOL },
        { id: "STU-AISHA", matricule: "STU-AISHA", className: "2ème A", schoolCode: SCHOOL },
      ],
      parent,
    );
    assert.deepEqual(
      scoped.map((row) => row.id),
      ["STU-MAEVA"],
    );
  });

  it("n'élargit pas au camarade sans matricule (className passthrough interdit)", () => {
    const scoped = new TenantScopeService().filterRows(
      [
        { id: "STU-MAEVA", matricule: "STU-MAEVA", className: "2ème A", schoolCode: SCHOOL },
        { id: "STU-AISHA", className: "2ème A", schoolCode: SCHOOL },
      ],
      parent,
    );
    assert.equal(
      scoped.some((row) => row.id === "STU-AISHA"),
      false,
      "camarade sans matricule ne doit pas passer le filtre Parent",
    );
  });

  it("n'élargit pas à une ligne catalogue de classe (KPI / Changer de classe)", () => {
    const scoped = new TenantScopeService().filterRows(
      [
        { className: "2ème A", schoolCode: SCHOOL, students: 4, entityType: "class" },
        { className: "2ème B", schoolCode: SCHOOL, students: 28, entityType: "class" },
      ],
      parent,
    );
    assert.equal(scoped.length, 0, "aucune ligne classe-seule pour un Parent");
  });

  it("Parent sans studentIds → 0 ligne, jamais l'établissement", () => {
    const scoped = new TenantScopeService().filterRows(
      [
        { id: "STU-MAEVA", matricule: "STU-MAEVA", className: "2ème A", schoolCode: SCHOOL },
        { className: "2ème A", schoolCode: SCHOOL, students: 4 },
      ],
      { role: "Parent", schoolCode: SCHOOL, studentIds: [] },
    );
    assert.deepEqual(scoped, []);
  });

  it("P0-9 aucune fuite inter-établissement", () => {
    const scoped = new TenantScopeService().filterRows(
      [
        { id: "STU-MAEVA", matricule: "STU-MAEVA", className: "2ème A", schoolCode: SCHOOL },
        { id: "STU-B", matricule: "STU-B", className: "2ème A", schoolCode: "BI-BUJ-26-001" },
      ],
      parent,
    );
    assert.equal(
      scoped.some((row) => row.schoolCode === "BI-BUJ-26-001"),
      false,
    );
  });
});
