"use strict";

/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 1 — le refresh conserve le périmètre Élève.
 * Reproduction Android (émulateur, APK preview du HEAD develop) : après refresh, GET
 * /students/<id de l'élève> → 404 et /presences, /payments, /classes, /students vides,
 * parce que le jeton rafraîchi n'avait plus de claim `studentIds`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { AuthService } = require("../services/authService");
const { getPrincipalStudentIds } = require("./principalStudentIds");
const { resolveRefreshStudentScope } = require("./refreshStudentScope");

const SCHOOL = { id: "school-1", code: "SCH-T", loginCode: "CD-UK-26-001", status: "Actif", validationStatus: "Validé" };
const STUDENT_UUID = "7aee3095-c370-4784-a14e-811832979bfb";

function service() {
  return new AuthService({
    school: SCHOOL,
    schools: [SCHOOL],
    teachers: [],
    students: [
      { id: STUDENT_UUID, studentUuid: STUDENT_UUID, matricule: "CD-IN-EL-26-001", schoolCode: "SCH-T", userId: "U-STU" },
      { id: "other-student", studentUuid: "other-student", matricule: "CD-IN-EL-26-002", schoolCode: "SCH-T", userId: "U-OTHER" },
    ],
    userAccounts: [
      { id: "U-STU", identifier: "CD-IN-EL-26-001", role: "Élève / Étudiant", schoolCode: "SCH-T", accessChannel: "Application", status: "Actif" },
      { id: "U-NOLINK", identifier: "CD-IN-EL-26-999", role: "Élève / Étudiant", schoolCode: "SCH-T", accessChannel: "Application", status: "Actif" },
      { id: "U-TEA", identifier: "prof", role: "Enseignant", schoolCode: "SCH-T", accessChannel: "Application", status: "Actif" },
    ],
  });
}

test("Élève : le refresh recalcule exactement les studentIds de la connexion", () => {
  const auth = service();
  const atLogin = getPrincipalStudentIds({ role: "student", user: auth.buildManagedMobileUser(auth.userAccounts[0], "student") });
  const atRefresh = resolveRefreshStudentScope({ authService: auth, userId: "U-STU", sessionRole: "Élève / Étudiant", roleKeys: ["STUDENT"] });
  assert.deepEqual(atRefresh, { studentIds: atLogin });
  assert.deepEqual(atRefresh.studentIds, [STUDENT_UUID, "CD-IN-EL-26-001"]);
  assert.ok(!atRefresh.studentIds.includes("other-student"), "jamais l'élève d'un autre compte");
});

test("Élève sans fiche liée ou compte inconnu : périmètre vide (fail-closed, comme à la connexion)", () => {
  const auth = service();
  assert.deepEqual(resolveRefreshStudentScope({ authService: auth, userId: "U-NOLINK", sessionRole: "Élève / Étudiant", roleKeys: ["STUDENT"] }), { studentIds: [] });
  assert.deepEqual(resolveRefreshStudentScope({ authService: auth, userId: "U-ABSENT", sessionRole: "Élève / Étudiant", roleKeys: ["STUDENT"] }), { studentIds: [] });
  assert.deepEqual(resolveRefreshStudentScope({ authService: null, userId: "U-STU", sessionRole: "Élève / Étudiant", roleKeys: ["STUDENT"] }), { studentIds: [] });
});

test("Autres rôles : aucun champ ajouté (Enseignant et Parent gardent leurs mécanismes existants)", () => {
  const auth = service();
  assert.deepEqual(resolveRefreshStudentScope({ authService: auth, userId: "U-TEA", sessionRole: "Enseignant", roleKeys: ["TEACHER"] }), {});
  assert.deepEqual(resolveRefreshStudentScope({ authService: auth, userId: "U-STU", sessionRole: "Parent", roleKeys: ["PARENT"] }), {});
});

test("issueRefreshedAccessToken fusionne le périmètre Élève dans le jeton rafraîchi", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const body = server.slice(server.indexOf("async function issueRefreshedAccessToken"));
  const fn = body.slice(0, body.indexOf("\n}\n"));
  assert.match(fn, /resolveRefreshStudentScope\(\{/);
  assert.match(fn, /\.\.\.assignmentFields,\s*\.\.\.studentScopeFields,\s*\}\);/);
});
