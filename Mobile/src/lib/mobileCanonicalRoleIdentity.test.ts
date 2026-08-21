import assert from "node:assert/strict";
import {
  attachCanonicalRoleIdentity,
  resolveCanonicalRoleIdentity,
  sessionRoleFromRoleKey,
} from "./canonicalRoleIdentity";
import { sessionRoleToPlatformRole } from "./orgHierarchy";
import { getRoleHomeShell, resolveRoleHomeKey } from "./roleHomeConfig";
import {
  canMutateEntity,
  canReadRoute,
  canReadView,
  hasSecurityPermission,
  resolveEffectivePermissions,
} from "../domain/security/permissions";

function liveSession(input: {
  sessionRole?: string;
  roleLabel?: string;
  roleKeys?: string[];
  permissions: string[];
  schoolCode?: string;
}) {
  return attachCanonicalRoleIdentity({
    role: input.sessionRole,
    permissions: input.permissions,
    user: {
      id: "user-l1",
      name: "Identité L1",
      schoolCode: input.schoolCode ?? "CD-IN-26-001",
      role: input.roleLabel,
      roleKeys: input.roleKeys,
      permissions: input.permissions,
    },
  });
}

const directeur = liveSession({
  sessionRole: "principal",
  roleLabel: "Directeur",
  roleKeys: ["PRINCIPAL"],
  permissions: ["Élèves:READ"],
});

const identityDirecteur = resolveCanonicalRoleIdentity(directeur);
assert.equal(identityDirecteur.roleKey, "PRINCIPAL");
assert.equal(identityDirecteur.roleLabel, "Directeur");
assert.equal(identityDirecteur.sessionRole, "principal");
assert.notEqual(identityDirecteur.sessionRole, "school_admin");
assert.notEqual(identityDirecteur.roleKey, "SCHOOL_ADMIN");
assert.equal(resolveRoleHomeKey(directeur), "principal");
assert.equal(getRoleHomeShell(directeur).spaceLabel, "Espace directeur");
assert.equal(sessionRoleToPlatformRole("principal"), "Directeur");
assert.equal(hasSecurityPermission(directeur, "Élèves", "READ"), true);
assert.equal(hasSecurityPermission(directeur, "Classes", "CREATE"), false);
assert.equal(hasSecurityPermission(directeur, "Utilisateurs", "UPDATE"), false);
assert.equal(canReadRoute(directeur, "Students"), true);
assert.equal(canReadView(directeur, "Configuration"), false);
assert.equal(canReadView(directeur, "SchoolManagement"), false);

const directeurEtablissements = liveSession({
  sessionRole: "principal",
  roleLabel: "Directeur",
  roleKeys: ["PRINCIPAL"],
  permissions: ["Établissements:READ"],
});
assert.equal(canReadView(directeurEtablissements, "SchoolManagement"), true);
assert.equal(canReadView(directeurEtablissements, "establishment"), true);
assert.equal(canReadRoute(directeurEtablissements, "SchoolManagement"), true);
assert.equal(canReadRoute(directeurEtablissements, "Payments"), false);
assert.equal(canMutateEntity(directeur, "users", "UPDATE"), false);
assert.equal(canMutateEntity(directeur, "classes", "CREATE"), false);

const liveOverLocalMatrix = resolveEffectivePermissions(
  "Directeur",
  ["Élèves:READ"],
  { Directeur: ["Classes:CREATE", "Utilisateurs:UPDATE", "Élèves:CRUD"] },
);
assert.deepEqual(liveOverLocalMatrix, ["Élèves:READ"]);

const proviseur = liveSession({
  sessionRole: "principal",
  roleLabel: "Proviseur",
  roleKeys: ["PROVISEUR"],
  permissions: ["Élèves:READ", "Présences:READ"],
});
const identityProviseur = resolveCanonicalRoleIdentity(proviseur);
assert.equal(identityProviseur.roleKey, "PROVISEUR");
assert.equal(identityProviseur.roleLabel, "Proviseur");
assert.equal(identityProviseur.sessionRole, "proviseur");
assert.notEqual(identityProviseur.sessionRole, "prefet");
assert.notEqual(identityProviseur.roleKey, "PREFET_ETUDES");
assert.notEqual(identityProviseur.roleKey, "SCHOOL_ADMIN");
assert.equal(resolveRoleHomeKey(proviseur), "proviseur");
assert.equal(getRoleHomeShell(proviseur).spaceLabel, "Espace proviseur");
assert.equal(sessionRoleToPlatformRole("proviseur"), "Proviseur");
assert.equal(hasSecurityPermission(proviseur, "Élèves", "READ"), true);
assert.equal(hasSecurityPermission(proviseur, "Notes", "CREATE"), false);
assert.equal(canReadView(proviseur, "Permissions"), false);

