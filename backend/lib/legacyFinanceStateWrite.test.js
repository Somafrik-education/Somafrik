"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FINANCE_STATE_KEYS,
  LEGACY_FINANCE_STATE_WRITE_CODE,
  stripLegacyFinanceStateWrite,
} = require("./legacyFinanceStateWrite");

test("laisse passer un corps sans clé Finance", () => {
  const body = { users: [{ id: "u1" }] };
  const result = stripLegacyFinanceStateWrite(body);
  assert.equal(result.rejectLegacyFinanceWrite, false);
  assert.deepEqual(result.rejectedKeys, []);
  assert.equal(result.body, body);
});

test("rejette chaque clé Finance même vide, null ou identique", () => {
  for (const key of FINANCE_STATE_KEYS) {
    for (const value of [[], {}, null, undefined]) {
      const result = stripLegacyFinanceStateWrite({ [key]: value });
      assert.equal(result.rejectLegacyFinanceWrite, true, `${key}=${String(value)}`);
      assert.deepEqual(result.rejectedKeys, [key]);
      assert.equal(Object.prototype.hasOwnProperty.call(result.body, key), false);
    }
  }
});

test("rejette un payload mixte et liste les clés dans un ordre déterministe", () => {
  const result = stripLegacyFinanceStateWrite({
    users: [{ id: "u1" }],
    payments: [],
    studentFees: null,
    subscriptions: [{ id: "s1" }],
    feeGrids: {},
  });
  assert.equal(result.rejectLegacyFinanceWrite, true);
  assert.deepEqual(result.rejectedKeys, ["feeGrids", "payments", "studentFees"]);
  assert.deepEqual(result.body.users, [{ id: "u1" }]);
  assert.deepEqual(result.body.subscriptions, [{ id: "s1" }]);
});

test("expose le code d’erreur stable", () => {
  assert.equal(LEGACY_FINANCE_STATE_WRITE_CODE, "LEGACY_FINANCE_STATE_WRITE_FORBIDDEN");
});
