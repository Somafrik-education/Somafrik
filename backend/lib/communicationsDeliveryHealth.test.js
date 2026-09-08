"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  canReadDeliveryHealth,
  deliveryHealthSchoolScope,
  readDeliveryHealth,
} = require("./communicationsDeliveryHealth");
const { summarizeChannelDeliveryHealth } = require("./communicationChannelFanout");

const SCHOOL_A = "11111111-1111-4111-8111-111111111111";

test("Superadmin et Admin School peuvent diagnostiquer ; Parent non", () => {
  assert.equal(canReadDeliveryHealth({ role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"] }), true);
  assert.equal(canReadDeliveryHealth({ role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"] }), true);
  assert.equal(canReadDeliveryHealth({ role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolId: SCHOOL_A }), true);
  assert.equal(canReadDeliveryHealth({ role: "Parent", roleKeys: ["PARENT"], schoolId: SCHOOL_A }), false);
  assert.equal(deliveryHealthSchoolScope({ role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"] }), null);
  assert.equal(deliveryHealthSchoolScope({ role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolId: SCHOOL_A }), SCHOOL_A);
});

test("readDeliveryHealth refuse un Parent même si le store est disponible", async () => {
  await assert.rejects(
    () => readDeliveryHealth({ async listDeliveryHealth() { return {}; } }, { role: "Parent", roleKeys: ["PARENT"] }),
    (error) => error.statusCode === 403,
  );
});

test("snapshot omet payload, email et delivery_key", () => {
  const snapshot = summarizeChannelDeliveryHealth([
    {
      channel: "EMAIL",
      status: "failed",
      attempts: 3,
      last_error: "SMTP timeout parent-a@test.local",
      payload: { to: "parent-a@test.local", body: "secret" },
      delivery_key: "evt:user:EMAIL",
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    },
  ]);
  const json = JSON.stringify(snapshot);
  assert.doesNotMatch(json, /parent-a@test\.local/);
  assert.doesNotMatch(json, /delivery_key/);
  assert.doesNotMatch(json, /"payload"/);
  assert.equal(snapshot.counts.failed, 1);
  assert.equal(snapshot.recentErrors[0].attempts, 3);
});
