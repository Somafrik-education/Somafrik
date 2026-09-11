"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  PARENT_NOTES_ERROR,
  isParentPrincipalRole,
  linkedStudentIdSet,
  assertParentNotesStudentAccess,
  assertParentNotesReadOnly,
  requireParentNotesReadOnly,
  filterStudentsForGuardianNotes,
  filterNotesForGuardianStudents,
} = require("./parentNotesScope");
const {
  COURSE_READ_PERMISSIONS,
  COURSE_CREATE_PERMISSIONS,
  COURSE_UPDATE_PERMISSIONS,
  COURSE_DELETE_PERMISSIONS,
} = require("./coursesRbacPolicy");

const CHILD_A = {
  id: "stu-a",
  matricule: "CD-IN-EL-26-001",
  name: "Maeve Okito",
  className: "1ère A",
  schoolCode: "CD-2026-0001",
};
const CHILD_A2 = {
  id: "stu-a2",
  matricule: "CD-IN-EL-26-002",
  name: "Lina Okito",
  className: "3ème B",
  schoolCode: "CD-2026-0001",
};
const CHILD_B = {
  id: "stu-b",
  matricule: "CD-IN-EL-26-099",
  name: "Élève B",
  className: "1ère A",
  schoolCode: "CD-2026-0001",
};
const CLASSMATES = [CHILD_A, CHILD_B, { id: "stu-c", name: "Camarade", className: "1ère A" }];

const parentA = {
  role: "Parent",
  roleKeys: ["PARENT"],
  studentIds: ["stu-a", "CD-IN-EL-26-001"],
};

const parentTwo = {
  role: "Parent",
  roleKeys: ["PARENT"],
  studentIds: ["stu-a", "stu-a2", "CD-IN-EL-26-001", "CD-IN-EL-26-002"],
};

const teacher = {
  role: "Enseignant",
  roleKeys: ["TEACHER"],
  schoolCode: "CD-2026-0001",
};

function throwsForbidden(fn) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, PARENT_NOTES_ERROR.FORBIDDEN);
    return;
  }
  assert.fail("attendu 403 PARENT_CHILD_FORBIDDEN");
}

test("isParentPrincipalRole : rôle Parent et clé PARENT", () => {
  assert.equal(isParentPrincipalRole(parentA), true);
  assert.equal(isParentPrincipalRole({ role: "Parent" }), true);
  assert.equal(isParentPrincipalRole({ roleKeys: ["PARENT"] }), true);
  assert.equal(isParentPrincipalRole(teacher), false);
  assert.equal(isParentPrincipalRole({ role: "Admin School" }), false);
});

test("Parent A ne voit que l'enfant A dans la liste élèves", () => {
  const scoped = filterStudentsForGuardianNotes(CLASSMATES, parentA);
  assert.deepEqual(
    scoped.map((row) => row.id),
    ["stu-a"],
  );
});

test("Parent avec deux enfants ne voit que A1 et A2", () => {
  const scoped = filterStudentsForGuardianNotes([CHILD_A, CHILD_A2, CHILD_B], parentTwo);
  assert.deepEqual(
    scoped.map((row) => row.id),
    ["stu-a", "stu-a2"],
  );
});

test("Parent A ne voit aucun élève de la classe hors enfants liés", () => {
  const scoped = filterStudentsForGuardianNotes(CLASSMATES, parentA);
  assert.equal(scoped.some((row) => row.id === "stu-b"), false);
  assert.equal(scoped.some((row) => row.id === "stu-c"), false);
});

test("Parent A demande studentId enfant B → 403", () => {
  throwsForbidden(() => assertParentNotesStudentAccess(parentA, "stu-b", CLASSMATES));
  throwsForbidden(() => assertParentNotesStudentAccess(parentA, CHILD_B.matricule, CLASSMATES));
});

test("Parent A demande un studentId inconnu → 403 (pas 200 vide)", () => {
  throwsForbidden(() => assertParentNotesStudentAccess(parentA, "stu-inconnu", CLASSMATES));
});

test("Parent A accède à son enfant A (id ou matricule)", () => {
  assert.doesNotThrow(() => assertParentNotesStudentAccess(parentA, "stu-a", CLASSMATES));
  assert.doesNotThrow(() => assertParentNotesStudentAccess(parentA, "CD-IN-EL-26-001", CLASSMATES));
});

test("Teacher/Admin : assertParentNotesStudentAccess ne bloque pas", () => {
  assert.doesNotThrow(() => assertParentNotesStudentAccess(teacher, "stu-b", CLASSMATES));
  assert.doesNotThrow(() =>
    assertParentNotesStudentAccess({ role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] }, "stu-b", CLASSMATES),
  );
});

