/**
 * P1-08 — ALL_PRIVILEGES seul n'hydrate pas le tenant scolaire.
 *
 *   npx --yes tsx src/lib/allPrivilegesHydration.p1-08.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  hasAllPrivilegesToken,
  isSuperAdminPrincipalSession,
  resolveSafeMobileDestination,
  shouldDenySchoolDomain,
  shouldSkipSchoolTenantHydration,
  stripSchoolDomainCollections,
} from "./platformSchoolDomainDeny";
import { projectScopedStudentsForSession } from "./studentsScope";
import { scopeBackOfficeForSession } from "./scope";
import { resolveNotificationsInboxRoute } from "./notificationInboxRoute";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function schoolAdmin() {
  return attachCanonicalRoleIdentity({
    role: "school_admin",
    permissions: ["Élèves:READ", "Messages:READ", "Paiements:READ", "Notes:READ", "Présences:READ"],
    user: {
      id: "admin-nuru",
      name: "Admin School",
      schoolCode: "CD-IN-26-001",
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: ["Élèves:READ", "Messages:READ", "Paiements:READ", "Notes:READ", "Présences:READ"],
    },
    school: { code: "CD-IN-26-001" },
  });
}

function teacher() {
  return attachCanonicalRoleIdentity({
    role: "teacher",
    permissions: ["Élèves:READ", "Notes:READ", "Présences:READ"],
    user: {
      id: "ens-1",
      name: "Enseignant",
      schoolCode: "CD-IN-26-001",
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      permissions: ["Élèves:READ", "Notes:READ", "Présences:READ"],
    },
  });
}

function parent() {
  return attachCanonicalRoleIdentity({
    role: "parent_student",
    permissions: ["Élèves:READ", "Notifications:READ"],
    user: {
      id: "par-1",
      name: "Parent",
      schoolCode: "CD-IN-26-001",
      role: "Parent",
      roleKeys: ["PARENT"],
      permissions: ["Élèves:READ", "Notifications:READ"],
    },
  });
}

function student() {
  return attachCanonicalRoleIdentity({
    role: "student",
    permissions: ["Élèves:READ"],
    user: {
      id: "stu-1",
      name: "Élève",
      schoolCode: "CD-IN-26-001",
      role: "Élève / Étudiant",
      roleKeys: ["STUDENT"],
      permissions: ["Élèves:READ"],
    },
  });
}

const allPrivilegesOnly = {
  permissions: ["ALL_PRIVILEGES"],
  user: { id: "priv-only", permissions: ["ALL_PRIVILEGES"] },
};

const allPrivilegesWildcard = {
  permissions: ["ALL_PRIVILEGES"],
  user: { id: "priv-star", permissions: ["ALL_PRIVILEGES"], schoolCode: "*" },
  school: { code: "*" },
};

const leftover = {
  students: [{ id: "stu-1" }],
  teachers: [{ id: "tea-1" }],
  classes: [{ id: "cla-1" }],
  courses: [{ id: "cou-1" }],
  assignments: [{ id: "asg-1" }],
  payments: [{ id: "pay-1" }],
  messages: [{ id: "msg-1" }],
  notes: [{ id: "note-1" }],
  presences: [{ id: "pre-1" }],
  paymentStatuses: [{ id: "st-1" }],
  schools: [{ code: "CD-IN-26-001" }],
};

assert.equal(isSuperAdminPrincipalSession(allPrivilegesOnly), false);
assert.equal(hasAllPrivilegesToken(allPrivilegesOnly), true);
assert.equal(shouldSkipSchoolTenantHydration(allPrivilegesOnly), true, "ALL_PRIVILEGES seul skip hydratation");
assert.equal(shouldSkipSchoolTenantHydration(allPrivilegesWildcard), true, "ALL_PRIVILEGES + * skip hydratation");
assert.equal(shouldSkipSchoolTenantHydration(schoolAdmin()), false, "Admin School hydrate son établissement");
assert.equal(shouldSkipSchoolTenantHydration(teacher()), false, "Teacher hydrate");
assert.equal(shouldSkipSchoolTenantHydration(parent()), false, "Parent hydrate");
assert.equal(shouldSkipSchoolTenantHydration(student()), false, "Student hydrate");

const schoolAdminWithPrivileges = attachCanonicalRoleIdentity({
  ...schoolAdmin(),
  permissions: [...(schoolAdmin().permissions ?? []), "ALL_PRIVILEGES"],
});
assert.equal(
  shouldSkipSchoolTenantHydration(schoolAdminWithPrivileges),
  false,
  "Admin School + ALL_PRIVILEGES hydrate toujours son tenant",
);
assert.equal(
  shouldSkipSchoolTenantHydration({
    ...teacher(),
    permissions: ["ALL_PRIVILEGES", "Élèves:READ"],
  }),
  false,
  "Teacher + ALL_PRIVILEGES hydrate toujours",
);
assert.equal(
  shouldSkipSchoolTenantHydration({
    ...student(),
    permissions: ["ALL_PRIVILEGES", "Élèves:READ"],
  }),
  false,
  "Student + ALL_PRIVILEGES hydrate toujours",
);

const schoolCollections = [
  "Élèves",
  "Classes",
  "Enseignants",
  "Présences",
  "Notes",
  "Paiements",
  "Impayés",
  "Frais & tarifs",
  "Messages",
  "Planning de cours",
  "Affectations",
  "Matières",
  "Examens",
  "Bulletins",
];
for (const feature of schoolCollections) {
  assert.equal(shouldDenySchoolDomain(allPrivilegesOnly, feature), true, `deny ${feature}`);
}

for (const view of [
  "Students",
  "Classes",
  "Teachers",
  "Presences",
  "Notes",
  "Payments",
  "Unpaid",
  "FeeGrids",
  "Messages",
  "Timetable",
  "Schooling",
  "InternalNotifications",
]) {
  assert.equal(canReadRoute(allPrivilegesOnly, view), false, `route ${view} fermée`);
}

assert.equal(hasSecurityPermission(allPrivilegesOnly, "Élèves", "READ"), false);
assert.equal(canAccessMessagesRoute(allPrivilegesOnly), false);
assert.equal(canReadFeeGrids(allPrivilegesOnly), false);
assert.equal(canAccessPlatformNotifications(allPrivilegesOnly), true, "catalogue plateforme conservé");

assert.equal(resolveSafeMobileDestination("Students", allPrivilegesOnly), "Home");
assert.equal(resolveSafeMobileDestination("Messages", allPrivilegesOnly), "Home");
assert.equal(resolveSafeMobileDestination("Users", allPrivilegesOnly), "Users");
assert.equal(
  constrainPlatformSchoolNavigation({ destination: "StudentDetail" }, allPrivilegesOnly).destination,
  "Home",
);
assert.equal(
  constrainPlatformSchoolNavigation({ destination: "Payments" }, allPrivilegesOnly).destination,
  "Home",
);
assert.equal(
  constrainPlatformSchoolNavigation({ destination: "Users" }, allPrivilegesOnly).destination,
  "Users",
);
assert.equal(resolveNotificationsInboxRoute(allPrivilegesOnly, "CD-IN-26-001"), null);
assert.equal(resolveNotificationsInboxRoute(allPrivilegesWildcard, "*"), null);

const projected = projectScopedStudentsForSession(allPrivilegesOnly, leftover.students as never);
assert.equal(projected.kept, 0);
assert.equal(projected.students.length, 0);

const scoped = scopeBackOfficeForSession(leftover, allPrivilegesOnly, "CD-IN-26-001") as Record<string, unknown[]>;
assert.equal(scoped.students.length, 0);
assert.equal(scoped.teachers.length, 0);
assert.equal(scoped.classes.length, 0);
assert.equal(scoped.messages.length, 0);
assert.equal(scoped.payments.length, 0);
assert.equal(scoped.presences.length, 0);
assert.equal(scoped.notes.length, 0);
assert.equal(scoped.schools.length, 1, "catalogue établissements plateforme conservé");

const schoolScoped = scopeBackOfficeForSession(leftover, schoolAdmin(), "CD-IN-26-001") as Record<string, unknown[]>;
assert.equal(schoolScoped.students.length, 1, "Admin School conserve les collections de son tenant");

const purged = stripSchoolDomainCollections(leftover);
assert.equal(purged.students.length, 0);
assert.equal(purged.schools.length, 1);

const denySrc = fs.readFileSync(path.join(ROOT, "src/lib/platformSchoolDomainDeny.ts"), "utf8");
const skipFn = denySrc.slice(denySrc.indexOf("export function shouldSkipSchoolTenantHydration"));
assert.match(skipFn, /shouldDenySchoolDomain\(session\)/);
assert.doesNotMatch(
  skipFn.slice(0, 280),
  /return isPlatformAdminSession\(session\)/,
  "P1-08 : skip hydratation n'est plus limité aux rôles plateforme",
);
const navFn = denySrc.slice(denySrc.indexOf("export function constrainPlatformSchoolNavigation"));
assert.match(navFn, /shouldDenySchoolDomain\(session, target\.destination\)/);
assert.doesNotMatch(
  navFn.slice(0, 220),
  /if \(!isPlatformAdminSession\(session\)\) return target/,
  "P1-08 : deep-links ALL_PRIVILEGES seul suivent le même deny",
);

const adminSrc = fs.readFileSync(path.join(ROOT, "src/context/AdminDataContext.tsx"), "utf8");
assert.match(adminSrc, /if \(!session \|\| shouldSkipSchoolTenantHydration\(session\)\) \{\s*return;/);
assert.match(adminSrc, /if \(shouldSkipSchoolTenantHydration\(session\)\) \{\s*void loaders\.loadUsers\(\);/);

const l1Src = fs.readFileSync(path.join(ROOT, "src/offline/l1/L1CacheRuntime.tsx"), "utf8");
assert.match(l1Src, /shouldSkipSchoolTenantHydration\(session\)/);

const announcementsSrc = fs.readFileSync(path.join(ROOT, "src/screens/AnnouncementsScreen.tsx"), "utf8");
assert.match(announcementsSrc, /includeSchool: !shouldSkipSchoolTenantHydration\(session\)/);

console.log("allPrivilegesHydration.p1-08.test.ts OK");
