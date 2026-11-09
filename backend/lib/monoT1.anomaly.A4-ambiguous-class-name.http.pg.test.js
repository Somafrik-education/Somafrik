"use strict";

/**
 * ANOMALIE-MONO-T1-A4 — nom de classe ambigu résolu arbitrairement.
 *
 * CORRIGÉE par MONO-FIX-A4 : test de non-régression, exécuté normalement par la
 * baseline pg (retiré de manifest › expectedFailures).
 * Adaptation MONO-FIX-A4 : la requête de refus ne porte plus de classCode. Le
 * mandat A4 fait de classCode un identifiant canonique (« classCode valide :
 * sélectionner exactement la classe ») ; l'assertion de sécurité est conservée
 * pour le NOM SEUL (refus explicite, aucune écriture), et le cas classCode
 * vérifie désormais que la classe EXACTE est retenue.
 *
 * Constat : la création d'évaluation résout la classe par classId, sinon par
 * nom (PostgresRepository.findClassByNormalizedName : ORDER BY created_at DESC
 * LIMIT 1). La démo compte trois « 6ème A » créées au même instant : le choix
 * est arbitraire (201 sur l'une, 403 « affectation requise » sur une autre,
 * selon la base), et le classCode fourni est ignoré. Attendu : un nom ambigu
 * sans classId est refusé explicitement (400/409), sans écriture.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus } = require("./monoT1HttpHarness");

let server = null;

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_anomaly_a4_it", port: 19974 });
  await server.assertActiveSubscriptionPrecondition();
  assertStatus(
    await server.request("POST", "/api/evaluation-types", { token: await server.login("cdAdmin"), body: { code: "devoir", name: "Devoir" } }),
    201,
    "précondition : type d'évaluation",
  );
});

after(async () => {
  if (server) await server.stop();
});

test("ANOMALIE-MONO-T1-A4 : un nom de classe ambigu sans classId est refusé explicitement, sans écriture", { skip }, async () => {
  const homonyms = await server.one(
    `SELECT count(*)::int AS n FROM classes c JOIN schools s ON s.id = c.school_id
     WHERE s.school_code = 'CD-2026-0001' AND c.name = '6ème A'`,
  );
  assert.ok(homonyms.n > 1, "précondition : plusieurs classes « 6ème A »");
  const before = await server.snapshot("SELECT id FROM evaluations ORDER BY id");
  const response = await server.request("POST", "/api/evaluations", {
    token: await server.login("cdTeacher"),
    body: {
      className: "6ème A",
      subject: "Sciences",
      period: "Trimestre 1",
      title: "MONO-T1 A4",
      maxScore: 20,
      evaluationType: "devoir",
    },
  });
  const unchanged = (await server.snapshot("SELECT id FROM evaluations ORDER BY id")) === before;
  assert.ok(
    [400, 409].includes(response.status) && unchanged,
    `ANOMALIE-MONO-T1-A4 : nom ambigu (${homonyms.n} « 6ème A ») → HTTP ${response.status} ${String(response.data?.code ?? "")}, écriture ${unchanged ? "aucune" : "effectuée"}`,
  );
});

test("A4 : nom ambigu accompagné d'un classCode ⇒ la classe EXACTE désignée par le code, jamais un homonyme", { skip }, async () => {
  const response = await server.request("POST", "/api/evaluations", {
    token: await server.login("cdTeacher"),
    body: {
      className: "6ème A",
      classCode: "CLS-2026-000035",
      subject: "Sciences",
      period: "Trimestre 1",
      title: "MONO-T1 A4 classCode",
      maxScore: 20,
      evaluationType: "devoir",
    },
  });
  assertStatus(response, 201, "classCode canonique");
  const stored = await server.one(
    "SELECT c.class_code FROM evaluations e JOIN classes c ON c.id = e.class_id WHERE e.id::text = $1",
    [String(response.data?.id)],
  );
  assert.equal(stored?.class_code, "CLS-2026-000035");
});
