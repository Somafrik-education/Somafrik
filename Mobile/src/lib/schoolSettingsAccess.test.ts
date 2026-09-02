import assert from "node:assert/strict";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { canReadRoute, canReadView } from "../domain/security/permissions";
import { getAllowedRoleDrawerItems } from "../navigation/roleDrawerPreferences";
import { isSchoolSettingsOperator } from "./schoolSettingsAccess";

function liveSession(input: {
  sessionRole?: string;
  roleLabel?: string;
  roleKeys?: string[];
  permissions: string[];
}) {
  return attachCanonicalRoleIdentity({
    role: input.sessionRole,
    permissions: input.permissions,
    user: {
      id: "user-settings",
      name: "Compte test",
      schoolCode: "CD-IN-26-001",
      role: input.roleLabel,
      roleKeys: input.roleKeys,
      permissions: input.permissions,
    },
  });
}

const settingsRead = ["Paramètres Établissement:READ"];
const settingsWrite = ["Paramètres Établissement:READ", "Paramètres Établissement:UPDATE"];

const adminSchool = liveSession({
  sessionRole: "school_admin",
  roleLabel: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: settingsWrite,
});

const prefet = liveSession({
  sessionRole: "prefet",
  roleLabel: "Préfet des études",
  roleKeys: ["PREFET_ETUDES"],
  permissions: settingsRead,
});

const teacher = liveSession({
  sessionRole: "teacher",
  roleLabel: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: settingsRead,
});

const parent = liveSession({
  sessionRole: "parent_student",
  roleLabel: "Parent",
  roleKeys: ["PARENT"],
  permissions: settingsRead,
});

const student = liveSession({
  sessionRole: "student",
  roleLabel: "Élève / Étudiant",
  roleKeys: ["STUDENT"],
  permissions: settingsRead,
});

const countryAdmin = liveSession({
  sessionRole: "country_admin",
  roleLabel: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES", ...settingsWrite],
});

assert.equal(isSchoolSettingsOperator(adminSchool), true);
assert.equal(isSchoolSettingsOperator(prefet), false);
assert.equal(isSchoolSettingsOperator(teacher), false);
assert.equal(isSchoolSettingsOperator(parent), false);
assert.equal(isSchoolSettingsOperator(student), false);
assert.equal(isSchoolSettingsOperator(countryAdmin), false);

for (const view of [
  "Configuration",
  "EstablishmentProfile",
  "SchoolYearSettings",
  "SchoolPedagogicalStructure",
  "SchoolAssignableRoles",
] as const) {
  assert.equal(canReadView(adminSchool, view), true, `Admin School doit lire ${view}`);
  assert.equal(canReadRoute(adminSchool, view), true, `Admin School doit ouvrir ${view}`);
  assert.equal(canReadView(prefet, view), false, `Préfet ne doit pas ouvrir ${view} avec Paramètres:READ`);
  assert.equal(canReadRoute(prefet, view), false, `Préfet canReadRoute(${view}) doit rester fermé`);
  assert.equal(canReadView(teacher, view), false, `Enseignant ne doit pas ouvrir ${view}`);
  assert.equal(canReadView(parent, view), false, `Parent ne doit pas ouvrir ${view}`);
  assert.equal(canReadView(student, view), false, `Élève ne doit pas ouvrir ${view}`);
  assert.equal(canReadView(countryAdmin, view), false, `Admin Pays ne doit pas ouvrir ${view}`);
}

const adminLabels = getAllowedRoleDrawerItems(adminSchool).map((item) => item.label);
assert.ok(adminLabels.includes("Paramètres"), "drawer Admin School : Paramètres");
assert.ok(adminLabels.includes("Structure pédagogique"), "drawer Admin School : Structure pédagogique");
assert.equal(
  adminLabels.includes("Référentiels pédagogiques"),
  false,
  "le catalogue national ne doit pas apparaître dans le drawer Admin School",
);

const prefetLabels = getAllowedRoleDrawerItems(prefet).map((item) => item.label);
assert.equal(prefetLabels.includes("Paramètres"), false);
assert.equal(prefetLabels.includes("Structure pédagogique"), false);

const teacherLabels = getAllowedRoleDrawerItems(teacher).map((item) => item.label);
assert.equal(teacherLabels.includes("Paramètres"), false);
assert.equal(teacherLabels.includes("Structure pédagogique"), false);

console.log("schoolSettingsAccess.test.ts OK");
