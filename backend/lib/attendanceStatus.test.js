"use strict";

/**
 * MONO-FIX-A3 — catalogue et validation stricte des statuts de présence.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ATTENDANCE_STATUS_INVALID,
  normalizeAttendanceStatus,
  assertAttendanceItemsStatuses,
} = require("./attendanceStatus");
const { PostgresRepository } = require("../db/postgresRepository");

function assertInvalid(fn, label) {
  assert.throws(fn, (error) => {
    assert.equal(error.statusCode, 400, label);
    assert.equal(error.code, ATTENDANCE_STATUS_INVALID, label);
    return true;
  });
}

test("catalogue métier : Présent, Absent, Retard, Justifié et variantes historiques ⇒ valeurs internes", () => {
  const expected = {
    "Présent": "present", Present: "present", present: "present", "PRÉSENT": "present", " présent ": "present", "present.": "present",
    Absent: "absent", absent: "absent", absence: "absent",
    Retard: "late", retard: "late", late: "late",
    "Justifié": "excused", "Justifiée": "excused", justifie: "excused", excused: "excused", "Excusé": "excused", excuse: "excused",
  };
  for (const [label, internal] of Object.entries(expected)) {
    assert.equal(normalizeAttendanceStatus(label, undefined), internal, label);
    // Le statut texte l'emporte sur un booléen present contradictoire (comportement historique).
    assert.equal(normalizeAttendanceStatus(label, internal !== "present"), internal, `${label} + present contradictoire`);
  }
});

test("statuts inconnus refusés (400 ATTENDANCE_STATUS_INVALID), même avec un booléen present", () => {
  for (const status of ["Inventé", "inconnu", "P", "presents", "malade", "absent justifié", "0", "true"]) {
    assertInvalid(() => normalizeAttendanceStatus(status, undefined), status);
    assertInvalid(() => normalizeAttendanceStatus(status, true), `${status} + present true`);
    assertInvalid(() => normalizeAttendanceStatus(status, false), `${status} + present false`);
  }
});

test("valeurs vides, nulles ou mal typées refusées sans booléen present", () => {
  for (const status of [undefined, null, "", "   "]) {
    assertInvalid(() => normalizeAttendanceStatus(status, undefined), JSON.stringify(status));
    assertInvalid(() => normalizeAttendanceStatus(status, "true"), `${JSON.stringify(status)} + present "true"`);
  }
  for (const status of [1, 0, true, false, {}, [], ["Présent"], { label: "Présent" }]) {
    assertInvalid(() => normalizeAttendanceStatus(status, true), JSON.stringify(status));
  }
});

test("compatibilité historique : statut absent + booléen present explicite", () => {
  assert.equal(normalizeAttendanceStatus(undefined, true), "present");
  assert.equal(normalizeAttendanceStatus("", false), "absent");
  assert.equal(normalizeAttendanceStatus(null, false), "absent");
});

test("lot : un seul statut invalide refuse tout le lot et désigne l'élément", () => {
  const items = Array.from({ length: 20 }, (_, index) => ({ studentId: `S${index}`, status: "Présent" }));
  assert.doesNotThrow(() => assertAttendanceItemsStatuses(items));
  items[12] = { studentId: "S12", status: "Inventé" };
  assert.throws(
    () => assertAttendanceItemsStatuses(items),
    (error) => error.code === ATTENDANCE_STATUS_INVALID && error.statusCode === 400 && error.details?.index === 12 && /élément 13/.test(error.message),
  );
  assert.doesNotThrow(() => assertAttendanceItemsStatuses([]));
});

test("PostgresRepository.toAttendanceStatus délègue à la validation stricte (plus de repli « absent »)", () => {
  const repository = Object.create(PostgresRepository.prototype);
  assert.equal(repository.toAttendanceStatus("Justifié", false), "excused");
  assert.equal(repository.toAttendanceStatus("Retard", false), "late");
  assert.equal(repository.toAttendanceStatus(undefined, true), "present");
  assertInvalid(() => repository.toAttendanceStatus("Inventé", false), "Inventé");
  assertInvalid(() => repository.toAttendanceStatus(undefined, undefined), "statut absent sans booléen");
});
