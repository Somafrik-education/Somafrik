/**
 * P1-05 — Audit de fermeture Superadmin (Mobile).
 * Aucune correction produit : replay P1-04 + écarts restants documentés.
 *
 *   npx --yes tsx src/lib/superadminClosure.p1-05.audit.test.ts
 */
import assert from "node:assert/strict";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import {
  canReadFeeGrids,
  canReadRoute,
  hasSecurityPermission,
} from "../domain/security/permissions";
import { canAccessMessagesRoute } from "./mobileCtaRbacAlignment";
import {
  isSuperAdminPrincipalSession,
  shouldDenySchoolDomain,
  shouldSkipSchoolTenantHydration,
} from "./platformSchoolDomainDeny";

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
      id: `${input.role ?? "anon"}-p105`,
      name: input.roleLabel ?? input.role ?? "anon",
      schoolCode: input.schoolCode,
      role: input.roleLabel ?? input.role,
      roleKeys: input.roleKeys,
      permissions: input.permissions ?? [],
    },
  });
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
const allPrivilegesOnly = {
  permissions: ["ALL_PRIVILEGES"],
  user: { permissions: ["ALL_PRIVILEGES"] },
};

assert.equal(isSuperAdminPrincipalSession(superAdmin), true);
assert.equal(isSuperAdminPrincipalSession(allPrivilegesOnly), false);

assert.equal(hasSecurityPermission(superAdmin, "Pays", "READ"), true);
assert.equal(canReadRoute(superAdmin, "Students"), false);
assert.equal(canReadRoute(superAdmin, "Messages"), false);
assert.equal(canReadRoute(superAdmin, "Payments"), false);
assert.equal(canReadFeeGrids(superAdmin), false);
assert.equal(canAccessMessagesRoute(superAdmin), false);
assert.equal(shouldSkipSchoolTenantHydration(superAdmin), true);
assert.equal(shouldSkipSchoolTenantHydration(countryAdmin), true);

assert.equal(canReadRoute(countryAdmin, "Students"), false);
assert.equal(canAccessMessagesRoute(countryAdmin), false);

assert.equal(canReadRoute(schoolAdmin, "Students"), true);
assert.equal(canAccessMessagesRoute(schoolAdmin), true);

assert.equal(shouldDenySchoolDomain(allPrivilegesOnly, "Élèves"), true);
assert.equal(
  shouldSkipSchoolTenantHydration(allPrivilegesOnly),
  false,
  "KNOWN_GAP Mobile : ALL_PRIVILEGES seul est refusé en UI mais l'hydratation tenant n'est pas skippée",
);

console.log("superadminClosure.p1-05.audit.test.ts OK");
