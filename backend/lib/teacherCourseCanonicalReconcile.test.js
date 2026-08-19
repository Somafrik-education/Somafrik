"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const {
  extractEnsSequence,
  extractTeacherLoginId,
  formatCanonicalTeacherCodes,
  generateNextTeacherCodes,
  isLegacyShortTeacherCode,
  teacherPublicCodesMatch,
  sqlTeacherIdentityEquals,
} = require("./teacherCodeAllocation");
const {
  classifyTeacherPublicCode,
  decideSchoolCourseMaterialization,
  CANONICAL_SCHOOL_COURSE_AMBIGUOUS,
} = require("./teacherCourseCanonicalReconcile");

test("règle officielle : ENS-0001 → {schoolCode}-ENS-0001, login inchangé", () => {
  const codes = formatCanonicalTeacherCodes("CD-2026-0001", 1);
  assert.deepEqual(codes, {
    identifier: "ENS-0001",
    teacherCode: "CD-2026-0001-ENS-0001",
    userCode: "CD-2026-0001-ENS-0001",
    publicId: "CD-2026-0001-ENS-0001",
  });
  assert.equal(extractTeacherLoginId("ENS-0001"), "ENS-0001");
  assert.equal(extractTeacherLoginId(codes.teacherCode), "ENS-0001");
  assert.equal(extractEnsSequence("ENS-0001"), 1);
  assert.equal(isLegacyShortTeacherCode("ENS-0001"), true);
  assert.equal(isLegacyShortTeacherCode("CD-2026-0001-ENS-0001"), false);
});

test("generateNextTeacherCodes réutilise formatCanonicalTeacherCodes", () => {
  const next = generateNextTeacherCodes("CD-2026-0001", ["ENS-0001", "CD-2026-0001-ENS-0002"]);
  assert.equal(next.identifier, "ENS-0003");
  assert.equal(next.teacherCode, "CD-2026-0001-ENS-0003");
});

test("cas Seke : teacher_code historique classé legacy-short", () => {
  const seke = classifyTeacherPublicCode("ENS-0001", "CD-2026-0001");
  assert.equal(seke.kind, "legacy-short");
  assert.equal(seke.canonical.teacherCode, "CD-2026-0001-ENS-0001");
  assert.equal(classifyTeacherPublicCode("CD-2026-0001-ENS-0001", "CD-2026-0001").kind, "canonical");
});

test("alias login : ENS-0001 matche le code technique canonique", () => {
  assert.equal(teacherPublicCodesMatch("CD-2026-0001-ENS-0001", "ENS-0001"), true);
  assert.equal(teacherPublicCodesMatch("CD-2026-0001-ENS-0001", "CD-2026-0001-ENS-0001"), true);
  assert.equal(teacherPublicCodesMatch("CD-2026-0001-ENS-0001", "ENS-0002"), false);
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
  assert.equal(
    decideSchoolCourseMaterialization({
      matchingByTeacher: [{ id: "a" }, { id: "b" }],
      matchingByClassSubject: [{ id: "a" }, { id: "b" }],
    }).action,
    "stop",
  );
});

test("prédicat SQL d'identité enseignant accepte l'alias ENS-####", () => {
  const sql = sqlTeacherIdentityEquals("t", "u", "$2");
  assert.match(sql, /legacy_teacher_code/);
  assert.match(sql, /ENS-\[0-9\]\+/);
  assert.match(sql, /u\.user_code/);
});

test("boot PostgreSQL appelle la réconciliation après le schéma pédagogie", () => {
  const source = fs.readFileSync(path.join(__dirname, "../db/postgresRepository.js"), "utf8");
  assert.match(source, /ensureTeacherCourseCanonicalReconcile/);
  assert.match(source, /ensurePedagogyCanonicalSchema\(\)/);
});

test("schema.sql et la migration dédiée exposent legacy_teacher_code", () => {
  const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
  const migration = fs.readFileSync(
    path.join(__dirname, "../db/migrations/20260819_teacher_legacy_code.sql"),
    "utf8",
  );
  assert.match(schema, /legacy_teacher_code/);
  assert.match(migration, /legacy_teacher_code/);
  const helper = fs.readFileSync(path.join(__dirname, "../db/teachersLegacyCodeSchema.js"), "utf8");
  assert.match(helper, /20260819_teacher_legacy_code\.sql/);
});

test("fixtures PG enseignants appliquent la migration legacy_teacher_code", () => {
  const files = [
    "teachersRepository.pg.test.js",
    "teacherLifecycleRepository.pg.test.js",
    "subjectsAssignments.pg.test.js",
    "teacherLoginScope.pg.test.js",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.match(
      source,
      /ensureTeachersLegacyCodeSchema/,
      `${file} doit appliquer la migration canonique legacy_teacher_code`,
    );
  }
});
