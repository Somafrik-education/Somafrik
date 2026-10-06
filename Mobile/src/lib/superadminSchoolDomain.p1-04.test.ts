/**
 * P1-04 — Superadmin / Admin Pays ne sont pas des Admin School globaux.
 *
 *   npx --yes tsx src/lib/superadminSchoolDomain.p1-04.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import {
  SUPER_ADMIN_ALLOWED_FEATURES,
  canReadFeeGrids,
  canReadRoute,
  canReadView,
  hasSecurityPermission,
} from "../domain/security/permissions";
import {
  canAccessBackofficeMessagesComposer,
  canAccessMessagesRoute,
  canAccessPlatformNotifications,
  canArchiveAnnouncement,
  canReadBackofficeMessagesList,
} from "./mobileCtaRbacAlignment";
import { canAssignClassHeadTeacher } from "./mobileCrudParity";
import {
  constrainPlatformSchoolNavigation,
  hasAllPrivilegesToken,
  hasWildcardSchoolCode,
  isCountryAdminSession,
  isPlatformAdminSession,
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

function session(input: {
  role?: string;
  roleLabel?: string;
  roleKeys?: string[];
  permissions?: string[];
  schoolCode?: string;
}) {
  return attachCanonicalRoleIdentity({
    role: input.role,
    permissions: input.permissions ?? [],
    user: {
      id: `${input.role ?? "anon"}-p104`,
      name: input.roleLabel ?? input.role ?? "anon",
      schoolCode: input.schoolCode,
      role: input.roleLabel ?? input.role,
      roleKeys: input.roleKeys,
      permissions: input.permissions ?? [],
    },
    school: input.schoolCode ? { code: input.schoolCode } : undefined,
  });
}

const superAdmin = session({
  role: "super_admin",
  roleLabel: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
});
const superAdminOkafrk = session({
  role: "super_admin",
  roleLabel: "Super Administrateur OKAFRIK",
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
  permissions: [
    "Élèves:READ",
    "Paiements:READ",
    "Messages:READ",
    "Messages:CREATE",
    "Présences:READ",
    "Notes:READ",
    "Classes:UPDATE",
  ],
  schoolCode: "CD-IN-26-001",
});
const allPrivilegesOnly = {
  permissions: ["ALL_PRIVILEGES"],
  user: { id: "priv-only", permissions: ["ALL_PRIVILEGES"] },
};
const wildcardOnly = {
  user: { id: "star-only", schoolCode: "*" },
  school: { code: "*" },
};

assert.equal(isSuperAdminPrincipalSession(superAdmin), true);
assert.equal(isSuperAdminPrincipalSession(superAdminOkafrk), true);
assert.equal(isSuperAdminPrincipalSession({ role: "Super Administrateur Somafrik" }), true);
assert.equal(isSuperAdminPrincipalSession({ roleKeys: ["SUPER_ADMIN"] }), true);
assert.equal(isSuperAdminPrincipalSession(allPrivilegesOnly), false, "P1-02 : ALL_PRIVILEGES seul ≠ Superadmin");
assert.equal(isSuperAdminPrincipalSession(wildcardOnly), false, "P1-02 : schoolCode * ≠ Superadmin");
assert.equal(isCountryAdminSession(countryAdmin), true);
assert.equal(isPlatformAdminSession(schoolAdmin), false);
assert.equal(hasAllPrivilegesToken(allPrivilegesOnly), true);
assert.equal(hasWildcardSchoolCode(wildcardOnly), true);

assert.equal(hasSecurityPermission(superAdmin, "Pays", "READ"), true, "plateforme Pays autorisée");
assert.equal(hasSecurityPermission(superAdmin, "Établissements", "READ"), true);
assert.equal(hasSecurityPermission(superAdmin, "Abonnements", "READ"), true);
assert.equal(hasSecurityPermission(superAdmin, "Utilisateurs", "READ"), true);
assert.equal(canAccessPlatformNotifications(superAdmin), true);
assert.equal(canArchiveAnnouncement(superAdmin), true);
assert.equal(SUPER_ADMIN_ALLOWED_FEATURES.has("Messages"), true, "Set features reste aligné Web (Messages présent)");
assert.equal(hasSecurityPermission(superAdmin, "Messages", "READ"), false, "Messages du Set n'ouvre pas l'inbox scolaire");

for (const view of [
  "Students",
  "StudentDetail",
  "Payments",
  "Unpaid",
  "FeeGrids",
  "Messages",
  "InternalNotifications",
          "TeacherAttendance",
          "TeacherGrades",
  "Presences",
  "Notes",
  "Classes",
]) {
  assert.equal(canReadRoute(superAdmin, view), false, `Superadmin route ${view} refusée`);
  assert.equal(canReadView(superAdmin, view), false, `Superadmin vue ${view} masquée`);
  assert.equal(shouldDenySchoolDomain(superAdmin, view), true);
}

assert.equal(hasSecurityPermission(superAdmin, "Élèves", "READ"), false);
assert.equal(hasSecurityPermission(superAdmin, "Paiements", "READ"), false);
assert.equal(canReadFeeGrids(superAdmin), false);
assert.equal(canAccessMessagesRoute(superAdmin), false);
assert.equal(canReadBackofficeMessagesList(superAdmin), false);
assert.equal(canAccessBackofficeMessagesComposer(superAdmin), false);
assert.equal(canAssignClassHeadTeacher(superAdmin), false);

assert.equal(canReadRoute(countryAdmin, "Students"), false, "Admin Pays ≠ Admin School");
assert.equal(canReadRoute(countryAdmin, "Messages"), false);
assert.equal(canReadRoute(countryAdmin, "Payments"), false);
assert.equal(canAccessMessagesRoute(countryAdmin), false);
assert.equal(canReadFeeGrids(countryAdmin), false);
assert.equal(shouldSkipSchoolTenantHydration(countryAdmin), true);

assert.equal(canReadRoute(schoolAdmin, "Students"), true, "Admin School conserve Élèves");
assert.equal(canReadRoute(schoolAdmin, "Messages"), true);
assert.equal(canAccessMessagesRoute(schoolAdmin), true);
assert.equal(hasSecurityPermission(schoolAdmin, "Paiements", "READ"), true);
assert.equal(canReadRoute(schoolAdmin, "TeacherAttendance"), true);
assert.equal(canAssignClassHeadTeacher(schoolAdmin), true);
assert.equal(shouldSkipSchoolTenantHydration(schoolAdmin), false);

assert.equal(shouldDenySchoolDomain(allPrivilegesOnly, "Élèves"), true);
assert.equal(shouldDenySchoolDomain(allPrivilegesOnly, "Messages"), true);
assert.equal(hasSecurityPermission(allPrivilegesOnly, "Élèves", "READ"), false);
assert.equal(canReadRoute(allPrivilegesOnly, "Students"), false);
assert.equal(canAccessMessagesRoute(allPrivilegesOnly), false);

assert.equal(shouldDenySchoolDomain(wildcardOnly, "Paiements"), true);
assert.equal(hasSecurityPermission(wildcardOnly, "Paiements", "READ"), false);
assert.equal(canReadRoute(wildcardOnly, "Messages"), false);

assert.equal(resolveSafeMobileDestination("Students", superAdmin), "Home");
assert.equal(resolveSafeMobileDestination("Messages", countryAdmin), "Home");
assert.equal(resolveSafeMobileDestination("Users", superAdmin), "Users");
assert.equal(
  constrainPlatformSchoolNavigation({ destination: "StudentPayments" }, superAdmin).destination,
  "Home",
);
assert.equal(resolveNotificationsInboxRoute(superAdmin, "CD-IN-26-001"), null);

const schoolFetches: string[] = [];
function navigateThenFetch(destination: string, currentSession: unknown) {
  const next = resolveSafeMobileDestination(destination, currentSession);
  if (next !== "Home" && shouldDenySchoolDomain(currentSession, destination) === false) {
    schoolFetches.push(destination);
  }
  return next;
}
assert.equal(navigateThenFetch("Students", superAdmin), "Home");
assert.equal(navigateThenFetch("Messages", superAdmin), "Home");
assert.equal(navigateThenFetch("Payments", superAdmin), "Home");
assert.equal(navigateThenFetch("TeacherAttendance", superAdmin), "Home");
assert.deepEqual(schoolFetches, [], "aucun fetch scolaire après refus de navigation");

const leftover = {
  students: [{ id: "stu-1" }],
  teachers: [{ id: "tea-1" }],
  classes: [{ id: "cla-1" }],
  payments: [{ id: "pay-1" }],
  messages: [{ id: "msg-1" }],
  notes: [{ id: "note-1" }],
  presences: [{ id: "pre-1" }],
  schools: [{ code: "CD-IN-26-001" }],
};
const purged = stripSchoolDomainCollections(leftover);
assert.equal(purged.students.length, 0);
assert.equal(purged.messages.length, 0);
assert.equal(purged.payments.length, 0);
assert.equal(purged.schools.length, 1, "le catalogue établissements plateforme est conservé");

const projected = projectScopedStudentsForSession(superAdmin, leftover.students as never);
assert.equal(projected.kept, 0);

const scopedAfterRoleChange = scopeBackOfficeForSession(
  leftover,
  { role: "super_admin", user: { schoolCode: "*" } },
  "CD-IN-26-001",
) as Record<string, unknown[]>;
assert.equal(scopedAfterRoleChange.students.length, 0);
assert.equal(scopedAfterRoleChange.messages.length, 0);
assert.equal(scopedAfterRoleChange.payments.length, 0);

const adminSrc = fs.readFileSync(path.join(ROOT, "src/context/AdminDataContext.tsx"), "utf8");
assert.match(adminSrc, /shouldSkipSchoolTenantHydration\(session\)/);
assert.match(adminSrc, /if \(!session \|\| shouldSkipSchoolTenantHydration\(session\)\) \{\s*return;/);
assert.match(
  adminSrc,
  /if \(shouldSkipSchoolTenantHydration\(session\)\) \{\s*void loaders\.loadUsers\(\);/,
  "hydratation tenant scolaire court-circuitée pour Superadmin / Admin Pays",
);

const permissionsSrc = fs.readFileSync(path.join(ROOT, "src/domain/security/permissions.ts"), "utf8");
assert.match(permissionsSrc, /shouldDenySchoolDomain\(session, feature\)/);
assert.match(permissionsSrc, /"Messages"/);
assert.doesNotMatch(
  permissionsSrc,
  /"InternalNotifications",\s*"messages",\s*"Messages"/,
  "vues Messages / C4 retirées du allowlist Superadmin",
);

const backendGuard = fs.readFileSync(path.join(ROOT, "../backend/lib/platformPersonalDataGuard.js"), "utf8");
assert.match(backendGuard, /isPlatformPersonalDataForbidden/, "P0-2 Backend intact");
const p102 = fs.readFileSync(path.join(ROOT, "../backend/lib/superadminPrincipal.js"), "utf8");
assert.match(p102, /function isSuperAdminPrincipal/, "P1-02 Backend intact");
const p101 = fs.readFileSync(path.join(ROOT, "../backend/lib/financeSchoolScope.js"), "utf8");
assert.match(p101, /isSchoolFinanceForbiddenForSuperadmin/, "P1-01 Backend intact");
const p103 = fs.readFileSync(path.join(ROOT, "../backend/lib/communicationsMessagesService.js"), "utf8");
assert.match(p103, /denyPlatformSchoolMessages/, "P1-03 Backend intact");

console.log("superadminSchoolDomain.p1-04.test.ts OK");
