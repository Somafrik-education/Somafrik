"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  canReadDeliveryHealth,
  resolveDeliveryHealthScope,
  readDeliveryHealth,
} = require("./communicationsDeliveryHealth");
const {
  summarizeChannelDeliveryHealth,
  createMemoryDeliveryAdapter,
} = require("./communicationChannelFanout");

const SCHOOL_CD = "11111111-1111-4111-8111-111111111111";
const SCHOOL_BI = "22222222-2222-4222-8222-222222222222";
const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("Superadmin et Admin School peuvent diagnostiquer ; Parent non", () => {
  assert.equal(canReadDeliveryHealth({ role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"] }), true);
  assert.equal(canReadDeliveryHealth({ role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"] }), true);
  assert.equal(canReadDeliveryHealth({ role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolId: SCHOOL_CD }), true);
  assert.equal(canReadDeliveryHealth({ role: "Parent", roleKeys: ["PARENT"], schoolId: SCHOOL_CD }), false);
  assert.deepEqual(
    resolveDeliveryHealthScope({ role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"] }),
    { mode: "all" },
  );
  assert.deepEqual(
    resolveDeliveryHealthScope({ role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolId: SCHOOL_CD }),
    { mode: "school", schoolId: SCHOOL_CD },
  );
});

test("Admin Pays sans countryCode/countryScope est fail-closed 403", async () => {
  assert.deepEqual(
    resolveDeliveryHealthScope({ role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"] }),
    { mode: "none" },
  );
  await assert.rejects(
    () => readDeliveryHealth({ async listDeliveryHealth() { return { counts: {} }; } }, {
      role: "Admin Pays",
      roleKeys: ["COUNTRY_ADMIN"],
    }),
    (error) => error.statusCode === 403,
  );
});

test("Admin School sans school_id est fail-closed 403", async () => {
  assert.deepEqual(
    resolveDeliveryHealthScope({ role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] }),
    { mode: "none" },
  );
  await assert.rejects(
    () => readDeliveryHealth({ async listDeliveryHealth() { return { counts: {} }; } }, {
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
    }),
    (error) => error.statusCode === 403,
  );
});

test("COUNTRY_ADMIN CD ne voit aucune delivery d'un établissement d'un autre pays", async () => {
  const adapter = createMemoryDeliveryAdapter({
    schools: [
      { id: SCHOOL_CD, countryCode: "CD" },
      { id: SCHOOL_BI, countryCode: "BI" },
    ],
  });
  await adapter.ensureDelivery({
    deliveryKey: "cd:push",
    eventKey: "cd.event",
    notificationId: null,
    schoolId: SCHOOL_CD,
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    channel: "PUSH",
    payload: {},
  });
  await adapter.ensureDelivery({
    deliveryKey: "bi:push",
    eventKey: "bi.event",
    notificationId: null,
    schoolId: SCHOOL_BI,
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    channel: "PUSH",
    payload: {},
  });
  adapter.deliveries.find((row) => row.school_id === SCHOOL_CD).status = "sent";
  adapter.deliveries.find((row) => row.school_id === SCHOOL_BI).status = "failed";
  adapter.deliveries.find((row) => row.school_id === SCHOOL_BI).last_error = "Expo 503";

  const countryAdminCd = {
    role: "Admin Pays",
    roleKeys: ["COUNTRY_ADMIN"],
    countryCode: "CD",
    countryScope: "RDC",
    platformContext: { kind: "country", countryCode: "CD" },
  };
  const snapshot = await readDeliveryHealth(adapter, countryAdminCd);
  assert.equal(snapshot.counts.sent, 1, "COUNTRY_ADMIN CD ne doit voir que CD");
  assert.equal(snapshot.counts.failed, 0, "COUNTRY_ADMIN CD ne doit pas voir les failed BI");
  assert.equal(snapshot.byChannel.PUSH.sent, 1);
  assert.deepEqual(resolveDeliveryHealthScope(countryAdminCd), { mode: "country", countryCode: "CD" });

  const countryAdminBi = {
    role: "Admin Pays",
    roleKeys: ["COUNTRY_ADMIN"],
    countryCode: "BI",
  };
  const other = await readDeliveryHealth(adapter, countryAdminBi);
  assert.equal(other.counts.sent, 0);
  assert.equal(other.counts.failed, 1);

  const superadmin = await readDeliveryHealth(adapter, {
    role: "Super Administrateur Somafrik",
    roleKeys: ["SUPER_ADMIN"],
  });
  assert.equal(superadmin.counts.sent, 1);
  assert.equal(superadmin.counts.failed, 1);
});

test("Admin Pays scope RDC (countryScope) se résout en CD", () => {
  assert.deepEqual(
    resolveDeliveryHealthScope({
      role: "Admin Pays",
      roleKeys: ["COUNTRY_ADMIN"],
      countryScope: "RDC",
    }),
    { mode: "country", countryCode: "CD" },
  );
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

test("SQL listDeliveryHealth country joint countries.iso_code — jamais un SELECT global", () => {
  const fanout = read("backend/lib/communicationChannelFanout.js");
  const sql = fanout.slice(fanout.indexOf("async listDeliveryHealth"), fanout.indexOf("async getUserEmail"));
  assert.match(sql, /iso_code/);
  assert.match(sql, /JOIN schools/);
  assert.match(sql, /JOIN countries/);
  assert.doesNotMatch(sql, /isPlatformOperator/);
});
