"use strict";

/**
 * Diagnostic P0 AUTH/SCOPE TEACHER — pas un contrat produit.
 *
 * Après #247, GET /api/classes est fail-closed pour un Enseignant : si le JWT
 * n'embarque aucun classId/classCode actif, la liste est []. Ce fichier prouve
 * que le login / refresh **reproduit ce vide** même quand PostgreSQL a des
 * teacher_assignments actives avec class_id — donc une reconnexion ne restaure
 * pas les classes.
 *
 * Chaîne auditée (formes de production, sans PII) :
 *   mapTeacher embed {className, course}
 *   + mapAssignment global {classId, classCode, status}
 *   → resolveTeacherAssignments / dedupeAssignments (clé className|course)
 *   → enrichTeacherUserWithActiveAssignments / filterActiveTeacherAssignments
 *   → scopeSchoolClassesForPrincipal
 *
 * Contraste : teachersRepository.mapActiveAssignments conserve classId.
 *
 * Quand le P0 sera corrigé, ces assertions « drop » devront être inversées.
 */

const assert = require("node:assert/strict");
const {
  resolveTeacherAssignments,
  dedupeAssignments,
} = require("../services/authService");
const { mapActiveAssignments } = require("../db/teachersRepository");
const {
  enrichTeacherUserWithActiveAssignments,
  teacherPrincipalAssignmentFields,
} = require("./teacherSessionAssignments");
const {
  filterActiveTeacherAssignments,
  scopeSchoolClassesForPrincipal,
} = require("./classStudentsAuthz");

const CLASS_A_ID = "11111111-1111-4111-8111-111111111111";
const CLASS_B_ID = "22222222-2222-4222-8222-222222222222";
const TEACHER_CODE = "CD-2026-0001-ENS-0099";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function pgAssignmentRows() {
  return [
    {
      id: "asg-1",
      teacher_code: TEACHER_CODE,
      class_id: CLASS_A_ID,
      class_name: "2ème A",
      class_code: "CLS-2A",
      subject_name: "Mathématiques",
      subject_code: "MATH",
      status: "active",
    },
    {
      id: "asg-2",
      teacher_code: TEACHER_CODE,
      class_id: CLASS_B_ID,
      class_name: "2ème B",
      class_code: "CLS-2B",
      subject_name: "Mathématiques",
      subject_code: "MATH",
      status: "active",
    },
  ];
}

/** postgresRepository.mapTeacher : embed réduit à { className, course }. */
function mapTeacherEmbed(assignmentRows, teacherCode) {
  return assignmentRows
    .filter((row) => row.teacher_code === teacherCode)
    .map((row) => ({ className: row.class_name, course: row.subject_name }));
}

/** teacherAssignmentsRepository.mapAssignment : identités canoniques conservées. */
function mapAssignmentGlobal(row) {
  return {
    id: row.id,
    schoolCode: "CD-2026-0001",
    teacherId: row.teacher_code,
    teacherCode: row.teacher_code,
    teacherName: "Enseignant Diagnostic",
    classId: row.class_id,
    className: row.class_name,
    classCode: row.class_code,
    subject: row.subject_name,
    course: row.subject_name,
    subjectCode: row.subject_code,
    status: row.status,
  };
}

function productionLoginState() {
  const rows = pgAssignmentRows();
  return {
    teachers: [
      {
        id: TEACHER_CODE,
        publicId: TEACHER_CODE,
        userId: USER_ID,
        identifier: "ENS-0099",
        schoolCode: "CD-2026-0001",
        assignments: mapTeacherEmbed(rows, TEACHER_CODE),
      },
    ],
    assignments: rows.map(mapAssignmentGlobal),
  };
}

function teacherUser() {
  return {
    id: USER_ID,
    identifier: "ENS-0099",
    role: "Enseignant",
    schoolCode: "CD-2026-0001",
  };
}

