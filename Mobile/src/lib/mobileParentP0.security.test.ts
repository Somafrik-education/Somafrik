/**
 * Gate P0 Parent Mobile — contrats de sécurité #740.
 *
 *   npm --prefix Mobile run test:mobile-parent-p0
 *
 * Ne pas affaiblir ces assertions. Les P1/P2 restent dans
 * test:mobile-parent-profile-audit.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canReadFeeGrids,
  canReadRoute,
  enrichSessionPermissions,
} from "../domain/security/permissions";
import {
  filterRowsByStudentScope,
  isLinkedParentStudent,
  resolveMobileStudentScope,
  resolveParentSafeStudentId,
  sessionStudentAliasKeys,
} from "./canonicalStudentIdentity";
import { getInternalRoleDefaults } from "./internalRoleDefaults";
import {
  ERROR_MESSAGES,
  LOGIN_SCREEN_COPY,
  mapKeyboardToInputMode,
  mapLoginApiError,
  resolveLoginEmptyFieldsError,
  resolveSecretFieldCopy,
  resolveSecretKeyboardType,
} from "./loginScreenSpec";
import { validateAccountSecret } from "./userAccountRules";
import { buildMobileLoginPayload } from "./platformLogin";
import {
  constrainParentPushNavigation,
  resolvePushNavigationData,
} from "./pushNotificationDestinations";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const CHILD_A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CHILD_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const CHILD_B1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const PARENT_A = "parent-a-user";
const SCHOOL_A = "CD-IN-26-001";
const SCHOOL_B = "CD-KN-26-009";

const PARENT_DEFAULT_PERMISSIONS = getInternalRoleDefaults("Parent");

function parentSession(overrides: Record<string, unknown> = {}) {
  return enrichSessionPermissions({
    role: "parent_student",
    roleKeys: ["PARENT"],
    permissions: PARENT_DEFAULT_PERMISSIONS,
    user: {
      id: PARENT_A,
      name: "Parent A",
      firstName: "Aline",
      lastName: "Kabila",
      phone: "+243820000001",
      schoolCode: SCHOOL_A,
      role: "Parent",
      roleKeys: ["PARENT"],
      permissions: PARENT_DEFAULT_PERMISSIONS,
      children: [
        { id: CHILD_A1, name: "Enfant A1", className: "6ème A", schoolCode: SCHOOL_A },
        { id: CHILD_A2, name: "Enfant A2", className: "5ème B", schoolCode: SCHOOL_A },
      ],
    },
    school: { code: SCHOOL_A, name: "École A" },
    ...overrides,
  });
}

const parentUser = {
  id: PARENT_A,
  children: [{ id: CHILD_A1 }, { id: CHILD_A2 }],
};

const STAFF_ROUTES = [
  "TeacherGrades",
  "TeacherAttendance",
  "ClassGradesStats",
  "Payments",
  "FeeGrids",
  "Students",
  "Schooling",
  "Users",
  "Teachers",
  "SchoolManagement",
  "Unpaid",
  "Configuration",
  "EstablishmentProfile",
  "Synchronization",
] as const;

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "PARENT-P0-01",
    title: "Parent A ne peut pas sélectionner B1",
    run() {
      const keys = sessionStudentAliasKeys({
        role: "parent_student",
        selectedStudentId: CHILD_B1,
        user: parentUser,
      });
      assert.equal(keys.includes(CHILD_B1), false);
      assert.equal(isLinkedParentStudent({ user: parentUser, selectedStudentId: CHILD_B1 }), false);
      assert.equal(
        resolveParentSafeStudentId({
          role: "parent_student",
          routeStudentId: null,
          selectedStudentId: CHILD_B1,
          user: parentUser,
        }),
        null,
      );
    },
  },
  {
    id: "PARENT-P0-02",
    title: "Parent école A ne peut pas utiliser un élève école B",
    run() {
      const keys = sessionStudentAliasKeys({
        role: "parent_student",
        selectedStudentId: CHILD_B1,
        user: {
          id: PARENT_A,
          children: [{ id: CHILD_A1 }],
        },
      });
      assert.equal(keys.includes(CHILD_B1), false);
      assert.equal(keys.includes(SCHOOL_B), false);
    },
  },
  {
    id: "PARENT-P0-03",
    title: "Rows B1 déjà hydratées ne sont jamais visibles",
    run() {
      const scope = resolveMobileStudentScope({
        role: "parent_student",
        selectedStudentId: CHILD_B1,
        children: [{ id: CHILD_A1 }, { id: CHILD_A2 }],
        user: parentUser,
      });
      const leaked = filterRowsByStudentScope(
        [
          { studentId: CHILD_A1, amount: 10 },
          { studentId: CHILD_B1, amount: 80_000 },
        ],
        scope,
      );
      assert.equal(scope.studentIds.includes(CHILD_B1), false);
      assert.equal(
        leaked.some((row) => row.studentId === CHILD_B1),
        false,
      );
      assert.equal(leaked.length, 0);
    },
  },
  {
    id: "PARENT-P0-04",
    title: "Routes Teacher* interdites au Parent",
    run() {
      const session = parentSession();
      assert.equal(canReadRoute(session, "TeacherGrades"), false);
      assert.equal(canReadRoute(session, "TeacherAttendance"), false);
      assert.equal(canReadRoute(session, "ClassGradesStats"), false);
    },
  },
  {
    id: "PARENT-P0-05",
    title: "Payments staff interdit",
    run() {
      assert.equal(canReadRoute(parentSession(), "Payments"), false);
    },
  },
  {
    id: "PARENT-P0-06",
    title: "FeeGrids staff interdit",
    run() {
      const session = parentSession();
      assert.equal(canReadFeeGrids(session), false);
      assert.equal(canReadRoute(session, "FeeGrids"), false);
    },
  },
  {
    id: "PARENT-P0-07",
    title: "Students staff interdit",
    run() {
      assert.equal(canReadRoute(parentSession(), "Students"), false);
    },
  },
  {
    id: "PARENT-P0-08",
    title: "Schooling staff interdit",
    run() {
      assert.equal(canReadRoute(parentSession(), "Schooling"), false);
    },
  },
  {
    id: "PARENT-P0-09",
    title: "canOpenAdminScreens Parent = false",
    run() {
      const session = parentSession();
      const canOpenAdminScreens =
        canReadRoute(session, "SchoolManagement") ||
        canReadRoute(session, "Teachers") ||
        canReadRoute(session, "Payments") ||
        canReadRoute(session, "Unpaid") ||
        canReadFeeGrids(session);
      assert.equal(canOpenAdminScreens, false);
      for (const route of STAFF_ROUTES) {
        assert.equal(canReadRoute(session, route), false, route);
      }
    },
  },
  {
    id: "PARENT-P0-10",
    title: "Push A1 autorisé",
    run() {
      const raw = resolvePushNavigationData({
        somafrikDestination: "StudentPayments",
        somafrikStudentId: CHILD_A1,
      });
      const scoped = constrainParentPushNavigation(raw, parentSession());
      assert.equal(scoped.destination, "StudentPayments");
      assert.equal(scoped.params?.studentId, CHILD_A1);
      const a2 = constrainParentPushNavigation(
        resolvePushNavigationData({
          somafrikDestination: "StudentPayments",
          somafrikStudentId: CHILD_A2,
        }),
        parentSession(),
      );
      assert.equal(a2.destination, "StudentPayments");
      assert.equal(a2.params?.studentId, CHILD_A2);
    },
  },
  {
    id: "PARENT-P0-11",
    title: "Push B1 rejeté",
    run() {
      const scoped = constrainParentPushNavigation(
        resolvePushNavigationData({
          somafrikDestination: "StudentPayments",
          somafrikStudentId: CHILD_B1,
        }),
        parentSession(),
      );
      assert.equal(scoped.destination, "Home");
      assert.equal(scoped.params?.studentId, undefined);
      const unknown = constrainParentPushNavigation(
        resolvePushNavigationData({
          somafrikDestination: "StudentPayments",
          somafrikStudentId: "unknown-student",
        }),
        parentSession(),
      );
      assert.equal(unknown.destination, "Home");
    },
  },
  {
    id: "PARENT-P0-12",
    title: "route.params B1 rejeté",
    run() {
      assert.equal(
        resolveParentSafeStudentId({
          role: "parent_student",
          routeStudentId: CHILD_B1,
          selectedStudentId: CHILD_A1,
          user: parentUser,
        }),
        null,
      );
      assert.equal(
        resolveParentSafeStudentId({
          role: "parent_student",
          routeStudentId: CHILD_A1,
          selectedStudentId: CHILD_A2,
          user: parentUser,
        }),
        CHILD_A1,
      );
      const detail = read("screens/StudentDetailScreen.tsx");
      const notes = read("screens/StudentNotesScreen.tsx");
      const presences = read("screens/StudentPresencesScreen.tsx");
      const payments = read("screens/StudentPaymentsScreen.tsx");
      for (const [label, src] of [
        ["StudentDetailScreen", detail],
        ["StudentNotesScreen", notes],
        ["StudentPresencesScreen", presences],
        ["StudentPaymentsScreen", payments],
      ] as const) {
        assert.match(src, /resolveParentSafeStudentId/, `${label} n'applique pas le rejet P0`);
      }
    },
  },
  {
    id: "PARENT-P0-13",
    title: "Parent login utilise Mot de passe",
    run() {
      assert.equal(resolveSecretFieldCopy("parent_student").label, "Mot de passe");
      assert.equal(LOGIN_SCREEN_COPY.passwordLabel, "Mot de passe");
      const login = read("screens/LoginScreen.tsx");
      assert.match(login, /resolveSecretFieldCopy/);
      assert.doesNotMatch(
        login,
        /identity\.role === "parent_student"[\s\S]{0,120}LOGIN_SCREEN_COPY\.pinLabel/,
      );
    },
  },
  {
    id: "PARENT-P0-14",
    title: "Parent login n'utilise pas number-pad",
    run() {
      assert.notEqual(resolveSecretKeyboardType("parent_student"), "number-pad");
      assert.equal(resolveSecretKeyboardType("parent_student"), "default");
      assert.equal(mapKeyboardToInputMode(resolveSecretKeyboardType("parent_student")), "text");
    },
  },
  {
    id: "PARENT-P0-15",
    title: "Mot de passe contenant lettres + chiffres saisissable",
    run() {
      assert.equal(validateAccountSecret("Pass1234"), null);
      assert.notEqual(resolveSecretKeyboardType("parent_student"), "number-pad");
      assert.equal(resolveSecretFieldCopy("parent_student").placeholder, LOGIN_SCREEN_COPY.passwordPlaceholder);
    },
  },
  {
    id: "PARENT-P0-16",
    title: "Aucun wording PIN dans parcours actif parent_student",
    run() {
      const copy = resolveSecretFieldCopy("parent_student");
      assert.doesNotMatch(copy.label, /PIN/i);
      assert.doesNotMatch(copy.placeholder, /PIN|1234/i);
      assert.notEqual(LOGIN_SCREEN_COPY.pinLabel, "PIN");
      const empty = resolveLoginEmptyFieldsError("parent_student");
      assert.doesNotMatch(empty, /PIN/i);
      const authError = mapLoginApiError("Mot de passe incorrect", "parent_student");
      assert.doesNotMatch(authError, /PIN/i);
      const login = read("screens/LoginScreen.tsx");
      assert.doesNotMatch(
        login,
        /identity\.role === "parent_student"[\s\S]{0,160}(pinLabel|pinPlaceholder)/,
      );
    },
  },
  {
    id: "PARENT-P0-17",
    title: "Mauvais mot de passe → erreur auth standard",
    run() {
      assert.equal(
        mapLoginApiError("Mot de passe incorrect", "parent_student"),
        ERROR_MESSAGES.invalidCredentials,
      );
      assert.equal(mapLoginApiError("", "parent_student"), ERROR_MESSAGES.invalidCredentials);
      assert.notEqual(mapLoginApiError("Mot de passe incorrect", "parent_student"), ERROR_MESSAGES.invalidPin);
    },
  },
  {
    id: "PARENT-P0-18",
    title: "Teacher/Admin/Student auth non régressés",
    run() {
      assert.equal(resolveSecretKeyboardType("student"), "number-pad");
      assert.equal(resolveSecretKeyboardType("school_admin"), "default");
      assert.equal(resolveSecretKeyboardType("teacher"), "default");
      assert.equal(resolveSecretFieldCopy("student").label, "PIN");
      assert.equal(mapLoginApiError("PIN incorrect", "student"), ERROR_MESSAGES.invalidPin);
      const teacherPayload = buildMobileLoginPayload({
        role: "teacher",
        identifier: "prof",
        pin: "Pass1234",
        schoolCode: SCHOOL_A,
      });
      assert.equal(teacherPayload.pin, "Pass1234");
      assert.equal("password" in teacherPayload, false);
      const parentPayload = buildMobileLoginPayload({
        role: "parent_student",
        identifier: "+243820000001",
        password: "Pass1234",
        schoolCode: SCHOOL_A,
      });
      assert.equal(parentPayload.password, "Pass1234");
      assert.equal(Object.prototype.hasOwnProperty.call(parentPayload, "pin"), false);
      const parentPinOnly = buildMobileLoginPayload({
        role: "parent_student",
        identifier: "+243820000001",
        pin: "Pass1234",
        schoolCode: SCHOOL_A,
      });
      assert.equal(Object.prototype.hasOwnProperty.call(parentPinOnly, "pin"), false);
      assert.equal(parentPinOnly.password, "");
      const loginSrc = read("screens/LoginScreen.tsx");
      assert.match(loginSrc, /identity\.role === "parent_student"/);
      assert.doesNotMatch(
        loginSrc,
        /pin: password\.trim\(\),\s*password: password\.trim\(\)/,
      );
      const adminPayload = buildMobileLoginPayload({
        role: "school_admin",
        identifier: "admin",
        pin: "1234",
        schoolCode: SCHOOL_A,
      });
      assert.equal(adminPayload.pin, "1234");
      assert.equal(adminPayload.schoolCode, SCHOOL_A);
    },
  },
];

const failed: { id: string; title: string; message: string }[] = [];
const passedIds: string[] = [];
for (const testCase of cases) {
  try {
    testCase.run();
    passedIds.push(testCase.id);
  } catch (error) {
    failed.push({
      id: testCase.id,
      title: testCase.title,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(`mobile parent P0 — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`);
for (const id of passedIds) console.log(`  PASS ${id}`);
for (const item of failed) {
  console.log(`  FAIL ${item.id} ${item.title}`);
  console.log(`    ${item.message}`);
}
console.log(
  `MOBILE_PARENT_P0_REPORT ${JSON.stringify({
    passedIds,
    failedIds: failed.map((item) => item.id),
    expectedIds: cases.map((item) => item.id),
  })}`,
);

if (failed.length) process.exit(1);
console.log("OK: Parent Mobile P0 — tous les contrats sont verts");
