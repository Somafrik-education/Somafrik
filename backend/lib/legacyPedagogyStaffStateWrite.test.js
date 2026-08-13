"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LEGACY_TEACHERS_STATE_WRITE_CODE,
  LEGACY_ASSIGNMENTS_STATE_WRITE_CODE,
  stripLegacyPedagogyStaffStateWrite,
} = require("./legacyPedagogyStaffStateWrite");

test("absence des clés staff: payload inchangé", () => {
  const body = { notes: [{ id: "N1" }] };
  const result = stripLegacyPedagogyStaffStateWrite(body);
  assert.equal(result.body, body);
  assert.equal(result.rejectedEntity, null);
});

for (const value of [[], null, undefined, [{ id: "T1" }]]) {
  test(`teachers présent est rejeté (${String(value)})`, () => {
    const result = stripLegacyPedagogyStaffStateWrite({ teachers: value, notes: [] });
    assert.equal(result.rejectedEntity, "teachers");
    assert.equal(result.code, LEGACY_TEACHERS_STATE_WRITE_CODE);
    assert.deepEqual(result.body, { notes: [] });
  });
}

for (const value of [[], null, undefined, [{ id: "A1" }]]) {
  test(`assignments présent est rejeté (${String(value)})`, () => {
    const result = stripLegacyPedagogyStaffStateWrite({ assignments: value, notes: [] });
    assert.equal(result.rejectedEntity, "assignments");
    assert.equal(result.code, LEGACY_ASSIGNMENTS_STATE_WRITE_CODE);
    assert.deepEqual(result.body, { notes: [] });
  });
}

test("PUT mixte teachers+assignments échoue déterministement sur teachers", () => {
  const result = stripLegacyPedagogyStaffStateWrite({
    notes: [{ id: "N1" }],
    teachers: [],
    assignments: [],
  });
  assert.equal(result.rejectedEntity, "teachers");
  assert.equal(result.code, LEGACY_TEACHERS_STATE_WRITE_CODE);
  assert.deepEqual(result.body, { notes: [{ id: "N1" }] });
});

