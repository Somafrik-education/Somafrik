"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { filterReportCardsForPrincipal } = require("./documentsExamsService");

const A = "student-a";
const B = "student-b";

test("Parent ne voit que les bulletins publiés de ses enfants liés", () => {
  const rows = [
    { id: "a-published", studentId: A, status: "published" },
    { id: "a-draft", studentId: A, status: "draft" },
    { id: "b-published", studentId: B, status: "published" },
  ];
  const principal = {
    role: "Parent",
    roleKeys: ["PARENT"],
    guardianStudentIds: [A],
  };

  assert.deepEqual(
    filterReportCardsForPrincipal(rows, principal).map((row) => row.id),
    ["a-published"],
  );
});

test("Parent sans enfant lié reste fail-closed", () => {
  const rows = [{ id: "a-published", studentId: A, status: "published" }];
  const principal = { role: "Parent", roleKeys: ["PARENT"] };
  assert.deepEqual(filterReportCardsForPrincipal(rows, principal), []);
});

test("Élève ne voit que son bulletin publié", () => {
  const rows = [
    { id: "a-published", studentId: A, status: "published" },
    { id: "b-published", studentId: B, status: "published" },
  ];
  const principal = {
    role: "Élève / Étudiant",
    roleKeys: ["STUDENT"],
    linkedStudentIds: [B],
  };
  assert.deepEqual(
    filterReportCardsForPrincipal(rows, principal).map((row) => row.id),
    ["b-published"],
  );
});

test("Personnel conserve la liste métier complète", () => {
  const rows = [
    { id: "draft", studentId: A, status: "draft" },
    { id: "published", studentId: B, status: "published" },
  ];
  const principal = { role: "Préfet des études", roleKeys: ["PREFET_ETUDES"] };
  assert.deepEqual(filterReportCardsForPrincipal(rows, principal), rows);
});
