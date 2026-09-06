"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ALL_INVENTORY_SQL,
  CANONICAL_SCHOOL_COURSE_AMBIGUOUS,
  SCHOOL_COURSE_AMBIGUITY_OK,
  UNIQUE_INDEX_NAME,
  assertSelectOnlySql,
  assertInventorySqlIsSelectOnly,
  assertNoWriteFlags,
  proposeDuplicateGroupRepair,
  buildInventoryReport,
} = require("./schoolCourseAmbiguityInventory");
const {
  assertProposalSafeToApply,
} = require("./schoolCourseAmbiguityRepair");
const {
  decideSchoolCourseMaterialization,
  CANONICAL_SCHOOL_COURSE_AMBIGUOUS: RECONCILE_AMBIGUOUS,
} = require("./teacherCourseCanonicalReconcile");

test("tous les SQL d'inventaire sont SELECT-only", () => {
  assertInventorySqlIsSelectOnly();
  for (const sql of ALL_INVENTORY_SQL) {
    assert.match(sql, /\bSELECT\b/i);
    assert.doesNotThrow(() => assertSelectOnlySql(sql));
  }
  const standalone = fs.readFileSync(
    path.join(__dirname, "../db/inventory_school_course_ambiguity.sql"),
    "utf8",
  );
  assert.doesNotThrow(() => assertSelectOnlySql(standalone));
  assert.match(standalone, /HAVING COUNT\(\*\) > 1/);
  assert.match(standalone, /teacher_id IS DISTINCT FROM ta.teacher_id/);
});

test("assertSelectOnlySql refuse un UPDATE", () => {
  assert.throws(() => assertSelectOnlySql("UPDATE school_courses SET status = 'archived'"), /écriture/);
});

test("drapeaux d'écriture refusés sur l'inventaire", () => {
  assert.throws(() => assertNoWriteFlags(["node", "script", "--apply"], {}), /écriture refusé/);
  assert.throws(
    () => assertNoWriteFlags(["node", "script"], { SOMAFRIK_SCHOOL_COURSE_AMBIGUITY_APPLY: "1" }),
    /APPLY/,
  );
  assert.doesNotThrow(() => assertNoWriteFlags(["node", "script"], {}));
});

test("fail-closed reconcile inchangé : collision classe+matière → STOP", () => {
  const otherTeacher = decideSchoolCourseMaterialization({
    matchingByTeacher: [],
    matchingByClassSubject: [{ id: "other-teacher" }],
  });
  assert.equal(otherTeacher.action, "stop");
  assert.equal(otherTeacher.code, RECONCILE_AMBIGUOUS);
  assert.equal(RECONCILE_AMBIGUOUS, CANONICAL_SCHOOL_COURSE_AMBIGUOUS);
  assert.equal(
    decideSchoolCourseMaterialization({
      matchingByTeacher: [{ id: "a" }, { id: "b" }],
      matchingByClassSubject: [{ id: "a" }, { id: "b" }],
    }).action,
    "stop",
  );
});

test("doublon teacher_id NULL vs affectation alignée → archive la ligne sans enseignant", () => {
  const proposal = proposeDuplicateGroupRepair(
    [
      { id: "orphan", teacher_id: null, weekly_slot_count: 0 },
      { id: "canon", teacher_id: "T1", weekly_slot_count: 0 },
    ],
    ["T1"],
  );
  assert.equal(proposal.action, "archive_duplicates");
  assert.equal(proposal.keepId, "canon");
  assert.deepEqual(proposal.archiveIds, ["orphan"]);
  assert.equal(proposal.confidence, "unique_assignment_match");
});

test("doublons même enseignant + un seul weekly → archive les lignes sans dépendance", () => {
  const proposal = proposeDuplicateGroupRepair(
    [
      { id: "keep", teacher_id: "T1", weekly_slot_count: 3 },
      { id: "dup", teacher_id: "T1", weekly_slot_count: 0 },
    ],
    ["T1"],
  );
  assert.equal(proposal.action, "archive_duplicates");
  assert.equal(proposal.keepId, "keep");
  assert.deepEqual(proposal.archiveIds, ["dup"]);
  assert.equal(proposal.confidence, "unique_weekly_dependency");
});

