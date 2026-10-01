/**
 * P1-09 — Replay final de fermeture sécurité (Mobile).
 * Aucune correction produit : P1-04 + P1-08 verts.
 *
 *   npx --yes tsx src/lib/superadminClosure.p1-09.audit.test.ts
 */
import assert from "node:assert/strict";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import {
  canReadFeeGrids,
  canReadRoute,
  hasSecurityPermission,
} from "../domain/security/permissions";
import {
  canAccessMessagesRoute,
  canAccessPlatformNotifications,
} from "./mobileCtaRbacAlignment";
import {
  constrainPlatformSchoolNavigation,
  isSuperAdminPrincipalSession,
  resolveSafeMobileDestination,
  shouldDenySchoolDomain,
  shouldSkipSchoolTenantHydration,
} from "./platformSchoolDomainDeny";
import { projectScopedStudentsForSession } from "./studentsScope";
import { scopeBackOfficeForSession } from "./scope";
import { resolveNotificationsInboxRoute } from "./notificationInboxRoute";

function session(input: {
  role?: string;
  roleLabel?: string;
  roleKeys?: string[];
  permissions?: string[];
  schoolCode?: string;
}) {
  return attachCanonicalRoleIdentity({
    role: input.role ?? "",
    permissions: input.permissions ?? [],
    user: {
      id: `${input.role ?? "anon"}-p109`,
      name: input.roleLabel ?? input.role ?? "anon",
      schoolCode: input.schoolCode,
      role: input.roleLabel ?? input.role,
      roleKeys: input.roleKeys,
      permissions: input.permissions ?? [],
    },
    school: input.schoolCode ? { code: input.schoolCode } : undefined,
  })!;
}

const superAdmin = session({
  role: "super_admin",
  roleLabel: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
});
const countryAdmin = session({
  role: "country_admin",
  roleLabel: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES"],
  schoolCode: "*",
});
const schoolAdmin = session({
  role: "school_admin",
  roleLabel: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: ["Élèves:READ", "Messages:READ", "Paiements:READ"],
  schoolCode: "CD-IN-26-001",
});
const teacher = session({
  role: "teacher",
  roleLabel: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: ["Élèves:READ", "Notes:READ"],
  schoolCode: "CD-IN-26-001",
});
const parent = session({
  role: "parent_student",
  roleLabel: "Parent",
  roleKeys: ["PARENT"],
  permissions: ["Élèves:READ"],
  schoolCode: "CD-IN-26-001",
});
const student = session({
  role: "student",
  roleLabel: "Élève / Étudiant",
  roleKeys: ["STUDENT"],
  permissions: ["Élèves:READ"],
  schoolCode: "CD-IN-26-001",
});

const allPrivilegesOnly = {
  role: "",
  permissions: ["ALL_PRIVILEGES"],
  user: { role: "", schoolCode: "", schoolId: "", schoolPublicCode: "" },
};

const leftover = {
  students: [{ id: "stu-1" }],
  teachers: [{ id: "tea-1" }],
  classes: [{ id: "cla-1" }],
  payments: [{ id: "pay-1" }],
  messages: [{ id: "msg-1" }],
  notes: [{ id: "note-1" }],
  presences: [{ id: "pre-1" }],
  schools: [{ code: "CD-IN-26-001" }],
  users: [{ id: "usr-1" }],
};

assert.equal(isSuperAdminPrincipalSession(superAdmin), true);
assert.equal(isSuperAdminPrincipalSession(allPrivilegesOnly), false);

for (const principal of [superAdmin, countryAdmin, allPrivilegesOnly]) {
  assert.equal(shouldSkipSchoolTenantHydration(principal), true);
  assert.equal(shouldDenySchoolDomain(principal, "Élèves"), true);
  assert.equal(canReadRoute(principal, "Students"), false);
  assert.equal(canReadRoute(principal, "Messages"), false);
  assert.equal(canReadRoute(principal, "Payments"), false);
  assert.equal(canReadRoute(principal, "Timetable"), false);
  assert.equal(canAccessMessagesRoute(principal), false);
  assert.equal(canReadFeeGrids(principal), false);
  assert.equal(resolveSafeMobileDestination("Students", principal), "Home");
  assert.equal(constrainPlatformSchoolNavigation({ destination: "Payments" }, principal).destination, "Home");
  assert.equal(resolveNotificationsInboxRoute(principal, "CD-IN-26-001"), null);
  assert.equal(projectScopedStudentsForSession(principal, leftover.students as never).kept, 0);
  const scoped = scopeBackOfficeForSession(leftover, principal) as Record<string, unknown[]>;
  assert.equal(scoped.students.length, 0);
  assert.equal(scoped.messages.length, 0);
  assert.equal(scoped.payments.length, 0);
}

assert.equal(hasSecurityPermission(superAdmin, "Pays", "READ"), true);
assert.equal(canAccessPlatformNotifications(superAdmin), true);
assert.equal(resolveSafeMobileDestination("Users", superAdmin), "Users");
assert.equal(resolveSafeMobileDestination("Users", allPrivilegesOnly), "Users");

assert.equal(canReadRoute(schoolAdmin, "Students"), true);
assert.equal(canAccessMessagesRoute(schoolAdmin), true);
assert.equal(shouldSkipSchoolTenantHydration(schoolAdmin), false);
assert.equal(shouldSkipSchoolTenantHydration(teacher), false);
assert.equal(shouldSkipSchoolTenantHydration(parent), false);
assert.equal(shouldSkipSchoolTenantHydration(student), false);

const schoolScoped = scopeBackOfficeForSession(leftover, schoolAdmin, "CD-IN-26-001") as Record<string, unknown[]>;
assert.equal(schoolScoped.students.length, 1);

const privScoped = scopeBackOfficeForSession(leftover, allPrivilegesOnly) as Record<string, unknown[]>;
assert.equal(privScoped.users.length, 1, "Users plateforme conservé");
assert.equal(privScoped.schools.length, 1, "catalogue établissements conservé");

console.log("superadminClosure.p1-09.audit.test.ts OK");