const comptable = liveSession({
  sessionRole: "accountant",
  roleLabel: "Comptable",
  roleKeys: ["ACCOUNTANT"],
  permissions: ["Paiements:READ"],
});
const identityComptable = resolveCanonicalRoleIdentity(comptable);
assert.equal(identityComptable.roleKey, "ACCOUNTANT");
assert.equal(identityComptable.roleLabel, "Comptable");
assert.notEqual(identityComptable.sessionRole, "school_admin");
assert.equal(resolveRoleHomeKey(comptable), "accountant");
assert.equal(hasSecurityPermission(comptable, "Paiements", "READ"), true);
assert.equal(hasSecurityPermission(comptable, "Paiements", "CREATE"), false);
assert.equal(hasSecurityPermission(comptable, "Paiements", "UPDATE"), false);
assert.equal(hasSecurityPermission(comptable, "Paiements", "DELETE"), false);
assert.equal(hasSecurityPermission(comptable, "Utilisateurs", "READ"), false);
assert.equal(canReadRoute(comptable, "Payments"), true);
assert.equal(canReadRoute(comptable, "Users"), false);
assert.equal(canReadView(comptable, "Configuration"), false);
assert.equal(canReadView(comptable, "SchoolManagement"), false);
assert.equal(canReadView(comptable, "establishment"), false);
assert.equal(canReadRoute(comptable, "SchoolManagement"), false);

const adjoint = liveSession({
  sessionRole: "adjoint",
  roleLabel: "Directeur adjoint",
  roleKeys: ["ADJOINT"],
  permissions: [],
});
const identityAdjoint = resolveCanonicalRoleIdentity(adjoint);
assert.equal(identityAdjoint.roleKey, "ADJOINT");
assert.equal(identityAdjoint.roleLabel, "Directeur adjoint");
assert.notEqual(identityAdjoint.sessionRole, "school_admin");
assert.equal(resolveRoleHomeKey(adjoint), "adjoint");
assert.equal(hasSecurityPermission(adjoint, "Élèves", "READ"), false);
assert.equal(hasSecurityPermission(adjoint, "Utilisateurs", "UPDATE"), false);
assert.equal(canReadRoute(adjoint, "Students"), false);
assert.equal(canReadView(adjoint, "SchoolManagement"), false);
assert.equal(canReadView(adjoint, "establishment"), false);
assert.equal(canReadRoute(adjoint, "SchoolManagement"), false);
assert.equal(canReadRoute(adjoint, "Payments"), false);
assert.equal(canReadView(adjoint, "users"), false);

const enseignant = liveSession({
  sessionRole: "teacher",
  roleLabel: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: ["Notes:READ", "Présences:READ"],
});
const identityTeacher = resolveCanonicalRoleIdentity(enseignant);
assert.equal(identityTeacher.roleKey, "TEACHER");
assert.equal(identityTeacher.roleLabel, "Enseignant");
assert.equal(hasSecurityPermission(enseignant, "Notes", "READ"), true);
assert.equal(hasSecurityPermission(enseignant, "Notes", "CREATE"), false);
assert.equal(hasSecurityPermission(enseignant, "Présences", "READ"), true);
assert.equal(hasSecurityPermission(enseignant, "Présences", "UPDATE"), false);
assert.equal(hasSecurityPermission(enseignant, "Utilisateurs", "UPDATE"), false);
assert.equal(canReadRoute(enseignant, "TeacherGrades"), true);

const unknown = liveSession({
  sessionRole: "ROLE_TEST_INCONNU",
  roleLabel: "ROLE_TEST_INCONNU",
  roleKeys: ["ROLE_TEST_INCONNU"],
  permissions: ["Messages:READ"],
});
const identityUnknown = resolveCanonicalRoleIdentity(unknown);
assert.equal(identityUnknown.roleKey, "ROLE_TEST_INCONNU");
assert.equal(identityUnknown.roleLabel, "ROLE_TEST_INCONNU");
assert.equal(identityUnknown.sessionRole, "ROLE_TEST_INCONNU");
assert.notEqual(identityUnknown.sessionRole, "school_admin");
assert.notEqual(identityUnknown.roleKey, "SCHOOL_ADMIN");
assert.equal(resolveRoleHomeKey(unknown), "unknown");
assert.notEqual(getRoleHomeShell(unknown).role, "school_admin");
assert.equal(canReadRoute(unknown, "Messages"), true);
assert.equal(canReadRoute(unknown, "Users"), false);
assert.equal(canReadRoute(unknown, "Payments"), false);
assert.equal(canReadView(unknown, "Configuration"), false);
assert.equal(hasSecurityPermission(unknown, "Utilisateurs", "READ"), false);

const multiRole = liveSession({
  sessionRole: "principal",
  roleLabel: "Directeur",
  roleKeys: ["PRINCIPAL", "TEACHER"],
  permissions: ["Élèves:READ", "Notes:READ"],
});
const identityMulti = resolveCanonicalRoleIdentity(multiRole);
assert.equal(identityMulti.roleKey, "PRINCIPAL");
assert.deepEqual(identityMulti.roleKeys, ["PRINCIPAL", "TEACHER"]);
assert.equal(identityMulti.roleLabel, "Directeur");
assert.equal(hasSecurityPermission(multiRole, "Élèves", "READ"), true);
assert.equal(hasSecurityPermission(multiRole, "Notes", "READ"), true);
assert.equal(hasSecurityPermission(multiRole, "Notes", "CREATE"), false);
assert.deepEqual(
  resolveEffectivePermissions("Directeur", ["Élèves:READ", "Notes:READ"], {
    Directeur: ["Utilisateurs:CRUD"],
    Enseignant: ["Notes:CREATE"],
  }).sort(),
  ["Élèves:READ", "Notes:READ"].sort(),
);

