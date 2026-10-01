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
import { projectScopedStudentsForSession, type StudentScopeSession } from "./studentsScope";
import { scopeBackOfficeForSession } from "./scope";
import { resolveNotificationsInboxRoute } from "./notificationInboxRoute";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function session(input: {
  role?: string;
  roleLabel?: string;
  roleKeys?: string[];
  permissions?: string[];
  schoolCode?: string;
  id?: string;
}) {
  return attachCanonicalRoleIdentity({
    role: input.role ?? "",
    permissions: input.permissions ?? [],
    user: {
      id: input.id ?? `${input.role ?? "anon"}-p108`,
      name: input.roleLabel ?? input.role ?? "anon",
      schoolCode: input.schoolCode,
      role: input.roleLabel ?? input.role,
      roleKeys: input.roleKeys,
      permissions: input.permissions ?? [],
    },
    school: input.schoolCode ? { code: input.schoolCode } : undefined,
  })!;
}

function schoolAdmin(permissions: string[] = ["Élèves:READ", "Messages:READ", "Paiements:READ", "Notes:READ", "Présences:READ"]) {
  return session({
    role: "school_admin",
    roleLabel: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions,
    schoolCode: "CD-IN-26-001",
    id: "admin-nuru",
  });
}

function teacher(permissions: string[] = ["Élèves:READ", "Notes:READ", "Présences:READ"]) {
  return session({
    role: "teacher",
    roleLabel: "Enseignant",
    roleKeys: ["TEACHER"],
    permissions,
    schoolCode: "CD-IN-26-001",
    id: "ens-1",
  });
}

function parent() {
  return session({
    role: "parent_student",
    roleLabel: "Parent",
    roleKeys: ["PARENT"],
    permissions: ["Élèves:READ", "Notifications:READ"],
    schoolCode: "CD-IN-26-001",
    id: "par-1",
  });
}

function student(permissions: string[] = ["Élèves:READ"]) {
  return session({
    role: "student",
    roleLabel: "Élève / Étudiant",
    roleKeys: ["STUDENT"],
    permissions,
    schoolCode: "CD-IN-26-001",
    id: "stu-1",
  });
}

const allPrivilegesOnly: StudentScopeSession & { permissions: string[] } = {
  role: "",
  permissions: ["ALL_PRIVILEGES"],
  user: { role: "", schoolCode: "", schoolId: "", schoolPublicCode: "" },
};

const allPrivilegesWildcard: StudentScopeSession & { permissions: string[] } = {
  role: "",
  permissions: ["ALL_PRIVILEGES"],
  user: { role: "", schoolCode: "*", schoolId: "", schoolPublicCode: "" },
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

assert.equal(
  shouldSkipSchoolTenantHydration(
    schoolAdmin(["Élèves:READ", "Messages:READ", "Paiements:READ", "Notes:READ", "Présences:READ", "ALL_PRIVILEGES"]),
  ),
  false,
  "Admin School + ALL_PRIVILEGES hydrate toujours son tenant",
);
assert.equal(
  shouldSkipSchoolTenantHydration(teacher(["ALL_PRIVILEGES", "Élèves:READ"])),
  false,
  "Teacher + ALL_PRIVILEGES hydrate toujours",
);
assert.equal(
  shouldSkipSchoolTenantHydration(student(["ALL_PRIVILEGES", "Élèves:READ"])),
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
