"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const {
  formatCanonicalTeacherCodes,
  teacherPublicCodesMatch,
  sqlTeacherIdentityEquals,
} = require("./teacherCodeAllocation");
const {
  classifyTeacherPublicCode,
  decideSchoolCourseMaterialization,
  CANONICAL_SCHOOL_COURSE_AMBIGUOUS,
} = require("./teacherCourseCanonicalReconcile");

test("identité enseignant = code personne, pas ENS-####", () => {
  const codes = formatCanonicalTeacherCodes(
    { loginCode: "CD-IN-26-001" },
    { firstName: "Jean Pierre", lastName: "Mbuyi" },
    1,
    2026,
  );
  assert.equal(codes.teacherCode, "CD-IN-JPM-26-00001");
  assert.equal(codes.identifier, codes.teacherCode);
  assert.equal(teacherPublicCodesMatch(codes.teacherCode, "ENS-0001"), false);
});

test("réconciliation n'écrit plus de code enseignant", () => {
  assert.equal(classifyTeacherPublicCode().kind, "canonical");
});

test("B : 0 school_course → insert ; déjà présent → skip ; collision → STOP", () => {
  assert.deepEqual(
    decideSchoolCourseMaterialization({ matchingByTeacher: [], matchingByClassSubject: [] }),
    { action: "insert" },
  );
  assert.deepEqual(
    decideSchoolCourseMaterialization({
      matchingByTeacher: [{ id: "c1" }],
      matchingByClassSubject: [{ id: "c1" }],
    }),
    { action: "skip" },
  );
  const ambiguous = decideSchoolCourseMaterialization({
    matchingByTeacher: [],
    matchingByClassSubject: [{ id: "other-teacher" }],
  });
  assert.equal(ambiguous.action, "stop");
  assert.equal(ambiguous.code, CANONICAL_SCHOOL_COURSE_AMBIGUOUS);
});

test("prédicat SQL enseignant : exact, sans legacy_teacher_code", () => {
  const sql = sqlTeacherIdentityEquals("t", "u", "$2");
  assert.doesNotMatch(sql, /legacy_teacher_code/);
  assert.doesNotMatch(sql, /ENS-/);
  assert.match(sql, /u\.user_code/);
});

test("boot PostgreSQL appelle la réconciliation après le schéma pédagogie", () => {
  const source = fs.readFileSync(path.join(__dirname, "../db/postgresRepository.js"), "utf8");
  assert.match(source, /ensureTeacherCourseCanonicalReconcile/);
  assert.match(source, /ensurePedagogyCanonicalSchema\(\)/);
});

test("schema.sql ne crée plus legacy_teacher_code ; DROP est la source boot", () => {
  const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
  assert.doesNotMatch(schema, /ADD COLUMN IF NOT EXISTS legacy_teacher_code/);
  const drop = fs.readFileSync(
    path.join(__dirname, "../db/migrations/20260903_drop_legacy_teacher_code.sql"),
    "utf8",
  );
  assert.match(drop, /DROP COLUMN IF EXISTS legacy_teacher_code/);
  const helper = fs.readFileSync(path.join(__dirname, "../db/teachersLegacyCodeSchema.js"), "utf8");
  assert.match(helper, /20260903_drop_legacy_teacher_code\.sql/);
});
