"use strict";

/**
 * ANOMALIE-MONO-T1-A3 — statut de présence inconnu enregistré « absent ».
 *
 * Échec ATTENDU (manifeste › expectedFailures) : test du comportement correct.
 *
 * Constat : POST /api/presences accepte un statut inconnu (201) ; le dépôt
 * (PostgresRepository.toAttendanceStatus) le convertit en « absent » et
 * écrase l'appel existant. Attendu : 400, aucune écriture.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus } = require("./monoT1HttpHarness");

let server = null;
const CLASS_CODE = "CLS-2026-000035";
const STUDENT = "CD-IN-EL-26-001";
const DATE = "2026-10-19";

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_anomaly_a3_it", port: 19973 });
  await server.assertActiveSubscriptionPrecondition();
});

after(async () => {
  if (server) await server.stop();
});

test("ANOMALIE-MONO-T1-A3 : un statut de présence inconnu est refusé (400) sans écraser l'appel existant", { skip }, async () => {
  const token = await server.login("cdTeacher");
  const item = (status) => ({ classCode: CLASS_CODE, items: [{ studentId: STUDENT, date: DATE, status, classCode: CLASS_CODE }] });
  assertStatus(await server.request("POST", "/api/presences", { token, body: item("Présent") }), 201, "précondition : appel « Présent »");
  const read = () =>
    server.one(
      `SELECT a.status FROM attendance a JOIN students s ON s.id = a.student_id WHERE s.student_code = $1 AND a.attendance_date = $2`,
      [STUDENT, DATE],
    );
  assert.deepEqual(await read(), { status: "present" });

  const invalid = await server.request("POST", "/api/presences", { token, body: item("Inventé") });
  const after = await read();
  assert.deepEqual(
    { status: invalid.status, stored: after.status },
    { status: 400, stored: "present" },
    `ANOMALIE-MONO-T1-A3 : statut « Inventé » → HTTP ${invalid.status}, enregistré « ${after.status} »`,
  );
});