test("deux teacher_id actifs → needs_human, aucun archive", () => {
  const proposal = proposeDuplicateGroupRepair(
    [
      { id: "a", teacher_id: "T1", weekly_slot_count: 4 },
      { id: "b", teacher_id: "T2", weekly_slot_count: 0 },
    ],
    ["T1"],
  );
  assert.equal(proposal.action, "needs_human");
  assert.deepEqual(proposal.archiveIds, []);
  assert.equal(proposal.keepId, null);
});

test("rapport : 0 collision → OK ; affectation vs autre enseignant → bloque le boot", () => {
  const clean = buildInventoryReport({
    uniqueIndex: { indexname: UNIQUE_INDEX_NAME, indexdef: "UNIQUE ..." },
    duplicateGroups: [],
    duplicateRows: [],
    assignmentCollisions: [],
    nonCanonicalAssignments: [],
  });
  assert.equal(clean.code, SCHOOL_COURSE_AMBIGUITY_OK);
  assert.equal(clean.blocksBoot, false);
  assert.equal(clean.uniqueIndex.present, true);

  const schoolId = "s1";
  const classId = "c1";
  const subjectId = "sub1";
  const blocking = buildInventoryReport({
    uniqueIndex: { indexname: UNIQUE_INDEX_NAME },
    duplicateGroups: [],
    duplicateRows: [],
    assignmentCollisions: [
      {
        assignment_id: "ta1",
        school_id: schoolId,
        school_code: "CD-2026-0001",
        class_id: classId,
        class_code: "CLS-2A",
        subject_id: subjectId,
        subject_code: "SUB-MATH",
        assignment_teacher_id: "T-ASSIGN",
        assignment_teacher_code: "CD-2026-0001-ENS-0001",
        course_teacher_id: "T-OTHER",
        course_teacher_code: "CD-2026-0001-ENS-0099",
        school_course_id: "sc-other",
      },
    ],
    nonCanonicalAssignments: [],
  });
  assert.equal(blocking.code, CANONICAL_SCHOOL_COURSE_AMBIGUOUS);
  assert.equal(blocking.blocksBoot, true);
  assert.equal(blocking.proposal.assignmentProposals[0].action, "needs_human");
  assert.equal(blocking.proposal.needsHuman, true);
  assert.match(blocking.diagnostic, /CANONICAL_SCHOOL_COURSE_AMBIGUOUS/);
});

test("correctif refuse needs_human — pas d'archivage silencieux", () => {
  assert.throws(
    () =>
      assertProposalSafeToApply({
        needsHuman: true,
        autoArchiveIds: ["dup"],
      }),
    (error) => error.code === "SCHOOL_COURSE_AMBIGUITY_NEEDS_HUMAN",
  );
  assert.throws(
    () => assertProposalSafeToApply({ needsHuman: false, autoArchiveIds: [] }),
    (error) => error.code === "SCHOOL_COURSE_AMBIGUITY_NOTHING_TO_ARCHIVE",
  );
  assert.deepEqual(
    assertProposalSafeToApply({ needsHuman: false, autoArchiveIds: ["dup-1"] }),
    ["dup-1"],
  );
});

test("boot PostgreSQL conserve ensureTeacherCourseCanonicalReconcile", () => {
  const source = fs.readFileSync(path.join(__dirname, "../db/postgresRepository.js"), "utf8");
  assert.match(source, /ensureTeacherCourseCanonicalReconcile/);
  const reconcile = fs.readFileSync(path.join(__dirname, "./teacherCourseCanonicalReconcile.js"), "utf8");
  assert.match(reconcile, /Plusieurs school_courses actifs ou collision classe\+matière/);
  const cli = fs.readFileSync(path.join(__dirname, "../scripts/inventory-school-course-ambiguity.js"), "utf8");
  assert.match(cli, /BEGIN READ ONLY/);
  assert.match(cli, /assertNoWriteFlags/);
  const pkg = fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8");
  assert.match(pkg, /inventory:school-course-ambiguity/);
  assert.match(pkg, /verify:school-course-ambiguity-inventory/);
});
