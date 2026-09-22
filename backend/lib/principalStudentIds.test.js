"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { getPrincipalStudentIds } = require("./principalStudentIds");

const CODE_A = "CD-ITS-MR-26-00099";
const CODE_B = "CD-ITS-MR-26-00003";
const LOGIN_REAL = "6654 1324";
const MATRICULE_REAL = "CD-IN-61-26-00017";
const U1 = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222222";
const S17 = "18181818-1818-4818-8818-181818181818";
const U17 = "17171717-1717-4717-8717-171717171717";

describe("getPrincipalStudentIds — JWT fail-closed sur students.id", () => {
  it("élève lié login ≠ matricule : students.id + student_code, jamais users.id", () => {
    const ids = getPrincipalStudentIds({
      role: "student",
      user: {
        id: U1,
        identifier: CODE_A,
        publicId: CODE_A,
        matricule: CODE_B,
        linkedStudent: { studentId: S1, studentCode: CODE_B },
      },
    });
    assert.ok(ids.includes(S1));
    assert.ok(ids.includes(CODE_B));
    assert.ok(!ids.includes(U1));
    assert.ok(!ids.includes(CODE_A));
  });

  it("rôle STUDENT sans fiche liée → 0 id, pas users.id", () => {
    const ids = getPrincipalStudentIds({
      role: "student",
      user: { id: U1, identifier: CODE_A, linkedStudent: null },
    });
    assert.deepEqual(ids, []);
  });

  it("cas réel 6654 1324 / CD-IN-61-26-00017", () => {
    const ids = getPrincipalStudentIds({
      role: "student",
      user: {
        id: U17,
        identifier: LOGIN_REAL,
        matricule: MATRICULE_REAL,
        linkedStudent: { studentId: S17, studentCode: MATRICULE_REAL },
      },
    });
    assert.deepEqual(ids, [S17, MATRICULE_REAL]);
    assert.ok(!ids.includes(U17));
    assert.ok(!ids.includes(LOGIN_REAL));
  });

  it("server.js délègue au helper, plus [user.id] pour une session élève", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    assert.match(src, /getPrincipalStudentIds/);
    assert.match(src, /require\("\.\/lib\/principalStudentIds"\)/);
    assert.doesNotMatch(src, /if \(role === "Élève \/ Étudiant"\) \{\s*return \[user\.id\]/);
  });
});
