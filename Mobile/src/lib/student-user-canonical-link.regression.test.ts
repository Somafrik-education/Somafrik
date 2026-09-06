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
import {
  filterRowsByStudentScope,
  findStudentByIdentity,
  resolveMobileStudentScope,
  resolveSessionStudentId,
  sessionStudentAliasKeys,
} from "./canonicalStudentIdentity";
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
    assert.match(detailSrc, /findStudentByIdentity/);
    assert.doesNotMatch(detailSrc, /item\.studentId === student\.studentCode/);
    assert.doesNotMatch(detailSrc, /item\.studentId === session\.user\.id/);

    const notesSrc = source("src/screens/StudentNotesScreen.tsx");
    assert.match(notesSrc, /notesForStudent\(notesSnapshot\.data, studentAliasKeys\)/);

    const presencesSrc = source("src/screens/StudentPresencesScreen.tsx");
    assert.match(presencesSrc, /studentAliasKeys/);

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

describe("M7 — paiements fail-closed sans fiche students", () => {
  const otherStudentId = "33333333-3333-4333-8333-333333333333";
  const paymentsData = [
    { studentId: S1, amount: 50_000 },
    { studentId: otherStudentId, amount: 80_000 },
    { studentId: U1, amount: 12_000 },
  ];

  it("role student + selectedStudentId null → 0 paiement, même si le dataset est chargé", () => {
    const scope = resolveMobileStudentScope({
      role: "student",
      selectedStudentId: null,
      children: [{ id: S1 }],
    });
    assert.equal(scope.unscoped, false);
    assert.deepEqual(scope.studentIds, []);
    const scoped = filterRowsByStudentScope(paymentsData, scope);
    assert.equal(scoped.length, 0);
    assert.deepEqual(scoped, []);
  });

  it("élève lié ne voit que ses paiements students.id", () => {
    const scope = resolveMobileStudentScope({
      role: "student",
      selectedStudentId: S1,
      children: [],
    });
    const scoped = filterRowsByStudentScope(paymentsData, scope);
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0]?.studentId, S1);
    assert.ok(scoped.every((row) => row.studentId === S1));
  });

  it("parent sans enfants → 0 paiement ; staff unscoped conserve le dataset", () => {
    const parentEmpty = resolveMobileStudentScope({
      role: "parent_student",
      selectedStudentId: null,
      children: [],
    });
    assert.equal(filterRowsByStudentScope(paymentsData, parentEmpty).length, 0);

    const staff = resolveMobileStudentScope({
      role: "school_admin",
      selectedStudentId: null,
      children: [],
    });
    assert.equal(staff.unscoped, true);
    assert.equal(filterRowsByStudentScope(paymentsData, staff).length, paymentsData.length);
  });

  it("source: écran paiements fail-closed, jamais : true si studentIds est vide", () => {
    const mvpSrc = source("src/screens/MvpUtilityScreens.tsx");
    assert.match(mvpSrc, /resolveMobileStudentScope/);
    assert.match(mvpSrc, /filterRowsByStudentScope/);
    assert.doesNotMatch(
      mvpSrc,
      /studentIds\.length \? studentIds\.includes\(payment\.studentId\) : true/,
    );
    assert.doesNotMatch(mvpSrc, /studentIds\.length \|\| studentsData\.length/);
    assert.doesNotMatch(mvpSrc, /selectedStudentId \?\? session\.user\.id/);

    const reportSrc = source("src/screens/ReportCardsScreen.tsx");
    assert.match(reportSrc, /filterRowsByStudentScope/);
    assert.doesNotMatch(
      reportSrc,
      /visibleStudentIds\.length \? visibleStudentIds\.includes\(card\.studentId\) : true/,
    );
  });
});

describe("M8 — DTO online student_code vs selectedStudentId UUID", () => {
  const onlineStudents = [
    { id: CODE_B, studentCode: CODE_B, matricule: CODE_B, publicId: CODE_B, name: "Marc" },
    { id: "other-code", studentCode: "other-code", matricule: "other-code", name: "Autre" },
  ];
  const onlineNotes = [
    { studentId: CODE_B, evaluationId: "e1", value: 12 },
    { studentId: U1, evaluationId: "e1", value: 20 },
    { studentId: "other-code", evaluationId: "e1", value: 8 },
  ];
  const onlinePayments = [
    { studentId: CODE_B, amount: 50_000 },
    { studentId: U1, amount: 12_000 },
    { studentId: "other-code", amount: 80_000 },
  ];

  it("login ≠ matricule : notes/paiements student_code matchent l'UUID de session, jamais users.id", () => {
    const keys = sessionStudentAliasKeys({
      role: "student",
      selectedStudentId: S1,
      user: {
        id: U1,
        identifier: CODE_A,
        matricule: CODE_B,
        linkedStudent: { studentId: S1, studentCode: CODE_B },
      },
    });
    assert.ok(keys.includes(S1));
    assert.ok(keys.includes(CODE_B));
    assert.ok(!keys.includes(U1));
    assert.ok(!keys.includes(CODE_A));

    const student = findStudentByIdentity(onlineStudents, keys);
    assert.equal(student?.id, CODE_B);

    const notes = notesForStudent(onlineNotes as never, keys);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.studentId, CODE_B);

    const scope = resolveMobileStudentScope({
      role: "student",
      selectedStudentId: S1,
      user: {
        id: U1,
        linkedStudent: { studentId: S1, studentCode: CODE_B },
        matricule: CODE_B,
      },
    });
    const payments = filterRowsByStudentScope(onlinePayments, scope);
    assert.equal(payments.length, 1);
    assert.equal(payments[0]?.studentId, CODE_B);
    assert.ok(!payments.some((row) => row.studentId === U1));
  });

  it("écrans détail/notes/présences/accueil/paiements utilisent les alias d'identité", () => {
    const homeSrc = source("src/screens/HomeScreen.tsx");
    assert.match(homeSrc, /sessionStudentAliasKeys/);
    assert.match(homeSrc, /findStudentByIdentity/);
    assert.doesNotMatch(homeSrc, /presence\.studentId === selectedStudentId/);
    assert.doesNotMatch(homeSrc, /payment\.studentId === selectedStudentId/);

    const detailSrc = source("src/screens/StudentDetailScreen.tsx");
    assert.match(detailSrc, /findStudentByIdentity/);
    assert.doesNotMatch(detailSrc, /item\.studentId === student\.id/);

    const notesSrc = source("src/screens/StudentNotesScreen.tsx");
    assert.match(notesSrc, /sessionStudentAliasKeys/);
    assert.match(notesSrc, /notesForStudent\(notesSnapshot\.data, studentAliasKeys\)/);

    const presencesSrc = source("src/screens/StudentPresencesScreen.tsx");
    assert.match(presencesSrc, /studentAliasKeys/);

    const paymentsSrc = source("src/screens/StudentPaymentsScreen.tsx");
    assert.match(paymentsSrc, /studentAliasKeys/);
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
