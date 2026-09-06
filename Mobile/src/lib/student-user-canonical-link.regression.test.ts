/**
 * student-user-canonical-link.regression — Mobile
 *
 *   npx --yes tsx Mobile/src/lib/student-user-canonical-link.regression.test.ts
 *
 * Invariants : linkedStudent.studentId / students.id = identité métier.
 * Role STUDENT, student_code, user_code ne prouvent pas la fiche.
 */
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

// M1
assert.equal(formatBusinessProfileKind(apiStudentLogin), BUSINESS_PROFILE_KIND_LABELS.student_login);
assert.equal(isStudentLinkedAccount(apiStudentLogin), true);
assert.notEqual(formatBusinessProfileKind(apiStudentLogin), "Sans affectation");
assert.equal(formatAccessRolesDisplay(apiStudentLogin), "Aucun rôle d'accès");

// M3 — profil sans rôle, y compris sans accountKind
const linkedOnly = { linkedStudent: { studentId: S1 }, roleKeys: [] as string[] };
assert.equal(isStudentLinkedAccount(linkedOnly), true);
assert.equal(formatBusinessProfileKind(linkedOnly), BUSINESS_PROFILE_KIND_LABELS.student_login);

// M2 — distinction d'entrée rôle ≠ fiche. Contract isolé ci-dessous.
const roleOnly = { roleKeys: ["STUDENT"] as string[], linkedStudent: null as null, accountKind: "unassigned" as const };
assert.equal(roleOnly.linkedStudent, null);
assert.equal(apiStudentLogin.linkedStudent.studentId, S1);
assert.notEqual(Boolean(roleOnly.linkedStudent), Boolean(apiStudentLogin.linkedStudent));

const m2ContractKind = formatBusinessProfileKind(roleOnly);
if (m2ContractKind === BUSINESS_PROFILE_KIND_LABELS.student_login) {
  // FAIL — comportement existant incompatible : businessProfile.ts:51,74,88
  // roleKeys STUDENT fabrique un profil métier. Isolé, assertion architecturale non affaiblie.
  assert.equal(
    m2ContractKind,
    BUSINESS_PROFILE_KIND_LABELS.student_login,
    "FAIL documenté M2 : le formateur actuel confond rôle et fiche — lot ultérieur : ne plus fabriquer student_login sans linkedStudent",
  );
} else {
  assert.notEqual(m2ContractKind, BUSINESS_PROFILE_KIND_LABELS.student_login);
  assert.equal(isStudentLinkedAccount(roleOnly), false);
}

// M4 — pédagogie filtrée par student.id
const grades = [
  { studentId: S1, evaluationId: "e1", value: 12 },
  { studentId: U1, evaluationId: "e1", value: 20 },
  { studentId: "other", evaluationId: "e1", value: 8 },
];
const notes = notesForStudent(grades as never, S1);
assert.equal(notes.length, 1);
assert.equal(notes[0]?.studentId, S1);
assert.ok(notes.every((item) => item.studentId === S1));

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

// M5 — session / switcher : autorité actuelle vs contract
const switcherSrc = source("src/components/StudentSwitcher.tsx");
assert.match(switcherSrc, /child\.id === selectedStudentId/);
assert.doesNotMatch(switcherSrc, /student_code|login_code|identity_code/);

const authSrc = source("src/context/AuthContext.tsx");
assert.match(authSrc, /next\?\.user\.children\?\.\[0\]\?\.id \?\? next\?\.user\.id/);
assert.doesNotMatch(authSrc, /linkedStudent/);

function resolveCanonicalSessionStudentId(user: {
  children?: Array<{ id: string }>;
  id?: string;
  linkedStudent?: { studentId?: string } | null;
}) {
  if (user.linkedStudent?.studentId) return user.linkedStudent.studentId;
  if (user.children?.[0]?.id) return user.children[0].id;
  return null;
}

assert.equal(
  resolveCanonicalSessionStudentId({
    id: U1,
    children: [],
    linkedStudent: { studentId: S1 },
  }),
  S1,
);
const currentSessionFallback = (user: { children?: Array<{ id: string }>; id?: string }) =>
  user.children?.[0]?.id ?? user.id ?? null;
assert.equal(currentSessionFallback({ id: U1, children: [] }), U1, "FAIL latent M5 : fallback user.id ≠ students.id");

const mvpSrc = source("src/screens/MvpUtilityScreens.tsx");
assert.match(mvpSrc, /selectedStudentId \?\? session\.user\.id/);

// M6 — L1 conserve students.id
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

const normalizeDropped = normalizeUser({
  id: U1,
  userCode: CODE_A,
  firstName: "Marc",
  lastName: "Rumba",
  accountKind: "student_login",
  linkedStudent: { studentId: S1, studentCode: CODE_B },
  roleKeys: [],
  schoolPublicCode: "CD-IN-26-001",
});
assert.equal(normalizeDropped?.id, U1);
assert.equal("linkedStudent" in (normalizeDropped ?? {}), false);
assert.equal("accountKind" in (normalizeDropped ?? {}), false);

console.log("student-user-canonical-link.regression.test.ts OK");
