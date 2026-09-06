/**
 * student-user-canonical-link.regression — Mobile
 *
 *   npx --yes tsx --test Mobile/src/lib/student-user-canonical-link.regression.test.ts
 *
 * Invariants : linkedStudent.studentId / students.id = identité métier.
 * Role STUDENT, student_code, user_code ne prouvent pas la fiche.
 *
 * Role STUDENT, student_code, user_code ne prouvent pas la fiche.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BUSINESS_PROFILE_KIND_LABELS,
  formatAccessRolesDisplay,
  formatBusinessProfileKind,
  isStudentLinkedAccount,
} from "./businessProfile";
import { notesForStudent } from "./evaluationsV2";
import { normalizeUser } from "./canonicalResourceNormalize";
import { resolveSessionStudentId } from "./canonicalStudentIdentity";
import { projectL1Student } from "../offline/l1/uiProjection";
import type { L1Partition } from "../offline/l1/types";

const CODE_A = "CD-ITS-MR-26-00099";
const CODE_B = "CD-ITS-MR-26-00003";
const S1 = "22222222-2222-4222-8222-222222222222";
const U1 = "11111111-1111-4111-8111-111111111111";
const ROOT = path.resolve(__dirname, "../..");

function source(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const apiStudentLogin = {
  accountKind: "student_login" as const,
  linkedStudent: { studentId: S1, studentCode: CODE_B },
  roleKeys: [] as string[],
  role: "",
  roles: [] as string[],
  assignmentStatus: "",
};

const roleOnly = {
  roleKeys: ["STUDENT"] as string[],
  linkedStudent: null as null,
  accountKind: "unassigned" as const,
};

describe("M1 — accountKind student_login + linkedStudent + roleKeys=[]", () => {
  it("affiche le profil métier élève, jamais Sans affectation", () => {
    assert.equal(formatBusinessProfileKind(apiStudentLogin), BUSINESS_PROFILE_KIND_LABELS.student_login);
    assert.equal(isStudentLinkedAccount(apiStudentLogin), true);
    assert.notEqual(formatBusinessProfileKind(apiStudentLogin), "Sans affectation");
    assert.equal(formatAccessRolesDisplay(apiStudentLogin), "Aucun rôle d'accès");
  });
});

describe("M3 — profil sans rôle, y compris sans accountKind", () => {
  it("linkedStudent seul suffit au profil métier", () => {
    const linkedOnly = { linkedStudent: { studentId: S1 }, roleKeys: [] as string[] };
    assert.equal(isStudentLinkedAccount(linkedOnly), true);
    assert.equal(formatBusinessProfileKind(linkedOnly), BUSINESS_PROFILE_KIND_LABELS.student_login);
  });
});

describe("M2 — rôle STUDENT sans fiche students", () => {
  it("explicite la distinction d'entrée : rôle ≠ linkedStudent", () => {
    assert.equal(roleOnly.linkedStudent, null);
    assert.equal(roleOnly.accountKind, "unassigned");
    assert.equal(apiStudentLogin.linkedStudent.studentId, S1);
    assert.notEqual(Boolean(roleOnly.linkedStudent), Boolean(apiStudentLogin.linkedStudent));
    assert.notEqual(roleOnly.accountKind, apiStudentLogin.accountKind);
    assert.deepEqual(roleOnly.roleKeys, ["STUDENT"]);
  });

  it("M2 contract : roleKeys STUDENT + linkedStudent null + accountKind unassigned ≠ student_login", () => {
      assert.notEqual(
        formatBusinessProfileKind(roleOnly),
        BUSINESS_PROFILE_KIND_LABELS.student_login,
      );
      assert.equal(isStudentLinkedAccount(roleOnly), false);
    });
});

describe("M4 — pédagogie filtrée par student.id", () => {
  it("notesForStudent ne mélange pas users.id ni un autre élève", () => {
    const grades = [
      { studentId: S1, evaluationId: "e1", value: 12 },
      { studentId: U1, evaluationId: "e1", value: 20 },
      { studentId: "other", evaluationId: "e1", value: 8 },
    ];
    const notes = notesForStudent(grades as never, S1);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.studentId, S1);
    assert.ok(notes.every((item) => item.studentId === S1));
  });

  it("écrans détail/notes/présences/paiements filtrent par studentId (complément source)", () => {
    const detailSrc = source("src/screens/StudentDetailScreen.tsx");
    assert.match(detailSrc, /item\.studentId === student\.id/);
    assert.match(detailSrc, /const student = studentId \? studentsData\.find\(\(item\) => item\.id === studentId\)/);
    assert.doesNotMatch(detailSrc, /item\.studentId === student\.studentCode/);
    assert.doesNotMatch(detailSrc, /item\.studentId === session\.user\.id/);

    const notesSrc = source("src/screens/StudentNotesScreen.tsx");
    assert.match(notesSrc, /notesForStudent\(notesSnapshot\.data, studentId\)/);

    const presencesSrc = source("src/screens/StudentPresencesScreen.tsx");
    assert.match(presencesSrc, /studentId/);

    const paymentsSrc = source("src/screens/StudentPaymentsScreen.tsx");
    assert.match(paymentsSrc, /studentId/);
  });
});

describe("M5 — session / switcher", () => {
  it("StudentSwitcher compare child.id (complément source)", () => {
    const switcherSrc = source("src/components/StudentSwitcher.tsx");
    assert.match(switcherSrc, /child\.id === selectedStudentId/);
    assert.doesNotMatch(switcherSrc, /student_code|login_code|identity_code/);
  });

  it("session utilise linkedStudent.studentId, jamais users.id comme clé métier", () => {
    const authSrc = source("src/context/AuthContext.tsx");
    assert.match(authSrc, /resolveSessionStudentId/);
    const identitySrc = source("src/lib/canonicalStudentIdentity.ts");
    assert.match(identitySrc, /linkedStudent/);

    assert.equal(
      resolveSessionStudentId({
        id: U1,
        children: [],
        linkedStudent: { studentId: S1 },
      }),
      S1,
    );
    assert.equal(resolveSessionStudentId({ id: U1, children: [] }), null);
    assert.equal(
      resolveSessionStudentId({
        id: U1,
        children: [{ id: S1 }],
      }),
      S1,
    );

    const mvpSrc = source("src/screens/MvpUtilityScreens.tsx");
    assert.match(mvpSrc, /selectedStudentId/);
    assert.doesNotMatch(mvpSrc, /selectedStudentId \?\? session\.user\.id/);
    assert.doesNotMatch(mvpSrc, /session\?\.role === "student"\s*\n\s*\? \[session\.user\.id\]/);
  });
});

describe("M6 — L1 conserve students.id", () => {
  it("projectL1Student expose l'UUID métier, pas le code ni users.id", () => {
    const partition: L1Partition = { userId: U1, schoolId: "school-a", schoolCode: "SCH-A" };
    const projected = projectL1Student(
      {
        id: S1,
        student_code: CODE_B,
        first_name: "Marc",
        last_name: "Rumba",
        class_id: "class-1",
        class_code: "CLS-A",
        academic_year_id: "ay-1",
        status: "active",
      },
      partition,
      { byId: new Map(), byCode: new Map() },
    );
    assert.equal(projected.id, S1);
    assert.equal(projected.studentCode, CODE_B);
    assert.equal(projected.matricule, CODE_B);
    assert.notEqual(projected.id, U1);
    assert.notEqual(projected.id, CODE_A);
    assert.notEqual(projected.id, CODE_B);
  });

  it("normalizeUser conserve accountKind et linkedStudent", () => {
    const normalized = normalizeUser({
      id: U1,
      userCode: CODE_A,
      firstName: "Marc",
      lastName: "Rumba",
      accountKind: "student_login",
      linkedStudent: { studentId: S1, studentCode: CODE_B },
      roleKeys: [],
      schoolPublicCode: "CD-IN-26-001",
    });
    assert.equal(normalized?.id, U1);
    assert.equal(normalized?.linkedStudent?.studentId, S1);
    assert.equal(normalized?.linkedStudent?.studentCode, CODE_B);
    assert.equal(normalized?.accountKind, "student_login");
    assert.notEqual(normalized?.id, S1);
    assert.notEqual(normalized?.linkedStudent?.studentId, CODE_A);
  });

  it("cas réel 6654 1324 / CD-IN-61-26-00017 : studentId survit à normalizeUser", () => {
    const normalized = normalizeUser({
      id: "17171717-1717-4717-8717-171717171717",
      identifier: "6654 1324",
      userCode: "6654 1324",
      firstName: "Marc",
      lastName: "Rumba",
      accountKind: "student_login",
      linkedStudent: {
        studentId: "18181818-1818-4818-8818-181818181818",
        studentCode: "CD-IN-61-26-00017",
      },
      roleKeys: ["STUDENT"],
    });
    assert.equal(normalized?.id, "17171717-1717-4717-8717-171717171717");
    assert.equal(normalized?.linkedStudent?.studentId, "18181818-1818-4818-8818-181818181818");
    assert.equal(normalized?.linkedStudent?.studentCode, "CD-IN-61-26-00017");
    assert.equal(resolveSessionStudentId(normalized), "18181818-1818-4818-8818-181818181818");
    assert.notEqual(normalized?.identifier, normalized?.linkedStudent?.studentCode);
  });
});
