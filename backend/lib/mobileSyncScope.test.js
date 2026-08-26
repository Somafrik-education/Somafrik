"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeClassesScopeHash, resolveClassesSyncScope } = require("./mobileSyncScope");

function adminPrincipal(overrides = {}) {
  return {
    sub: "admin-1",
    role: "Admin School",
    schoolCode: "SCH-A",
    permissions: ["Voir classes", "Gérer classes"],
    ...overrides,
  };
}

function teacherPrincipal(assignments, overrides = {}) {
  return {
    sub: "teacher-1",
    role: "Enseignant",
    schoolCode: "SCH-A",
    permissions: ["Voir classes"],
    assignments,
    ...overrides,
  };
}

test("scopeHash déterministe à entrée identique", () => {
  const a = computeClassesScopeHash(adminPrincipal(), { schoolCode: "SCH-A", schoolId: "id-a" });
  const b = computeClassesScopeHash(adminPrincipal(), { schoolCode: "SCH-A", schoolId: "id-a" });
  assert.equal(a.scopeHash, b.scopeHash);
  assert.match(a.scopeHash, /^[a-f0-9]{64}$/);
});

test("Admin School = school-wide (pas la liste des class IDs)", () => {
  const scope = resolveClassesSyncScope(adminPrincipal());
  assert.equal(scope.scopeKind, "school-wide");
  assert.deepEqual(scope.classIds, []);
});

test("nouvelle classe n'invalide pas le scopeHash school-wide", () => {
  const before = computeClassesScopeHash(adminPrincipal(), { schoolCode: "SCH-A", schoolId: "id-a" });
  const after = computeClassesScopeHash(adminPrincipal(), { schoolCode: "SCH-A", schoolId: "id-a" });
  assert.equal(before.scopeHash, after.scopeHash);
});

test("Teacher : uniquement les classes d'affectations actives", () => {
  const scope = resolveClassesSyncScope(
    teacherPrincipal([
      { classId: "class-a", classCode: "CLS-A", status: "active" },
      { classId: "class-b", classCode: "CLS-B", status: "inactive" },
    ]),
  );
  assert.equal(scope.scopeKind, "assigned");
  assert.deepEqual(scope.classIds, ["class-a"]);
  assert.deepEqual(scope.classCodes, ["CLS-A"]);
});

test("grant d'une classe change le scopeHash enseignant", () => {
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const before = computeClassesScopeHash(
    teacherPrincipal([{ classId: "class-a", classCode: "CLS-A", status: "active" }]),
    school,
  );
  const after = computeClassesScopeHash(
    teacherPrincipal([
      { classId: "class-a", classCode: "CLS-A", status: "active" },
      { classId: "class-b", classCode: "CLS-B", status: "active" },
    ]),
    school,
  );
  assert.notEqual(before.scopeHash, after.scopeHash);
});

test("revoke d'une classe change le scopeHash enseignant", () => {
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const before = computeClassesScopeHash(
    teacherPrincipal([
      { classId: "class-a", classCode: "CLS-A", status: "active" },
      { classId: "class-b", classCode: "CLS-B", status: "active" },
    ]),
    school,
  );
  const after = computeClassesScopeHash(
    teacherPrincipal([{ classId: "class-a", classCode: "CLS-A", status: "active" }]),
    school,
  );
  assert.notEqual(before.scopeHash, after.scopeHash);
});

test("tenant différent → scopeHash différent", () => {
  const principal = adminPrincipal();
  const a = computeClassesScopeHash(principal, { schoolCode: "SCH-A", schoolId: "id-a" });
  const b = computeClassesScopeHash(principal, { schoolCode: "SCH-B", schoolId: "id-b" });
  assert.notEqual(a.scopeHash, b.scopeHash);
});

test("principal différent → scopeHash différent", () => {
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const a = computeClassesScopeHash(adminPrincipal({ sub: "admin-1" }), school);
  const b = computeClassesScopeHash(adminPrincipal({ sub: "admin-2" }), school);
  assert.notEqual(a.scopeHash, b.scopeHash);
});

test("Préfet = school-wide comme GET /api/classes", () => {
  const scope = resolveClassesSyncScope({
    role: "Préfet des études",
    permissions: ["Voir classes"],
    assignments: [{ classId: "class-a", classCode: "CLS-A", status: "active" }],
  });
  assert.equal(scope.scopeKind, "school-wide");
});

test("ordre des classIds n'affecte pas le hash", () => {
  const school = { schoolCode: "SCH-A", schoolId: "id-a" };
  const a = computeClassesScopeHash(
    teacherPrincipal([
      { classId: "class-b", classCode: "CLS-B", status: "active" },
      { classId: "class-a", classCode: "CLS-A", status: "active" },
    ]),
    school,
  );
  const b = computeClassesScopeHash(
    teacherPrincipal([
      { classId: "class-a", classCode: "CLS-A", status: "active" },
      { classId: "class-b", classCode: "CLS-B", status: "active" },
    ]),
    school,
  );
  assert.equal(a.scopeHash, b.scopeHash);
});
