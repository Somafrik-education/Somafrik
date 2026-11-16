"use strict";

/**
 * Correctif MONO-T1-A1 — périmètre enseignant et homonymes.
 *
 * Défauts corrigés (reproduits sur la démo : quatre « Patrick Ilunga » dans
 * CD-2026-0001, plusieurs classes « 6ème A » / « 6ème B ») :
 *   1. authService.assignmentMatchesTeacher retombait sur le NOM même quand
 *      l'affectation référençait un autre enseignant : le jeton d'un
 *      enseignant embarquait les classes de ses homonymes ;
 *   2. pedagogyGovernanceService.dedupeAssignmentsBySchoolClassSubject
 *      fusionnait les affectations par nom de classe et matière, sans
 *      l'enseignant : classes homonymes et co-enseignants étaient fusionnés en
 *      lignes hybrides et des affectations réelles disparaissaient.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assignmentMatchesTeacher } = require("../services/authService");
const { PedagogyGovernanceService } = require("../services/pedagogyGovernanceService");

const pedagogyGovernanceService = new PedagogyGovernanceService();
const { dedupeBackOfficeState } = require("./backofficeDedupe");
const { enrichTeacherUserWithActiveAssignments } = require("./teacherSessionAssignments");

const SCHOOL = "CD-2026-0001";

function teacherRecord(code, userId) {
  return { id: code, publicId: code, userId, identifier: code, schoolCode: SCHOOL, firstName: "Patrick", lastName: "Ilunga", name: "Patrick Ilunga" };
}

function assignment(id, teacherCode, classId, classCode, className, course, teacherName = "Patrick Ilunga") {
  return {
    id,
    schoolCode: SCHOOL,
    teacherId: teacherCode,
    teacherCode,
    teacherName,
    classId,
    classCode,
    className,
    course,
    subject: course,
    academicYear: "2025-2026",
    assignmentRole: "primary",
    status: "active",
  };
}

const ME = teacherRecord("ENS-0003", "user-0003");
const USER = { id: "user-0003", schoolCode: SCHOOL, firstName: "Patrick", lastName: "Ilunga", role: "Enseignant", identifier: "ENS-0003" };

test("affectation d'un homonyme (autre teacherId) : jamais attribuée par le nom", () => {
  assert.equal(assignmentMatchesTeacher(assignment("a", "ENS-0012", "c1", "CLS-1", "5ème A", "Math"), ME, USER), false);
  assert.equal(
    assignmentMatchesTeacher({ teacherCode: "ENS-0012", teacherName: "Patrick Ilunga", className: "5ème A" }, ME, USER),
    false,
    "teacherCode seul fait aussi foi",
  );
});

test("affectation propre : reconnue par teacherId, teacherCode, publicId ou users.id", () => {
  assert.equal(assignmentMatchesTeacher(assignment("a", "ENS-0003", "c1", "CLS-1", "6ème A", "Sciences"), ME, USER), true);
  assert.equal(assignmentMatchesTeacher({ teacherCode: "ENS-0003" }, ME, USER), true);
  assert.equal(assignmentMatchesTeacher({ teacherId: "user-0003" }, ME, USER), true);
});

test("affectation sans aucune référence d'enseignant : le repli par nom reste possible (historique)", () => {
  assert.equal(assignmentMatchesTeacher({ teacherName: "Patrick Ilunga", className: "6ème A" }, ME, USER), true);
  assert.equal(assignmentMatchesTeacher({ teacherName: "Chantal Kalala", className: "6ème A" }, ME, USER), false);
});

test("déduplication : classes homonymes et co-enseignants restent distincts ; un vrai doublon est fusionné", () => {
  const rows = [
    assignment("1", "ENS-0003", "c-6a-1", "CLS-35", "6ème A", "Sciences"),
    assignment("2", "ENS-0022", "c-6a-2", "CLS-36", "6ème A", "Sciences"),
    assignment("3", "ENS-0003", "c-6b-1", "CLS-41", "6ème B", "Sciences"),
    assignment("4", "ENS-0008", "c-6b-1", "CLS-41", "6ème B", "Sciences", "Chantal Kalala"),
    { ...assignment("3", "ENS-0003", "c-6b-1", "CLS-41", "6ème B", "Sciences"), id: "ASSIGN-legacy-3" },
  ];
  const deduped = pedagogyGovernanceService.dedupeAssignmentsBySchoolClassSubject(rows);
  const summary = deduped.map((row) => `${row.classCode}|${row.course}|${row.teacherId}|${row.teacherCode}`).sort();
  assert.deepEqual(summary, [
    "CLS-35|Sciences|ENS-0003|ENS-0003",
    "CLS-36|Sciences|ENS-0022|ENS-0022",
    "CLS-41|Sciences|ENS-0003|ENS-0003",
    "CLS-41|Sciences|ENS-0008|ENS-0008",
  ]);
  for (const row of deduped) assert.equal(row.teacherId, row.teacherCode, `aucune ligne hybride (${row.id})`);
});

test("déduplication sans identité de classe : repli sur le nom, comme avant", () => {
  const rows = [
    { schoolCode: SCHOOL, className: "6ème A", course: "Math", teacherName: "X" },
    { schoolCode: SCHOOL, className: "6ème A", course: "Math", teacherName: "X", coefficient: 2 },
  ];
  assert.equal(pedagogyGovernanceService.dedupeAssignmentsBySchoolClassSubject(rows).length, 1);
});

test("session enseignant (état dédupliqué complet) : exactement ses affectations actives, rien de ses homonymes", () => {
  const teachers = [
    ME,
    teacherRecord("ENS-0012", "user-0012"),
    teacherRecord("ENS-0022", "user-0022"),
    { ...teacherRecord("ENS-0008", "user-0008"), firstName: "Chantal", lastName: "Kalala", name: "Chantal Kalala" },
  ];
  const assignments = [
    assignment("1", "ENS-0003", "c-5a", "CLS-40", "5ème A", "Sciences"),
    assignment("2", "ENS-0003", "c-6a-1", "CLS-35", "6ème A", "Sciences"),
    assignment("3", "ENS-0003", "c-6b-1", "CLS-41", "6ème B", "Sciences"),
    assignment("4", "ENS-0012", "c-5a", "CLS-40", "5ème A", "Mathématiques"),
    assignment("5", "ENS-0022", "c-6d", "CLS-23", "6ème D", "Sciences"),
    assignment("6", "ENS-0008", "c-6b-2", "CLS-42", "6ème B", "Sciences", "Chantal Kalala"),
    assignment("7", "ENS-0008", "c-6b-1", "CLS-41", "6ème B", "Sciences", "Chantal Kalala"),
  ];
  const { state } = dedupeBackOfficeState({ teachers, assignments });
  const session = enrichTeacherUserWithActiveAssignments(USER, state);
  assert.deepEqual([...session.assignedClassCodes].sort(), ["CLS-35", "CLS-40", "CLS-41"]);
  assert.deepEqual([...session.assignedClassIds].sort(), ["c-5a", "c-6a-1", "c-6b-1"]);
  assert.deepEqual(
    session.assignments.map((row) => row.teacherId),
    ["ENS-0003", "ENS-0003", "ENS-0003"],
  );
});
