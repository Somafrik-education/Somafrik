import assert from "node:assert/strict";
import {
  getAllowedRoleDrawerItems,
  getAllowedRoleDrawerSections,
  getRoleDrawerCatalog,
} from "../navigation/roleDrawerPreferences";
import { getRoleTabCatalog, partitionRoleTabCatalog } from "../navigation/roleTabCatalog";

function sessionOf(role: string, permissions?: string[]) {
  return permissions
    ? { role, permissions, user: { id: `${role}-1`, permissions } }
    : { role, user: { id: `${role}-1` } };
}

function drawerLabels(session: any) {
  return getAllowedRoleDrawerItems(session).map((item) => item.label);
}

function tabLabels(session: any) {
  return partitionRoleTabCatalog(session).visibleTabs.map((tab) => tab.label);
}

function tabRoutes(session: any) {
  return partitionRoleTabCatalog(session).visibleTabs.map((tab) => tab.route);
}

const schoolAdmin = sessionOf("school_admin");
const prefet = sessionOf("prefet");
const principal = sessionOf("principal");
const secretary = sessionOf("secretary");
const accountant = sessionOf("accountant");
const teacher = sessionOf("teacher");
const parent = sessionOf("parent_student");
const student = sessionOf("student");
const superAdmin = sessionOf("super_admin");
const countryAdmin = sessionOf("country_admin", ["COUNTRY_PRIVILEGES"]);
const adjoint = sessionOf("adjoint");
const supervisor = sessionOf("supervisor");

assert.notEqual(
  getRoleDrawerCatalog("school_admin").map((item) => item.label).join("|"),
  getRoleDrawerCatalog("accountant").map((item) => item.label).join("|"),
  "Admin School et Comptable ont des catalogues distincts",
);
assert.notEqual(
  getRoleDrawerCatalog("prefet").map((item) => item.label).join("|"),
  getRoleDrawerCatalog("secretary").map((item) => item.label).join("|"),
  "Préfet et Secrétaire ont des catalogues distincts",
);
assert.equal(getRoleDrawerCatalog("school_admin")[0]?.label, "Élèves");
assert.equal(getRoleDrawerCatalog("accountant")[0]?.label, "Paiements");
assert.equal(getRoleDrawerCatalog("prefet")[2]?.label, "Présences");
assert.equal(getRoleDrawerCatalog("secretary")[0]?.label, "Élèves");
assert.equal(getRoleDrawerCatalog("secretary")[1]?.label, "Présences");
assert.equal(getRoleDrawerCatalog("secretary")[2]?.label, "Paiements");

const schoolAdminLabels = drawerLabels(schoolAdmin);
assert.deepEqual(
  schoolAdminLabels.slice(0, 6),
  ["Élèves", "Classes", "Présences", "Paiements", "Enseignants", "Notes"],
);
assert.ok(schoolAdminLabels.indexOf("Utilisateurs") > schoolAdminLabels.indexOf("Paiements"));
assert.ok(schoolAdminLabels.indexOf("Paramètres") > schoolAdminLabels.indexOf("Utilisateurs"));
assert.ok(schoolAdminLabels.indexOf("Structure pédagogique") > schoolAdminLabels.indexOf("Paiements"));
assert.ok(schoolAdminLabels.indexOf("Structure pédagogique") < schoolAdminLabels.indexOf("Paramètres"));
assert.equal(schoolAdminLabels.includes("Appel"), false);
assert.equal(schoolAdminLabels.includes("Paiement mobile"), false);

const schoolAdminSections = getAllowedRoleDrawerSections(schoolAdmin);
assert.deepEqual(
  schoolAdminSections.map((section) => section.title),
  ["Quotidien", "Admin"],
);
assert.deepEqual(
  schoolAdminSections[0].items.map((item) => item.label).slice(0, 4),
  ["Élèves", "Classes", "Présences", "Paiements"],
);
assert.ok(schoolAdminSections[1].items.some((item) => item.label === "Paramètres"));
assert.ok(schoolAdminSections[1].items.some((item) => item.label === "Structure pédagogique"));

assert.deepEqual(tabLabels(schoolAdmin), ["Élèves", "Appel", "Frais", "Classes"]);
assert.deepEqual(tabRoutes(schoolAdmin), ["Students", "TeacherAttendance", "Payments", "Classes"]);
assert.equal(
  partitionRoleTabCatalog(schoolAdmin).visibleTabs.some((tab) => tab.label === "Comptes" || tab.label === "Profs"),
  false,
);

const prefetLabels = drawerLabels(prefet);
assert.deepEqual(prefetLabels.slice(0, 4), ["Élèves", "Classes", "Présences", "Notes"]);
assert.equal(prefetLabels.includes("Paiements"), false, "Préfet defaults : pas de Paiements:READ");
assert.equal(prefetLabels.includes("Paramètres"), false, "Préfet n’est pas opérateur Paramètres");
assert.ok(prefetLabels.indexOf("Utilisateurs") > prefetLabels.indexOf("Notes"));
assert.deepEqual(tabLabels(prefet), ["Classes", "Élèves", "Appel", "Notes"]);

