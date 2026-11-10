"use strict";

/**
 * MONO-FIX-A4 — identité de classe des évaluations (serveur réel, base jetable).
 *
 * POST et PATCH /api/evaluations : classId, puis classCode, puis className
 * (nom accepté seulement s'il est non ambigu dans l'établissement, avec
 * restriction à l'année scolaire ouverte en cas d'homonymes). Identifiants
 * contradictoires, inconnus ou d'un autre établissement : refus explicite,
 * aucune évaluation ni note écrite. Affectations enseignant inchangées.
 *
 * Données : démo CD-2026-0001 (trois « 6ème A » dans la même année) ;
 * l'enseignant patrick.ilunga@somafrik.cd enseigne Sciences en
 * CLS-2026-000035 (6ème A) et CLS-2026-000040 (5ème A), pas en CLS-2026-000036.
 * Ajouts SQL de test : « A4 Unique » (nom unique), « A4 Années » dans l'année
 * ouverte ET dans une année close de CD, et une classe dans BI-2026-0002.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus } = require("./monoT1HttpHarness");

let server = null;
const ids = {};

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_a4_resolution_it", port: 19979 });
  await server.assertActiveSubscriptionPrecondition();
  assertStatus(
    await server.request("POST", "/api/evaluation-types", { token: await server.login("cdAdmin"), body: { code: "devoir", name: "Devoir" } }),
    201,
    "précondition : type d'évaluation",
  );
  const rows = await server.pool.query(
    "SELECT class_code, id::text AS id FROM classes WHERE class_code IN ('CLS-2026-000035', 'CLS-2026-000036', 'CLS-2026-000040')",
  );
  for (const row of rows.rows) ids[row.class_code] = row.id;

  // Toutes les classes de l'enseignant ont des homonymes dans la démo : classes
  // dédiées pour le nom unique et pour deux années scolaires différentes.
  const cd = await server.one("SELECT id FROM schools WHERE school_code = 'CD-2026-0001'");
  const openYear = await server.one(
    `SELECT id FROM academic_years WHERE school_id = $1 AND status IN ('active', 'open')
     ORDER BY is_current DESC, created_at DESC LIMIT 1`,
    [cd.id],
  );
  const closedYear = await server.one(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2024-2025', '2024-09-01', '2025-07-31', false, 'closed') RETURNING id`,
    [cd.id],
  );
  await server.pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES
       ($1, $2, 'CLS-TEST-A4-UNIQUE', 'A4 Unique'),
       ($1, $2, 'CLS-TEST-A4-OPEN', 'A4 Années'),
       ($1, $3, 'CLS-TEST-A4-CLOSED', 'A4 Années')`,
    [cd.id, openYear.id, closedYear.id],
  );
  // Classe d'un autre établissement.
  const bi = await server.one("SELECT id FROM schools WHERE school_code = 'BI-2026-0002'");
  const biYear =
    (await server.one("SELECT id FROM academic_years WHERE school_id = $1 ORDER BY created_at LIMIT 1", [bi.id])) ??
    (await server.one(
      `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
       VALUES ($1, '2025-2026', '2025-09-01', '2026-07-31', true, 'active') RETURNING id`,
      [bi.id],
    ));
  const biClass = await server.one(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1, $2, 'CLS-TEST-A4-BI', '6ème A') RETURNING id::text AS id`,
    [bi.id, biYear.id],
  );
  ids.BI = biClass.id;
});

after(async () => {
  if (server) await server.stop();
});

const writes = async () =>
  JSON.stringify([
    await server.snapshot("SELECT id, class_id, title FROM evaluations ORDER BY id"),
    await server.snapshot("SELECT id FROM grades ORDER BY id"),
  ]);

async function createAs(accountKey, classFields, title) {
  return server.request("POST", "/api/evaluations", {
    token: await server.login(accountKey),
    body: { subject: "Sciences", period: "Trimestre 1", maxScore: 20, evaluationType: "devoir", title, ...classFields },
  });
}

async function storedClassCode(evaluationId) {
  const row = await server.one(
    "SELECT c.class_code FROM evaluations e JOIN classes c ON c.id = e.class_id WHERE e.id::text = $1",
    [String(evaluationId)],
  );
  return row?.class_code ?? null;
}

async function assertRefused(response, status, code, before, label) {
  assertStatus(response, status, label);
  assert.equal(response.data?.code, code, `${label} : code`);
  assert.equal(await writes(), before, `${label} : aucune évaluation ni note écrite`);
}

test("création valide : classId, classCode, nom unique et identifiants concordants ⇒ classe exacte", { skip }, async () => {
  const cases = [
    ["classId", { classId: ids["CLS-2026-000035"] }, "CLS-2026-000035"],
    ["classId = class_code (historique)", { classId: "CLS-2026-000035" }, "CLS-2026-000035"],
    ["classCode", { classCode: "CLS-2026-000040" }, "CLS-2026-000040"],
    ["classCode, casse différente", { classCode: "cls-2026-000040" }, "CLS-2026-000040"],
    ["classId + classCode + nom concordants", { classId: ids["CLS-2026-000035"], classCode: "CLS-2026-000035", className: "6eme a" }, "CLS-2026-000035"],
  ];
  for (const [label, fields, expected] of cases) {
    const response = await createAs("cdTeacher", fields, `A4 ${label}`);
    assertStatus(response, 201, label);
    assert.equal(await storedClassCode(response.data?.id), expected, `${label} : classe enregistrée`);
  }
});

test("nom seul (préfet des études) : nom unique conservé ; homonymes d'années différentes départagés par l'année ouverte", { skip }, async () => {
  const cases = [
    ["nom unique (compatibilité historique)", { className: "A4 Unique" }, "CLS-TEST-A4-UNIQUE"],
    ["nom unique, accents et casse", { className: "a4 unique" }, "CLS-TEST-A4-UNIQUE"],
    ["homonymes ouverte / close", { className: "A4 Annees" }, "CLS-TEST-A4-OPEN"],
  ];
  for (const [label, fields, expected] of cases) {
    const response = await createAs("cdPrefet", fields, `A4 ${label}`);
    assertStatus(response, 201, label);
    assert.equal(await storedClassCode(response.data?.id), expected, `${label} : classe enregistrée`);
  }
});

test("nom ambigu seul (trois « 6ème A » la même année) : 409 EVAL_ATTACHMENT_CLASS_AMBIGUOUS, aucune écriture", { skip }, async () => {
  const before = await writes();
  for (const name of ["6ème A", "6EME A", " 6ème a "]) {
    await assertRefused(await createAs("cdTeacher", { className: name }, "A4 ambigu"), 409, "EVAL_ATTACHMENT_CLASS_AMBIGUOUS", before, `nom « ${name} »`);
  }
});

test("identifiants contradictoires : 400 EVAL_ATTACHMENT_CLASS_CONFLICT, aucun n'est ignoré, aucune écriture", { skip }, async () => {
  const before = await writes();
  const cases = [
    ["classId ≠ classCode", { classId: ids["CLS-2026-000035"], classCode: "CLS-2026-000040" }],
    ["classId ≠ nom", { classId: ids["CLS-2026-000040"], className: "6ème A" }],
    ["classCode ≠ nom", { classCode: "CLS-2026-000035", className: "5ème A" }],
  ];
  for (const [label, fields] of cases) {
    await assertRefused(await createAs("cdTeacher", fields, `A4 ${label}`), 400, "EVAL_ATTACHMENT_CLASS_CONFLICT", before, label);
  }
});

test("identifiant inconnu : refus sans repli sur le nom ; classe d'un autre établissement : même refus, aucune fuite", { skip }, async () => {
  const before = await writes();
  const unknownId = await createAs("cdTeacher", { classId: "00000000-0000-4000-8000-000000000000", className: "A4 Unique" }, "A4 id inconnu");
  await assertRefused(unknownId, 400, "EVAL_ATTACHMENT_CLASS", before, "classId inconnu + nom valide");
  await assertRefused(
    await createAs("cdTeacher", { classCode: "CLS-INCONNU", className: "A4 Unique" }, "A4 code inconnu"),
    400,
    "EVAL_ATTACHMENT_CLASS",
    before,
    "classCode inconnu + nom valide",
  );
  for (const [label, fields] of [
    ["classId BI", { classId: ids.BI }],
    ["classCode BI", { classCode: "CLS-TEST-A4-BI" }],
  ]) {
    const response = await createAs("cdTeacher", fields, `A4 ${label}`);
    await assertRefused(response, 400, "EVAL_ATTACHMENT_CLASS", before, label);
    assert.doesNotMatch(response.text, /BI-2026-0002|Bujumbura|6ème A/, `${label} : aucune donnée de l'autre établissement`);
  }
  assert.equal(
    await server.one("SELECT count(*)::int AS n FROM evaluations e JOIN classes c ON c.id = e.class_id WHERE c.class_code = 'CLS-TEST-A4-BI'").then((row) => row.n),
    0,
  );
});

test("classe hors affectation de l'enseignant : 403 TEACHER_ASSIGNMENT_REQUIRED (règle inchangée), aucune écriture", { skip }, async () => {
  const before = await writes();
  for (const fields of [{ classId: ids["CLS-2026-000036"] }, { classCode: "CLS-2026-000036" }]) {
    await assertRefused(await createAs("cdTeacher", fields, "A4 hors affectation"), 403, "TEACHER_ASSIGNMENT_REQUIRED", before, JSON.stringify(fields));
  }
});

test("mise à jour : la classe est conservée par identifiant ; changement contradictoire ou inconnu refusé sans modification", { skip }, async () => {
  const created = await createAs("cdTeacher", { classId: ids["CLS-2026-000035"] }, "A4 pour PATCH");
  assertStatus(created, 201, "création");
  const evaluationId = created.data.id;
  const patch = async (body) =>
    server.request("PATCH", `/api/evaluations/${evaluationId}`, { token: await server.login("cdTeacher"), body });

  assertStatus(await patch({ title: "A4 titre modifié" }), 200, "PATCH titre seul");
  assert.equal(await storedClassCode(evaluationId), "CLS-2026-000035", "classe inchangée malgré trois homonymes");

  const before = await writes();
  await assertRefused(await patch({ className: "6ème A" }), 409, "EVAL_ATTACHMENT_CLASS_AMBIGUOUS", before, "PATCH nom ambigu");
  await assertRefused(await patch({ classId: ids["CLS-2026-000035"], classCode: "CLS-2026-000040" }), 400, "EVAL_ATTACHMENT_CLASS_CONFLICT", before, "PATCH contradictoire");
  await assertRefused(await patch({ classCode: "CLS-INCONNU" }), 400, "EVAL_ATTACHMENT_CLASS", before, "PATCH classCode inconnu");

  assertStatus(await patch({ classCode: "CLS-2026-000040" }), 200, "PATCH vers une autre classe affectée, par code");
  assert.equal(await storedClassCode(evaluationId), "CLS-2026-000040");
});
