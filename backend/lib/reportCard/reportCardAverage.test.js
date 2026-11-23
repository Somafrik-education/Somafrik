"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { computeReportCardAverage } = require("./reportCardAverage");

test("bulletin T1 : même pondération que Backend/Notes Mobile, sans moyenne plate", () => {
  const rows = [
    { subject_name: "Mathématiques", score: 8, max_score: 10, evaluation_coefficient: 1, subject_coefficient: 2, grade_status: "graded" },
    { subject_name: "Mathématiques", score: 20, max_score: 20, evaluation_coefficient: 3, subject_coefficient: 2, grade_status: "graded" },
    { subject_name: "Français", score: 12, max_score: 20, evaluation_coefficient: 1, subject_coefficient: 1, grade_status: "graded" },
  ];
  assert.equal(computeReportCardAverage(rows, "s1"), 16.67);
  assert.notEqual(computeReportCardAverage(rows, "s1"), 13.33);
});

test("bulletin : exclut absences, gère absence de note éligible", () => {
  assert.equal(computeReportCardAverage([], "s1"), null);
  assert.equal(computeReportCardAverage([{ subject_name: "Mathématiques", score: null, grade_status: "absent" }], "s1"), null);
  assert.equal(computeReportCardAverage([
    { subject_name: "Mathématiques", score: 10, max_score: 20, subject_coefficient: 1, evaluation_coefficient: 1, grade_status: "graded" },
    { subject_name: "Mathématiques", score: null, max_score: 20, grade_status: "excused" },
  ], "s1"), 10);
});

test("bulletin PG : joint les coefficients de cours et d'évaluation, normalise /max_score", () => {
  const file = fs.readFileSync(path.join(__dirname, "../../db/documentsExamsPgStore.js"), "utf8");
  const body = file.slice(file.indexOf("async function computeStudentAverage"), file.indexOf("async function hydrateReportCard"));
  assert.match(body, /e\.max_score/);
  assert.match(body, /e\.coefficient AS evaluation_coefficient/);
  assert.match(body, /sc\.coefficient/);
  assert.match(body, /sub\.coefficient/);
  assert.match(body, /e\.term_id = \$3/);
  assert.doesNotMatch(body, /AVG\(g\.score\)/);
});