assert.equal(drawerLabels(accountant)[0], "Paiements");
assert.ok(drawerLabels(accountant).includes("Élèves"));
assert.deepEqual(tabLabels(accountant), ["Frais", "Élèves"]);
assert.equal(
  getRoleTabCatalog("accountant").some((tab) => tab.route === "TeacherAttendance"),
  false,
  "Comptable : Appel absent du catalogue tabs",
);

const secretaryLabels = drawerLabels(secretary);
assert.deepEqual(secretaryLabels.slice(0, 3), ["Élèves", "Présences", "Paiements"]);
assert.ok(secretaryLabels.indexOf("Utilisateurs") > secretaryLabels.indexOf("Paiements"));
assert.deepEqual(tabLabels(secretary), ["Élèves", "Appel", "Frais", "Classes"]);

assert.deepEqual(drawerLabels(teacher).slice(0, 4), ["Mes classes", "Présences", "Notes", "Mes élèves"]);
assert.equal(drawerLabels(teacher).includes("Appel"), false);
assert.deepEqual(tabLabels(teacher), ["Classes", "Élèves", "Appel", "Notes"]);

assert.deepEqual(drawerLabels(parent).slice(0, 4), ["Notes", "Présences", "Bulletins", "Paiements"]);
assert.equal(drawerLabels(parent).includes("Paiement mobile"), false);
assert.deepEqual(tabLabels(parent), ["Profil", "Notes", "Présence", "Frais"]);

assert.deepEqual(drawerLabels(student).slice(0, 2), ["Notes", "Présences"]);
assert.equal(drawerLabels(student).includes("Paiements"), false, "Élève defaults : pas de Paiements:READ");
assert.equal(tabRoutes(student).includes("FraisEleve"), false);

assert.deepEqual(drawerLabels(superAdmin).slice(0, 4), [
  "Établissements",
  "Abonnements",
  "Utilisateurs",
  "Notifications",
]);
assert.equal(drawerLabels(superAdmin).includes("Classes"), false);
assert.equal(drawerLabels(superAdmin).includes("Paiements"), false);
assert.deepEqual(tabLabels(superAdmin), ["Comptes", "Notifs"]);
assert.deepEqual(tabRoutes(superAdmin), ["Users", "PlatformNotifications"]);
assert.equal(
  getRoleTabCatalog("super_admin").some((tab) => tab.route === "schools" || tab.route === "subscriptions"),
  false,
  "pas d’onglet Écoles/Offres tant que AdminCrud générique est fail-closed",
);

assert.deepEqual(drawerLabels(countryAdmin).slice(0, 4), [
  "Établissements",
  "Abonnements",
  "Utilisateurs",
  "Notifications",
]);
assert.equal(drawerLabels(countryAdmin).includes("Paramètres"), false);
assert.equal(drawerLabels(countryAdmin).includes("Droits par rôle"), false);
assert.deepEqual(tabLabels(countryAdmin), ["Comptes", "Notifs"]);
assert.equal(
  getRoleTabCatalog("country_admin").some((tab) => tab.route === "schools" || tab.route === "subscriptions"),
  false,
);

assert.equal(drawerLabels(supervisor).length, 0, "Surveillant : pas de defaults internes — menu vide volontaire");
assert.equal(tabLabels(supervisor).length, 0);

const adjointLabels = drawerLabels(adjoint);
assert.equal(adjointLabels[0], "Présences");
assert.ok(adjointLabels.includes("Élèves"));

const readOnlySchool = sessionOf("school_admin", ["Élèves:READ", "Classes:READ"]);
assert.deepEqual(drawerLabels(readOnlySchool), ["Élèves", "Classes"]);
assert.deepEqual(tabLabels(readOnlySchool), ["Élèves", "Classes"]);
assert.equal(drawerLabels(readOnlySchool).includes("Paramètres"), false);
assert.equal(drawerLabels(readOnlySchool).includes("Utilisateurs"), false);

const paymentsOnly = sessionOf("accountant", ["Paiements:READ"]);
assert.deepEqual(drawerLabels(paymentsOnly), ["Paiements"]);
assert.deepEqual(tabLabels(paymentsOnly), ["Frais"]);

const noStudentsPrefet = sessionOf("prefet", ["Présences:READ", "Notes:READ", "Classes:READ"]);
assert.equal(drawerLabels(noStudentsPrefet).includes("Élèves"), false);
assert.deepEqual(drawerLabels(noStudentsPrefet), ["Classes", "Présences", "Notes"]);

assert.equal(getAllowedRoleDrawerItems(sessionOf("school_admin", [])).length, 0, "permissions [] live = fail-closed, pas de defaults");

assert.ok(
  getRoleDrawerCatalog("principal").some((item) => item.label === "Paiements" && item.section === "quotidien"),
);
assert.ok(
  getRoleDrawerCatalog("school_admin").find((item) => item.label === "Paramètres")?.section === "admin",
);

for (const role of ["teacher", "parent_student", "student"] as const) {
  const titles = getAllowedRoleDrawerSections(sessionOf(role)).map((section) => section.title);
  assert.equal(titles.includes("Admin"), false, `${role} ne doit pas voir la section Admin`);
  assert.ok(titles.includes("Outils"), `${role} range Sync/Hors ligne/Support sous Outils`);
}

assert.deepEqual(
  getAllowedRoleDrawerSections(schoolAdmin).map((section) => section.title),
  ["Quotidien", "Admin"],
);

console.log("roleNavigationPreferences.test.ts OK");
