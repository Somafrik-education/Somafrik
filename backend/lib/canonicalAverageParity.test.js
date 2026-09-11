"use strict";

/**
 * Parité moyenne générale canonique Backend / Web / Mobile.
 * Dataset unique : Maths 10×1 + 20×3 (coef cours 2), Français 12 (coef cours 1)
 * => (17,5×2 + 12×1) / 3 = 15,666…  La moyenne plate 16,4 est interdite.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { GradeBookService } = require("../services/gradeBookService");
const { PostgresRepository } = require("../db/postgresRepository");
const { RbacService } = require("../services/rbacService");
const {
  COURSE_GET_ROUTE_KEY,
  COURSE_POST_ROUTE_KEY,
  COURSE_PATCH_ROUTE_KEY,
  COURSE_DELETE_ROUTE_KEY,
  COURSE_READ_PERMISSIONS,
} = require("./coursesRbacPolicy");

const ROOT = path.join(__dirname, "..");
const EXPECTED_GENERAL = (17.5 * 2 + 12 * 1) / 3;
const FLAT_FORBIDDEN = (10 * 1 + 20 * 3 + 12 * 1) / 5;

const PARITY_NOTES = [
  {
    id: "m1",
    studentId: "stu-a",
    subject: "Mathématiques",
    value: 10,
    scale: 20,
    evaluationCoefficient: 1,
    coefficient: 2,
    gradeStatus: "Validée",
  },
  {
    id: "m2",
    studentId: "stu-a",
    subject: "Mathématiques",
    value: 20,
    scale: 20,
    evaluationCoefficient: 3,
    coefficient: 2,
    gradeStatus: "Validée",
  },
  {
    id: "f1",
    studentId: "stu-a",
    subject: "Français",
    value: 12,
    scale: 20,
    evaluationCoefficient: 1,
    coefficient: 1,
    gradeStatus: "Validée",
  },
];

test("projection PG grades : subject_coefficient distinct de evaluation_coefficient", () => {
  const store = fs.readFileSync(path.join(ROOT, "db/pedagogyPgStore.js"), "utf8");
  assert.match(
    store,
    /SELECT sc\.coefficient[\s\S]{0,400}LIMIT 1[\s\S]{0,250}AS subject_coefficient/,
    "le coefficient cours doit être scalaire pour ne pas dupliquer les notes",
  );
  assert.match(store, /sub\.coefficient/);
  assert.match(store, /e\.coefficient AS evaluation_coefficient/);
  const repo = fs.readFileSync(path.join(ROOT, "db/postgresRepository.js"), "utf8");
  assert.match(repo, /coefficient = coefficient du cours/);
  assert.match(repo, /evaluationCoefficient = coefficient de l'évaluation/);
  assert.match(
    repo,
    /SELECT sc\.coefficient[\s\S]{0,400}LIMIT 1[\s\S]{0,250}AS subject_coefficient/,
  );
  assert.match(repo, /ev\.coefficient AS evaluation_coefficient/);
});

test("mapGrade DTO : coefficient = cours, evaluationCoefficient = évaluation", () => {
  const repo = Object.create(PostgresRepository.prototype);
  const dto = repo.mapGrade({
    id: "g-1",
    school_id: "school-1",
    school_code: "SCH-001",
    student_code: "stu-a",
    class_name: "1ère A",
    subject_name: "Mathématiques",
    score: 20,
    subject_coefficient: 2,
    evaluation_coefficient: 3,
    coefficient: 1,
    evaluation_legacy_id: "EVAL-3",
    evaluation_title: "Devoir 2",
    evaluation_type_name: "Devoir",
    evaluation_type_id: "type-1",
    term_name: "Trimestre 1",
    evaluation_max_score: 20,
    grade_status: "graded",
    created_at: "2026-09-01",
    version: 1,
  });
  assert.equal(dto.coefficient, 2);
  assert.equal(dto.evaluationCoefficient, 3);
  assert.equal(dto.value, 20);
  assert.equal(dto.subject, "Mathématiques");
  assert.equal(dto.evaluationId, "EVAL-3");
  assert.notEqual(dto.coefficient, dto.evaluationCoefficient);
});

test("moteur backend : moyenne générale à deux niveaux, catalogue cours vide", () => {
  const book = new GradeBookService({
    students: [{ id: "stu-a", className: "1ère A" }],
    notes: PARITY_NOTES,
    courses: [],
  });
  const average = book.getStudentAverageValue("stu-a", "Trimestre 1");
  assert.equal(Number(average.toFixed(3)), Number(EXPECTED_GENERAL.toFixed(3)));
  assert.equal(Number(average.toFixed(1)), 15.7);
  assert.notEqual(Number(average.toFixed(1)), Number(FLAT_FORBIDDEN.toFixed(1)));
});

test("Notes:READ n'ouvre ni GET ni écriture /api/courses", () => {
  const rbac = new RbacService({});
  const notesOnly = { role: "Parent", permissions: ["Notes:READ"] };
  assert.equal(rbac.canAccess(notesOnly, COURSE_GET_ROUTE_KEY), false);
  assert.equal(rbac.canAccess(notesOnly, COURSE_POST_ROUTE_KEY), false);
  assert.equal(rbac.canAccess(notesOnly, COURSE_PATCH_ROUTE_KEY), false);
  assert.equal(rbac.canAccess(notesOnly, COURSE_DELETE_ROUTE_KEY), false);
  assert.equal(COURSE_READ_PERMISSIONS.includes("Notes:READ"), false);
});
