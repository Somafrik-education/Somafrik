"use strict";

/**
 * Acceptation P0 AUTH/SCOPE TEACHER — JWT canonique (classId / classCode).
 *
 * L'embed historique `{ className, course }` n'est plus une autorité de scope.
 * GET /api/classes reste fail-closed #247 : jamais d'autorisation par className.
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

function mapTeacherEmbed(assignmentRows, teacherCode) {
  return assignmentRows
    .filter((row) => row.teacher_code === teacherCode)
    .map((row) => ({ className: row.class_name, course: row.subject_name }));
}

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

function productionLoginState(embedFirst = true) {
  const rows = pgAssignmentRows();
  const embed = mapTeacherEmbed(rows, TEACHER_CODE);
  const global = rows.map(mapAssignmentGlobal);
  return {
    teachers: [
      {
        id: TEACHER_CODE,
        publicId: TEACHER_CODE,
        userId: USER_ID,
        identifier: "ENS-0099",
        schoolCode: "CD-2026-0001",
        assignments: embedFirst ? embed : [],
      },
    ],
    assignments: global,
    embed,
    global,
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

function activeCanonical(assignments) {
  return filterActiveTeacherAssignments(assignments).filter(
    (row) => row.classId || row.classCode,
  );
}

function assertSekeLikePrincipal(fields) {
  assert.equal(fields.assignments.length, 2);
  assert.equal(fields.classIds.length, 2);
  assert.equal(fields.classCodes.length, 2);
  assert.deepEqual([...fields.classIds].sort(), [CLASS_A_ID, CLASS_B_ID].sort());
  assert.deepEqual([...fields.classCodes].sort(), ["CLS-2A", "CLS-2B"]);
  assert.ok(fields.assignments.every((row) => row.status === "active"));
  assert.ok(fields.assignments.every((row) => row.classId && row.classCode));
}

function testTeachersRepositoryKeepsCanonicalIds() {
  const mapped = mapActiveAssignments(pgAssignmentRows(), TEACHER_CODE);
  assert.equal(mapped.length, 2);
  assert.deepEqual(
    mapped.map((row) => row.classId).sort(),
    [CLASS_A_ID, CLASS_B_ID].sort(),
  );
}

function testResolveKeepsCanonicalWhenEmbedPresent() {
  const state = productionLoginState(true);
  const resolved = resolveTeacherAssignments(
    state.teachers[0],
    teacherUser(),
    state.assignments,
  );
  const canonical = activeCanonical(resolved);
  assert.equal(canonical.length, 2);
  assert.deepEqual(
    canonical.map((row) => row.classId).sort(),
    [CLASS_A_ID, CLASS_B_ID].sort(),
  );
  assert.ok(canonical.every((row) => row.status === "active"));
}

function testLoginAndRefreshMintTwoClasses() {
  const state = productionLoginState(true);
  const loginUser = enrichTeacherUserWithActiveAssignments(teacherUser(), state);
  assert.equal(loginUser.assignments.length, 2);
  assert.equal(loginUser.assignedClassIds.length, 2);
  assert.equal(loginUser.assignedClassCodes.length, 2);

  const refreshFields = teacherPrincipalAssignmentFields(teacherUser(), state);
  assertSekeLikePrincipal(refreshFields);

  const jwtAssignments = filterActiveTeacherAssignments(loginUser.assignments);
  assertSekeLikePrincipal({
    assignments: jwtAssignments,
    classIds: [...new Set(jwtAssignments.map((row) => row.classId))],
    classCodes: [...new Set(jwtAssignments.map((row) => row.classCode))],
  });

  const scoped = scopeSchoolClassesForPrincipal(
    { role: "Enseignant", assignments: jwtAssignments },
    schoolClassRows(),
  );
  assert.equal(scoped.length, 2);
}

function testEmbedBeforeAndAfterGlobal() {
  const embed = { className: "2ème A", course: "Mathématiques" };
  const canonical = {
    classId: CLASS_A_ID,
    classCode: "CLS-2A",
    className: "2ème A",
    course: "Mathématiques",
    status: "active",
  };
  const embedFirst = dedupeAssignments([embed, canonical]);
  const globalFirst = dedupeAssignments([canonical, embed]);
  for (const rows of [embedFirst, globalFirst]) {
    const active = activeCanonical(rows);
    assert.equal(active.length, 1);
    assert.equal(active[0].classId, CLASS_A_ID);
    assert.equal(active[0].classCode, "CLS-2A");
    assert.equal(active[0].status, "active");
  }
}

function testSameClassNameDistinctUuids() {
  const rows = dedupeAssignments([
    { classId: CLASS_A_ID, classCode: "CLS-2A", className: "2ème A", status: "active" },
    { classId: CLASS_B_ID, classCode: "CLS-2B", className: "2ème A", status: "active" },
  ]);
  assert.equal(activeCanonical(rows).length, 2);
}

function testEmptyClassNameAndCourseSurvive() {
  const kept = dedupeAssignments([
    { classId: CLASS_A_ID, classCode: "CLS-2A", className: "", course: "", status: "active" },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].classId, CLASS_A_ID);
  assert.equal(kept[0].status, "active");

  const enriched = enrichTeacherUserWithActiveAssignments(teacherUser(), {
    teachers: [
      {
        id: TEACHER_CODE,
        userId: USER_ID,
        identifier: "ENS-0099",
        assignments: [{ className: "2ème A", course: "Math" }],
      },
    ],
    assignments: [
      {
        teacherId: TEACHER_CODE,
        classId: CLASS_A_ID,
        classCode: "CLS-2A",
        className: "",
        course: "",
        status: "active",
        schoolCode: "CD-2026-0001",
      },
    ],
  });
  assert.equal(enriched.assignments.length, 1);
  assert.equal(enriched.assignments[0].classId, CLASS_A_ID);
}

function testInactiveIsFailClosed() {
  const enriched = enrichTeacherUserWithActiveAssignments(teacherUser(), {
    teachers: [{ id: TEACHER_CODE, userId: USER_ID, identifier: "ENS-0099", assignments: [] }],
    assignments: [
      {
        teacherId: TEACHER_CODE,
        classId: CLASS_A_ID,
        classCode: "CLS-2A",
        status: "inactive",
        schoolCode: "CD-2026-0001",
      },
      {
        teacherId: TEACHER_CODE,
        classId: CLASS_B_ID,
        classCode: "CLS-2B",
        status: "active",
        schoolCode: "CD-2026-0001",
      },
    ],
  });
  assert.equal(enriched.assignments.length, 1);
  assert.equal(enriched.assignments[0].classId, CLASS_B_ID);
}

function testClassCodeWithoutClassIdSurvives() {
  const kept = dedupeAssignments([
    { classCode: "CLS-2A", className: "2ème A", course: "Math", status: "active" },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].classCode, "CLS-2A");
  const scoped = scopeSchoolClassesForPrincipal(
    { role: "Enseignant", assignments: kept },
    schoolClassRows(),
  );
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].classCode, "CLS-2A");
}

function testDuplicateExactClassIdKeepsRicher() {
  const rows = dedupeAssignments([
    { classId: CLASS_A_ID, className: "2ème A", course: "Math" },
    {
      classId: CLASS_A_ID,
      classCode: "CLS-2A",
      className: "2ème A",
      course: "Math",
      status: "active",
    },
  ]);
  const canonical = activeCanonical(rows);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].classCode, "CLS-2A");
  assert.equal(canonical[0].status, "active");
}

function testNameOnlyIsNotClassAuthority() {
  const scoped = scopeSchoolClassesForPrincipal(
    {
      role: "Enseignant",
      assignments: [{ className: "2ème A", course: "Mathématiques", status: "active" }],
    },
    schoolClassRows(),
  );
  assert.equal(scoped.length, 0);
}

function main() {
  testTeachersRepositoryKeepsCanonicalIds();
  testResolveKeepsCanonicalWhenEmbedPresent();
  testLoginAndRefreshMintTwoClasses();
  testEmbedBeforeAndAfterGlobal();
  testSameClassNameDistinctUuids();
  testEmptyClassNameAndCourseSurvive();
  testInactiveIsFailClosed();
  testClassCodeWithoutClassIdSurvives();
  testDuplicateExactClassIdKeepsRicher();
  testNameOnlyIsNotClassAuthority();
  console.log("teacherLoginScope.diagnostic.test.js: OK");
}

main();
