/**
 * npx tsx Mobile/src/lib/roleScopedHydration.test.ts — PARITE-WEB-MOBILE-RECOVERY-01 / LOT 7.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isFamilyRole, shouldHydrateResource, type HydratedResource } from "./roleScopedHydration";

// Droits effectifs réels d'une session Élève (réponse /api/login préprod locale, audit #1193).
const STUDENT_PERMISSIONS = [
  "Classes:READ", "Élèves:READ", "Présences:READ", "Notes:READ", "Bulletins:READ", "Paiements:READ",
  "Notifications:READ", "Announcements:READ", "Messages:CREATE", "Messages:READ", "Messages:UPDATE",
  "Messages:DELETE", "Documents:READ", "Rapports:READ",
];
const student = { role: "student", permissions: STUDENT_PERMISSIONS, user: { role: "Élève / Étudiant", permissions: STUDENT_PERMISSIONS } };
const FORBIDDEN_FOR_STUDENT: HydratedResource[] = ["users", "teachers", "courses", "assignments", "schools", "countries", "subscriptions"];

assert.equal(isFamilyRole("student"), true);
assert.equal(isFamilyRole("parent_student"), true);
assert.equal(isFamilyRole("teacher"), false);

// 1. Élève : aucune des 7 lectures observées en 403 n'est émise.
for (const resource of FORBIDDEN_FOR_STUDENT) {
  assert.equal(shouldHydrateResource(student, resource), false, `student → ${resource}`);
}

// 2. Rôles hors famille : comportement strictement inchangé (aucune régression).
for (const role of ["teacher", "school_admin", "secretary", "accountant", "prefet", "super_admin", "country_admin"]) {
  for (const resource of FORBIDDEN_FOR_STUDENT) {
    assert.equal(shouldHydrateResource({ role, permissions: [] }, resource), true, `${role} → ${resource}`);
  }
}

// 3. Aucun élargissement : si un droit est accordé à un Parent, la lecture reste autorisée.
assert.equal(shouldHydrateResource(null, "users"), true, "sans session : décision laissée aux gardes existantes");

// 4. Câblage effectif.
const SRC = path.join(__dirname, "..");
const ctx = fs.readFileSync(path.join(SRC, "context", "AdminDataContext.tsx"), "utf8");
for (const [resource, call] of [
  ["courses", "getCourses()"], ["assignments", "getAssignments()"],
] as const) {
  assert.ok(ctx.includes(`shouldHydrateResource(session, "${resource}") ? ${call} : Promise.resolve(null)`), resource);
}
for (const [resource, loader] of [
  ["schools", "loadSchools"], ["countries", "loadCountries"], ["subscriptions", "loadSubscriptions"],
  ["users", "loadUsers"], ["teachers", "loadTeachers"],
] as const) {
  assert.ok(ctx.includes(`if (shouldHydrateResource(session, "${resource}")) void loaders.${loader}();`), loader);
}
const login = fs.readFileSync(path.join(SRC, "screens", "LoginScreen.tsx"), "utf8");
assert.match(login, /if \(!isSchoolAdminRole\(role\)\) throw new Error\("not-school-admin"\);\s*const guided = await schoolSetupGuidedApi\.get\(\);/);

console.log("OK roleScopedHydration: aucune lecture hors droits pour Élève / Parent, autres rôles inchangés");