test("Parent lecture seule : mutation → 403 PARENT_NOTES_READ_ONLY", () => {
  try {
    assertParentNotesReadOnly(parentA);
  } catch (error) {
    assert.equal(error.statusCode, 403);
    assert.equal(error.code, PARENT_NOTES_ERROR.READ_ONLY);
    return;
  }
  assert.fail("attendu 403 READ_ONLY");
});

test("Teacher/Admin : assertParentNotesReadOnly no-op", () => {
  assert.doesNotThrow(() => assertParentNotesReadOnly(teacher));
  assert.doesNotThrow(() => assertParentNotesReadOnly({ role: "Admin School" }));
});

test("requireParentNotesReadOnly : Parent → 403 PARENT_NOTES_READ_ONLY sans next vide", () => {
  let captured;
  requireParentNotesReadOnly({ principal: parentA }, {}, (error) => {
    captured = error;
  });
  assert.equal(captured?.statusCode, 403);
  assert.equal(captured?.code, PARENT_NOTES_ERROR.READ_ONLY);
});

test("requireParentNotesReadOnly : Teacher → next() sans erreur", () => {
  let errorArg = "unset";
  requireParentNotesReadOnly({ principal: teacher }, {}, (error) => {
    errorArg = error;
  });
  assert.equal(errorArg, undefined);
});

test("Notes filtrées : Parent A ne reçoit pas les notes de B", () => {
  const notes = [
    { id: "n-a", studentId: "stu-a", value: 16 },
    { id: "n-b", studentId: "stu-b", value: 4 },
  ];
  const scopedStudents = filterStudentsForGuardianNotes(CLASSMATES, parentA);
  const scopedNotes = filterNotesForGuardianStudents(notes, scopedStudents);
  assert.deepEqual(
    scopedNotes.map((row) => row.id),
    ["n-a"],
  );
});

test("linkedStudentIdSet lit studentIds et children", () => {
  const ids = linkedStudentIdSet({
    role: "Parent",
    studentIds: ["stu-a"],
    children: [{ id: "stu-a2", matricule: "M-2" }],
  });
  assert.equal(ids.has("stu-a"), true);
  assert.equal(ids.has("stu-a2"), true);
  assert.equal(ids.has("M-2"), true);
});

test("Notes:READ ouvre seulement GET /api/courses pour le calcul de moyenne", () => {
  assert.equal(COURSE_READ_PERMISSIONS.includes("Notes:READ"), true);
  assert.equal(COURSE_CREATE_PERMISSIONS.includes("Notes:READ"), false);
  assert.equal(COURSE_UPDATE_PERMISSIONS.includes("Notes:READ"), false);
  assert.equal(COURSE_DELETE_PERMISSIONS.includes("Notes:READ"), false);
});

test("contrat source : GET notes élève et POST notes branchent le garde Parent", () => {
  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert.match(server, /assertParentNotesStudentAccess/);
  assert.match(server, /filterStudentsForGuardianNotes/);
  assert.match(server, /assertParentNotesReadOnly/);
  const studentNotes = server.slice(
    server.indexOf('app.get("/api/students/:id/notes"'),
    server.indexOf('app.get("/api/notes"'),
  );
  assert.match(studentNotes, /assertParentNotesStudentAccess\(req\.principal, req\.params\.id/);
  const listNotes = server.slice(
    server.indexOf('app.get("/api/notes"'),
    server.indexOf('app.get("/api/presences"'),
  );
  assert.match(listNotes, /req\.query\.studentId/);
  assert.match(listNotes, /assertParentNotesStudentAccess/);
  const postNotes = server.slice(
    server.indexOf('app.post("/api/notes"'),
    server.indexOf('app.post("/api/presences"'),
  );
  const authIdx = postNotes.indexOf("requireAuth");
  const parentIdx = postNotes.indexOf("requireParentNotesReadOnly");
  const subIdx = postNotes.indexOf('requireSchoolSubscriptionFeature("write_notes")');
  const rbacIdx = postNotes.indexOf('requirePermission("POST /api/notes")');
  assert.ok(parentIdx >= 0, "middleware requireParentNotesReadOnly sur POST /api/notes");
  assert.ok(
    authIdx >= 0 && parentIdx > authIdx && parentIdx < subIdx && parentIdx < rbacIdx,
    "Parent READ ONLY après requireAuth et avant write_notes / RBAC écriture",
  );
  assert.match(postNotes, /assertParentNotesReadOnly\(req\.principal\)/);
});