function schoolClassRows() {
  return [
    { id: CLASS_A_ID, classId: CLASS_A_ID, classCode: "CLS-2A", name: "2ème A" },
    { id: CLASS_B_ID, classId: CLASS_B_ID, classCode: "CLS-2B", name: "2ème B" },
  ];
}

function testTeachersRepositoryKeepsCanonicalIds() {
  const mapped = mapActiveAssignments(pgAssignmentRows(), TEACHER_CODE);
  assert.equal(mapped.length, 2);
  assert.deepEqual(
    mapped.map((row) => row.classId).sort(),
    [CLASS_A_ID, CLASS_B_ID].sort(),
  );
  assert.deepEqual(
    mapped.map((row) => row.classCode).sort(),
    ["CLS-2A", "CLS-2B"],
  );
  assert.ok(mapped.every((row) => row.status === "active"));
}

function testDedupeDropsCanonicalWhenEmbedWins() {
  const state = productionLoginState();
  const teacher = state.teachers[0];
  const resolved = resolveTeacherAssignments(teacher, teacherUser(), state.assignments);

  assert.equal(resolved.length, 2, "les 2 paires className|course survivent");
  for (const row of resolved) {
    assert.equal(row.classId, undefined, "l'embed gagne : classId perdu");
    assert.equal(row.classCode, undefined, "l'embed gagne : classCode perdu");
    assert.equal(row.status, undefined, "l'embed n'a pas de status");
  }

  const globalOnly = dedupeAssignments(state.assignments);
  assert.equal(globalOnly.length, 2);
  assert.ok(globalOnly.every((row) => row.classId && row.status === "active"));
}

function testDedupeRejectsCanonicalWithoutClassNameOrCourse() {
  const kept = dedupeAssignments([
    {
      classId: CLASS_A_ID,
      classCode: "CLS-2A",
      status: "active",
    },
  ]);
  assert.deepEqual(kept, []);
}

function testWebLoginEnrichmentYieldsEmptyAssignments() {
  const enriched = enrichTeacherUserWithActiveAssignments(teacherUser(), productionLoginState());
  assert.deepEqual(enriched.assignments, []);
  assert.deepEqual(enriched.assignedClassIds, []);
  assert.deepEqual(enriched.assignedClassCodes, []);
}

function testRefreshMintsEmptyPrincipalAssignments() {
  const fields = teacherPrincipalAssignmentFields(teacherUser(), productionLoginState());
  assert.deepEqual(fields.assignments, []);
  assert.deepEqual(fields.classIds, []);
  assert.deepEqual(fields.classCodes, []);
}

function testJwtFilterThenGetClassesReturnsZero() {
  const resolved = resolveTeacherAssignments(
    productionLoginState().teachers[0],
    teacherUser(),
    productionLoginState().assignments,
  );
  const jwtAssignments = filterActiveTeacherAssignments(resolved);
  assert.deepEqual(jwtAssignments, []);

  const scoped = scopeSchoolClassesForPrincipal(
    { role: "Enseignant", assignments: jwtAssignments },
    schoolClassRows(),
  );
  assert.equal(scoped.length, 0);
}

function testEmptyEmbedWouldKeepCanonicalGlobal() {
  const state = productionLoginState();
  state.teachers[0].assignments = [];
  const enriched = enrichTeacherUserWithActiveAssignments(teacherUser(), state);
  assert.equal(enriched.assignments.length, 2);
  assert.deepEqual(enriched.assignedClassIds.sort(), [CLASS_A_ID, CLASS_B_ID].sort());
}

function main() {
  testTeachersRepositoryKeepsCanonicalIds();
  testDedupeDropsCanonicalWhenEmbedWins();
  testDedupeRejectsCanonicalWithoutClassNameOrCourse();
  testWebLoginEnrichmentYieldsEmptyAssignments();
  testRefreshMintsEmptyPrincipalAssignments();
  testJwtFilterThenGetClassesReturnsZero();
  testEmptyEmbedWouldKeepCanonicalGlobal();
  console.log("teacherLoginScope.diagnostic.test.js: OK (P0 drop documented)");
}

main();