assert.equal(sessionRoleFromRoleKey("PRINCIPAL", "principal"), "principal");
assert.equal(sessionRoleFromRoleKey("PROVISEUR", "principal"), "proviseur");
assert.equal(sessionRoleFromRoleKey("ROLE_TEST_INCONNU", "ROLE_TEST_INCONNU"), "ROLE_TEST_INCONNU");

assert.equal(resolveRoleHomeKey({ role: "school_admin" }), "school_admin");
assert.equal(resolveRoleHomeKey({ role: "prefet" }), "prefet");
assert.equal(resolveRoleHomeKey({}), "unknown");

const countryAdminEmpty = liveSession({
  sessionRole: "country_admin",
  roleLabel: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: [],
  schoolCode: "*",
});
assert.equal(hasSecurityPermission(countryAdminEmpty, "Messages", "READ"), false);
assert.equal(hasSecurityPermission(countryAdminEmpty, "Notifications", "READ"), false);
assert.equal(canReadRoute(countryAdminEmpty, "Messages"), false);
assert.equal(canReadView(countryAdminEmpty, "Messages"), false);
assert.equal(canReadView(countryAdminEmpty, "Announcements"), false);
assert.equal(canReadView(countryAdminEmpty, "PlatformNotifications"), false);

const countryAdminMessages = liveSession({
  sessionRole: "country_admin",
  roleLabel: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["Messages:READ"],
  schoolCode: "*",
});
assert.equal(hasSecurityPermission(countryAdminMessages, "Messages", "READ"), true);
assert.equal(hasSecurityPermission(countryAdminMessages, "Notifications", "READ"), false);
assert.equal(canReadRoute(countryAdminMessages, "Messages"), true);
assert.equal(canReadView(countryAdminMessages, "Messages"), true);
assert.equal(canReadView(countryAdminMessages, "Announcements"), false);

const countryAdminNotifications = liveSession({
  sessionRole: "country_admin",
  roleLabel: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["Notifications:READ"],
  schoolCode: "*",
});
assert.equal(hasSecurityPermission(countryAdminNotifications, "Notifications", "READ"), true);
assert.equal(hasSecurityPermission(countryAdminNotifications, "Messages", "READ"), false);
assert.equal(canReadView(countryAdminNotifications, "Announcements"), true);
assert.equal(canReadView(countryAdminNotifications, "PlatformNotifications"), false);
assert.equal(canReadRoute(countryAdminNotifications, "Messages"), false);

const countryAdminPrivileges = liveSession({
  sessionRole: "country_admin",
  roleLabel: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES"],
  schoolCode: "*",
});
assert.equal(canReadView(countryAdminPrivileges, "PlatformNotifications"), true);
assert.equal(canReadRoute(countryAdminPrivileges, "PlatformNotifications"), true);

const schoolNotificationsRead = liveSession({
  sessionRole: "principal",
  roleLabel: "Directeur",
  roleKeys: ["PRINCIPAL"],
  permissions: ["Notifications:READ"],
});
assert.equal(canReadView(schoolNotificationsRead, "Announcements"), true);
assert.equal(canReadView(schoolNotificationsRead, "PlatformNotifications"), false);
assert.equal(canReadRoute(schoolNotificationsRead, "PlatformNotifications"), false);

const fallbackWithoutRoleKeys = resolveCanonicalRoleIdentity({
  role: "principal",
  roleLabel: "Directeur",
  user: { role: "Directeur" },
});
assert.equal(fallbackWithoutRoleKeys.roleKey, "PRINCIPAL");
assert.deepEqual(fallbackWithoutRoleKeys.roleKeys, ["PRINCIPAL"]);

const explicitEmptyRoleKeys = resolveCanonicalRoleIdentity({
  role: "principal",
  roleLabel: "Directeur",
  roleKey: "PRINCIPAL",
  roleKeys: [],
  user: {
    role: "Directeur",
    roleKey: "PRINCIPAL",
    roleKeys: [],
  },
});
assert.deepEqual(explicitEmptyRoleKeys.roleKeys, []);
assert.equal(explicitEmptyRoleKeys.roleKey, "");
assert.equal(explicitEmptyRoleKeys.roleLabel, "Sans affectation");
assert.equal(explicitEmptyRoleKeys.sessionRole, "unassigned");
assert.notEqual(explicitEmptyRoleKeys.roleKey, "PRINCIPAL");
assert.deepEqual(explicitEmptyRoleKeys.permissions, []);

console.log("mobileCanonicalRoleIdentity.test.ts OK");
