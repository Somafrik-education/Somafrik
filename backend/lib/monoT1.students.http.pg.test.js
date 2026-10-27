"use strict";

/**
 * MONO-T1 / C — élèves et inscriptions (serveur réel, base jetable, démo seed).
 *
 * Consultation, création (inscription dans une classe), modification
 * (contrôle de concurrence expectedUpdatedAt), suppression (archivage) et
 * lectures dérivées (notes, paiements) : autorisé, anonyme, permission
 * insuffisante, interétablissement (aucune fuite d'existence), entrée
 * invalide, absence d'écriture en cas de refus.
 *
 * Fixture : abonnement actif (cf. anomalie MONO-T1-A2 dans le harnais).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus } = require("./monoT1HttpHarness");

let server = null;
let createdCode = null;
// Élève de 6ème A (CLS-2026-000035), classe affectée à l'enseignant de démonstration.
const STUDENT = "CD-IN-EL-26-004";
const ASSIGNED_STUDENT = "CD-IN-EL-26-001";
// Élève d'une classe (1ère B) non affectée à cet enseignant.
const UNASSIGNED_STUDENT = "CD-IN-EL-26-005";
const CLASS_CODE = "CLS-2026-000035";

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_students_it", port: 19963 });
  await server.applyActiveSubscriptionFixture();
});

after(async () => {
  if (server) await server.stop();
});

const studentRow = (code) =>
  server.snapshot(
    `SELECT student_code, first_name, last_name, status, to_jsonb(s) - 'updated_at' - 'created_at' AS rest
     FROM students s WHERE student_code = $1`,
    [code],
  );
const studentCount = () => server.snapshot("SELECT count(*)::int AS n FROM students");

test("liste : établissement borné ; autre établissement vide ; parent limité aux enfants liés ; anonyme 401", { skip }, async () => {
  const cd = await server.request("GET", "/api/students", { token: await server.login("cdAdmin") });
  assertStatus(cd, 200, "admin CD");
  const activeCodes = (
    await server.pool.query(
      `SELECT s.student_code FROM students s JOIN schools sc ON sc.id = s.school_id
       WHERE sc.school_code = 'CD-2026-0001' AND s.status = 'active' ORDER BY 1`,
    )
  ).rows.map((row) => row.student_code);
  assert.ok(activeCodes.length > 0);
  assert.deepEqual(cd.data.map((student) => student.studentCode).sort(), activeCodes, "exactement les élèves actifs de CD (archivés exclus)");
  const cdLoginCode = await server.loginCode("CD-2026-0001");
  assert.ok(cd.data.every((student) => student.schoolCode === cdLoginCode), "uniquement des élèves de CD");
  const bi = await server.request("GET", "/api/students", { token: await server.login("biAdmin") });
  assertStatus(bi, 200, "admin BI");
  assert.deepEqual(bi.data, [], "aucun élève de CD visible depuis BI");
  const parent = await server.request("GET", "/api/students", { token: await server.login("cdParent") });
  assertStatus(parent, 200, "parent");
  assert.deepEqual(parent.data, [], "parent de démonstration sans enfant lié : liste vide");
  assertStatus(await server.request("GET", "/api/students"), 401, "anonyme");
  assertStatus(await server.request("GET", "/api/students", { token: await server.login("superAdmin") }), 403, "superadmin (données personnelles)");
});

test("fiche : lecture autorisée ; autre établissement, parent non lié, classe non affectée ⇒ 404 sans fuite", { skip }, async () => {
  assertStatus(await server.request("GET", `/api/students/${STUDENT}`, { token: await server.login("cdAdmin") }), 200, "admin CD");
  assertStatus(
    await server.request("GET", `/api/students/${ASSIGNED_STUDENT}`, { token: await server.login("cdTeacher") }),
    200,
    "enseignant, classe affectée",
  );
  const unknown = await server.request("GET", "/api/students/CD-IN-EL-26-999", { token: await server.login("biAdmin") });
  const cross = await server.request("GET", `/api/students/${STUDENT}`, { token: await server.login("biAdmin") });
  assertStatus(cross, 404, "admin BI → élève CD");
  assert.deepEqual(cross.data, unknown.data, "même réponse qu'un élève inexistant : aucune fuite d'existence");
  assertStatus(await server.request("GET", `/api/students/${STUDENT}`, { token: await server.login("cdParent") }), 404, "parent non lié");
  assertStatus(
    await server.request("GET", `/api/students/${UNASSIGNED_STUDENT}`, { token: await server.login("cdTeacher") }),
    404,
    "enseignant, classe non affectée",
  );
});

test("modification : autorisée avec expectedUpdatedAt ; périmée 409 ; invalide 400 ; refus sans écriture", { skip }, async () => {
  const admin = await server.login("cdAdmin");
  const current = await server.request("GET", `/api/students/${STUDENT}`, { token: admin });
  const before = await studentRow(STUDENT);
  const refusals = [
    ["sans expectedUpdatedAt", "cdAdmin", { address: "Sans version" }, 400],
    ["date de naissance invalide", "cdAdmin", { birthDate: "pas-une-date", expectedUpdatedAt: current.data.updatedAt }, 400],
    ["prénom vide", "cdAdmin", { firstName: "", expectedUpdatedAt: current.data.updatedAt }, 400],
    ["admin BI", "biAdmin", { firstName: "Intrus", expectedUpdatedAt: current.data.updatedAt }, 404],
    ["enseignant", "cdTeacher", { firstName: "Prof", expectedUpdatedAt: current.data.updatedAt }, 403],
    ["anonyme", null, { firstName: "Anonyme", expectedUpdatedAt: current.data.updatedAt }, 401],
  ];
  for (const [label, account, body, status] of refusals) {
    const response = await server.request("PATCH", `/api/students/${STUDENT}`, {
      token: account && (await server.login(account)),
      body,
    });
    assertStatus(response, status, label);
  }
  assert.equal(await studentRow(STUDENT), before, "aucune écriture après refus");

  const updated = await server.request("PATCH", `/api/students/${STUDENT}`, {
    token: admin,
    body: { address: "Avenue MONO-T1", expectedUpdatedAt: current.data.updatedAt },
  });
  assertStatus(updated, 200, "modification autorisée");
  assert.equal((await server.one("SELECT address FROM students WHERE student_code = $1", [STUDENT])).address, "Avenue MONO-T1");
  const stale = await server.request("PATCH", `/api/students/${STUDENT}`, {
    token: admin,
    body: { address: "Version périmée", expectedUpdatedAt: current.data.updatedAt },
  });
  assertStatus(stale, 409, "version périmée");
  assert.equal((await server.one("SELECT address FROM students WHERE student_code = $1", [STUDENT])).address, "Avenue MONO-T1");
});

test("création (inscription) : autorisée ; classe d'un autre établissement, enseignant, entrée invalide ⇒ refus sans écriture", { skip }, async () => {
  const before = await studentCount();
  const refusals = [
    ["admin BI → classe CD", "biAdmin", { firstName: "Intrus", lastName: "BI", gender: "Féminin" }, 404],
    ["enseignant", "cdTeacher", { firstName: "X", lastName: "Y", gender: "Féminin" }, 403],
    ["anonyme", null, { firstName: "X", lastName: "Y", gender: "Féminin" }, 401],
    ["prénom manquant", "cdAdmin", { lastName: "Y", gender: "Féminin" }, 400],
    ["genre invalide", "cdAdmin", { firstName: "X", lastName: "Y", gender: "F" }, 400],
  ];
  for (const [label, account, body, status] of refusals) {
    const response = await server.request("POST", `/api/classes/${CLASS_CODE}/students`, {
      token: account && (await server.login(account)),
      body,
    });
    assertStatus(response, status, label);
  }
  assert.equal(await studentCount(), before, "aucun élève créé après refus");

  const created = await server.request("POST", `/api/classes/${CLASS_CODE}/students`, {
    token: await server.login("cdAdmin"),
    body: { firstName: "Mono", lastName: "Teun", gender: "Féminin" },
  });
  assertStatus(created, 201, "inscription autorisée");
  const code = created.data.student.studentCode;
  assert.equal(created.data.student.classCode, CLASS_CODE);
  assert.doesNotMatch(created.text, /password_hash|pin_hash|\$2[aby]\$/, "aucun hachage exposé");
  const row = await server.one(
    `SELECT s.status, sc.school_code FROM students s JOIN schools sc ON sc.id = s.school_id WHERE s.student_code = $1`,
    [code],
  );
  assert.deepEqual(row, { status: "active", school_code: "CD-2026-0001" });
  createdCode = code;
});

test("suppression : refus interétablissement/enseignant sans écriture ; autorisée = archivage (fiche conservée)", { skip }, async () => {
  assert.ok(createdCode, "élève créé au test précédent");
  const before = await studentRow(createdCode);
  assertStatus(await server.request("DELETE", `/api/students/${createdCode}`, { token: await server.login("biAdmin") }), 404, "admin BI");
  assertStatus(await server.request("DELETE", `/api/students/${createdCode}`, { token: await server.login("cdTeacher") }), 403, "enseignant");
  assertStatus(await server.request("DELETE", `/api/students/${createdCode}`), 401, "anonyme");
  assert.equal(await studentRow(createdCode), before, "aucune écriture après refus");
  const deleted = await server.request("DELETE", `/api/students/${createdCode}`, { token: await server.login("cdAdmin") });
  assertStatus(deleted, 200, "suppression autorisée");
  assert.equal(deleted.data.status, "archived");
  assert.equal((await server.one("SELECT status FROM students WHERE student_code = $1", [createdCode])).status, "archived");
});

test("lectures dérivées : paiements et notes d'un élève de CD vides depuis BI (aucune fuite)", { skip }, async () => {
  const cdPayments = await server.request("GET", `/api/students/${ASSIGNED_STUDENT}/payments`, { token: await server.login("cdAdmin") });
  assertStatus(cdPayments, 200, "paiements, admin CD");
  assert.ok(cdPayments.data.length > 0, "le seed contient des paiements");
  for (const suffix of ["payments", "notes"]) {
    const cross = await server.request("GET", `/api/students/${ASSIGNED_STUDENT}/${suffix}`, { token: await server.login("biAdmin") });
    assertStatus(cross, [200, 403, 404], `${suffix}, admin BI`);
    if (cross.status === 200) assert.deepEqual(cross.data, [], `${suffix} : aucune donnée de CD`);
  }
});
