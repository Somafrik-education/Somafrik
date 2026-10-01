/**
 * P1-11 — Replay final Mobile après #850.
 *   npx --yes tsx src/lib/superadminClosure.p1-11.audit.test.ts
 */
import assert from "node:assert/strict";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { canReadRoute } from "../domain/security/permissions";
import { canAccessMessagesRoute, canAccessPlatformNotifications } from "./mobileCtaRbacAlignment";
import {
  isSuperAdminPrincipalSession,
  resolveSafeMobileDestination,
  shouldSkipSchoolTenantHydration,
} from "./platformSchoolDomainDeny";
import { projectScopedStudentsForSession } from "./studentsScope";
import { scopeBackOfficeForSession } from "./scope";

function session(role: string, roleLabel: string, roleKeys: string[], permissions: string[], schoolCode: string) {
  return attachCanonicalRoleIdentity({
    role,
    permissions,
    user: {
      id: `${role || "anon"}-p111`,
      name: roleLabel,
      schoolCode,
      role: roleLabel,
      roleKeys,
      permissions,
    },
  })!;
}

const superAdmin = session("super_admin", "Super Administrateur Somafrik", ["SUPER_ADMIN"], ["ALL_PRIVILEGES"], "*");
const schoolAdmin = session("school_admin", "Admin School", ["SCHOOL_ADMIN"], ["Élèves:READ", "Messages:READ"], "CD-IN-26-001");
const agent = { role: "Agent", permissions: ["ALL_PRIVILEGES"], user: { role: "Agent", schoolCode: "*", permissions: ["ALL_PRIVILEGES"] } };

assert.equal(isSuperAdminPrincipalSession(superAdmin), true);
assert.equal(isSuperAdminPrincipalSession(agent), false);
for (const principal of [superAdmin, agent]) {
  assert.equal(shouldSkipSchoolTenantHydration(principal), true);
  assert.equal(canReadRoute(principal, "Students"), false);
  assert.equal(canReadRoute(principal, "Messages"), false);
  assert.equal(canReadRoute(principal, "Payments"), false);
  assert.equal(canAccessMessagesRoute(principal), false);
  assert.equal(resolveSafeMobileDestination("Students", principal), "Home");
  assert.equal(resolveSafeMobileDestination("Users", principal), "Users");
  assert.equal(projectScopedStudentsForSession(principal, [{ id: "stu-1" }] as never).kept, 0);
}
assert.equal(canAccessPlatformNotifications(superAdmin), true);
assert.equal(shouldSkipSchoolTenantHydration(schoolAdmin), false);
assert.equal(canReadRoute(schoolAdmin, "Students"), true);
assert.equal(canAccessMessagesRoute(schoolAdmin), true);
const scoped = scopeBackOfficeForSession(
  { students: [{ id: "stu-1" }], users: [{ id: "usr-1" }], schools: [{ code: "CD-IN-26-001" }], messages: [], payments: [] },
  agent,
) as Record<string, unknown[]>;
assert.equal(scoped.students.length, 0);
assert.equal(scoped.users.length, 1);

console.log("superadminClosure.p1-11.audit.test.ts OK");
