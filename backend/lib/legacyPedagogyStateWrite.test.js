"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PEDAGOGY_STATE_KEYS,
  LEGACY_PEDAGOGY_STATE_WRITE_CODE,
  stripLegacyPedagogyStateWrite,
} = require("./legacyPedagogyStateWrite");

test("laisse passer un corps sans clé pédagogique", () => {
  const body = { users: [{ id: "u1" }] };
  const result = stripLegacyPedagogyStateWrite(body);
  assert.equal(result.rejectLegacyPedagogyWrite, false);
  assert.deepEqual(result.rejectedKeys, []);
  assert.equal(result.body, body);
});

test("rejette chaque clé pédagogique même vide, null ou identique", () => {
  for (const key of PEDAGOGY_STATE_KEYS) {
    for (const value of [[], {}, null, undefined]) {
      const result = stripLegacyPedagogyStateWrite({ [key]: value });
      assert.equal(result.rejectLegacyPedagogyWrite, true, `${key}=${String(value)}`);
      assert.deepEqual(result.rejectedKeys, [key]);
      assert.equal(Object.prototype.hasOwnProperty.call(result.body, key), false);
    }
  }
});

test("rejette un payload mixte et liste les clés dans un ordre déterministe", () => {
  const result = stripLegacyPedagogyStateWrite({
    users: [{ id: "u1" }],
    presences: [],
    courses: null,
    evaluations: {},
    notes: [],
    subscriptions: [{ id: "s1" }],
  });
  assert.equal(result.rejectLegacyPedagogyWrite, true);
  assert.deepEqual(result.rejectedKeys, ["courses", "evaluations", "notes", "presences"]);
  assert.deepEqual(result.body.users, [{ id: "u1" }]);
  assert.deepEqual(result.body.subscriptions, [{ id: "s1" }]);
});

test("expose le code d'erreur stable", () => {
  assert.equal(LEGACY_PEDAGOGY_STATE_WRITE_CODE, "LEGACY_PEDAGOGY_STATE_WRITE_FORBIDDEN");
});
