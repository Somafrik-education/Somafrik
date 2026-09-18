import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classGradesStats } from "./classGradesStats";
import { canArchiveExams, canCreateExams, canReadExams, canUpdateExams, canValidateExams } from "./examPermissions";
import { normalizeGrade } from "./evaluationsV2";
import { canonicalCourseAverage, canonicalStudentGeneralAverage, courseOptionsFromNotes } from "./pedagogyAverage";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function session(permissions: string[]) {
  return { role: "school_admin", permissions, user: { id: "u1", permissions } };
}

const mathLow = normalizeGrade({
  id: "m1",
  evaluationId: "MATH-1",
  studentId: "s1",
  value: 10,
  scale: 20,
  subject: "Mathématiques",
  evaluationCoefficient: 1,
  coefficient: 2,
  gradeStatus: "graded",
  period: "T1",
});
const mathHigh = normalizeGrade({
  id: "m2",
  evaluationId: "MATH-2",
  studentId: "s1",
  value: 20,
  scale: 20,
  subject: "Mathématiques",
  evaluationCoefficient: 3,
  coefficient: 2,
  gradeStatus: "graded",
  period: "T1",
});
const french = normalizeGrade({
  id: "f1",
  evaluationId: "FR-1",
  studentId: "s1",
  value: 12,
  scale: 20,
  subject: "Français",
  evaluationCoefficient: 1,
  coefficient: 1,
  gradeStatus: "graded",
  period: "T1",
});

test("PARITY-033 — 17,5 / 12 / 15,67 et 16,4 interdit", () => {
  const notes = [mathLow, mathHigh, french];
  const maths = canonicalCourseAverage(notes, "Mathématiques");
  const fr = canonicalCourseAverage(notes, "Français");
  const general = canonicalStudentGeneralAverage(notes);
  assert.equal(Number(maths.average?.toFixed(1)), 17.5);
  assert.equal(Number(fr.average?.toFixed(1)), 12);
  assert.equal(Number(general.average?.toFixed(2)), 15.67);
  assert.notEqual(Number(general.average?.toFixed(1)), 16.4);
  assert.deepEqual(courseOptionsFromNotes(notes), ["Français", "Mathématiques"]);
});

test("PARITY-033 — changement d'enfant : options cours isolées", () => {
  const childA = [mathLow, mathHigh, french];
  const childB = [
    normalizeGrade({
      id: "h1",
      evaluationId: "HIST-1",
      studentId: "s2",
      value: 14,
      scale: 20,
      subject: "Histoire",
      evaluationCoefficient: 1,
      coefficient: 1,
      gradeStatus: "graded",
    }),
  ];
  assert.deepEqual(courseOptionsFromNotes(childA), ["Français", "Mathématiques"]);
  assert.deepEqual(courseOptionsFromNotes(childB), ["Histoire"]);
  assert.equal(canonicalCourseAverage(childB, "Mathématiques").available, false);
});

test("PARITY-060 — stats classe, égalité de rang, at-risk, scope enseignant", () => {
  const students = [
    { id: "s1", name: "Ada", className: "6ème A" },
    { id: "s2", name: "Binta", className: "6ème A" },
    { id: "s3", name: "Cyril", className: "6ème A" },
    { id: "s4", name: "Dina", className: "6ème B" },
  ];
  const notes = [
    mathLow,
    mathHigh,
    french,
    normalizeGrade({
      id: "b1",
      evaluationId: "MATH-1",
      studentId: "s2",
      value: 10,
      scale: 20,
      subject: "Mathématiques",
      evaluationCoefficient: 1,
      coefficient: 2,
      gradeStatus: "graded",
      period: "T1",
    }),
    normalizeGrade({
      id: "b2",
      evaluationId: "MATH-2",
      studentId: "s2",
      value: 20,
      scale: 20,
      subject: "Mathématiques",
      evaluationCoefficient: 3,
      coefficient: 2,
      gradeStatus: "graded",
      period: "T1",
    }),
    normalizeGrade({
      id: "b3",
      evaluationId: "FR-1",
      studentId: "s2",
      value: 12,
      scale: 20,
      subject: "Français",
      evaluationCoefficient: 1,
      coefficient: 1,
      gradeStatus: "graded",
      period: "T1",
    }),
    normalizeGrade({
      id: "c1",
      evaluationId: "FR-1",
      studentId: "s3",
      value: 8,
      scale: 20,
      subject: "Français",
      evaluationCoefficient: 1,
      coefficient: 1,
      gradeStatus: "graded",
      period: "T1",
    }),
  ];
  const stats = classGradesStats({ students, notes, className: "6ème A", period: "T1" });
  assert.equal(stats.ranking[0].rank, 1);
  assert.equal(stats.ranking[1].rank, 1);
  assert.equal(Number(stats.ranking[0].average.toFixed(2)), 15.67);
  assert.equal(stats.atRisk.map((row) => row.studentId).join(","), "s3");
  assert.equal(stats.successRate, 67);
  assert.ok(stats.classAverage > 0);
  assert.equal(stats.bestAverage >= stats.lowestAverage, true);

  const denied = classGradesStats({
    students,
    notes,
    className: "6ème B",
    allowedClassNames: ["6ème A"],
  });
  assert.equal(denied.empty, true);
  assert.equal(denied.ranking.length, 0);

  const none = classGradesStats({ students, notes: [], className: "6ème A", period: "T2" });
  assert.equal(none.empty, true);
});

test("PARITY-024 — RBAC Examens aligné matrice backend", () => {
  assert.equal(canReadExams(session(["Examens:READ"])), true);
  assert.equal(canReadExams(session(["Gérer cours"])), true);
  assert.equal(canReadExams(session(["Notes:READ"])), false);
  assert.equal(canCreateExams(session(["Examens:CREATE"])), true);
  assert.equal(canCreateExams(session(["Examens:READ"])), false);
  assert.equal(canUpdateExams(session(["Organiser examens"])), true);
  assert.equal(canValidateExams(session(["Valider examens"])), true);
  assert.equal(canValidateExams(session(["Examens:CREATE"])), false);
  assert.equal(canArchiveExams(session(["Examens:DELETE"])), true);
  assert.equal(canArchiveExams(session(["Examens:READ"])), false);
});

test("PARITY-023 — zéro mutation Report Card dans les modules LOT 5", () => {
  const files = [
    "Mobile/src/lib/reportCardPublicationApi.ts",
    "Mobile/src/lib/reportCardHistoryApi.ts",
    "Mobile/src/lib/reportCardWorkflowApi.ts",
    "Mobile/src/screens/ReportCardsScreen.tsx",
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.doesNotMatch(src, /method:\s*["'`]POST/, rel);
    assert.doesNotMatch(src, /method:\s*["'`]PUT/, rel);
    assert.doesNotMatch(src, /method:\s*["'`]PATCH/, rel);
    assert.doesNotMatch(src, /method:\s*["'`]DELETE/, rel);
    assert.doesNotMatch(src, /\/corrections/, rel);
    assert.doesNotMatch(src, /\/revoke/, rel);
  }
});
