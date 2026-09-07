"use strict";

/**
 * PR A — GREEN RED-COM-02 : ciblage Expo obligatoire user_id + school_id + backend_environment.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createMemoryMobilePushDevicesStore } = require("../db/mobilePushDevicesStore");
const { sendSelfTest, upsertFromSession, TEST_CONFIRM } = require("./mobilePushDevicesService");

const ROOT = path.resolve(__dirname, "../..");
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const TOKEN_A = "ExponentPushToken[tenant-school-a]";
const TOKEN_B = "ExponentPushToken[tenant-school-b]";
const TOKEN_ENV = "ExponentPushToken[tenant-env-dev]";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function preprodEnv(extra = {}) {
  return {
    NODE_ENV: "test",
    APP_ENV: "preproduction",
    SOMAFRIK_PUSH_SELFTEST_ENABLED: "true",
    ...extra,
  };
}

test("RED-COM-02 P1 — listActiveForUser / self-test push filtrent school_id (école de session)", () => {
  const store = read("backend/db/mobilePushDevicesStore.js");
  const pgList = store.slice(store.indexOf("async listActiveForUser"));
  const sqlBlock = pgList.slice(0, pgList.indexOf("async getByToken"));
  assert.match(
    sqlBlock,
    /school_id\s*=\s*\$/,
    "SQL listActiveForUser doit filtrer school_id : un jeton école A ne doit pas être ciblable hors école courante",
  );
  const service = read("backend/lib/mobilePushDevicesService.js");
  const selfTest = service.slice(service.indexOf("async function sendSelfTest"));
  assert.match(
    selfTest.slice(0, 900),
    /schoolId|school_id/,
    "sendSelfTest doit passer l'école de session à listActiveForUser",
  );
});

test("même user + même école → token ciblé ; autre école / autre env exclus", async () => {
  const store = createMemoryMobilePushDevicesStore();
  const schoolA = await store.resolveSchoolId("SCH-A");
  const schoolB = await store.resolveSchoolId("SCH-B");
  await store.upsertDevice({
    userId: USER_ID,
    schoolId: schoolA,
    expoPushToken: TOKEN_A,
    platform: "android",
    backendEnvironment: "preproduction",
    appProfile: "preview",
  });
  await store.upsertDevice({
    userId: USER_ID,
    schoolId: schoolB,
    expoPushToken: TOKEN_B,
    platform: "android",
    backendEnvironment: "preproduction",
    appProfile: "preview",
  });
  await store.upsertDevice({
    userId: USER_ID,
    schoolId: schoolA,
    expoPushToken: TOKEN_ENV,
    platform: "android",
    backendEnvironment: "development",
    appProfile: "development",
  });

  const sameSchool = await store.listActiveForUser({
    userId: USER_ID,
    schoolId: schoolA,
    backendEnvironment: "preproduction",
  });
  assert.deepEqual(
    sameSchool.map((row) => row.expo_push_token),
    [TOKEN_A],
    "même user + même école + même env : seul le jeton A",
  );

  const otherSchool = await store.listActiveForUser({
    userId: USER_ID,
    schoolId: schoolB,
    backendEnvironment: "preproduction",
  });
  assert.deepEqual(
    otherSchool.map((row) => row.expo_push_token),
    [TOKEN_B],
    "même user + autre école : jeton A exclu",
  );

  const otherEnv = await store.listActiveForUser({
    userId: USER_ID,
    schoolId: schoolA,
    backendEnvironment: "development",
  });
  assert.deepEqual(
    otherEnv.map((row) => row.expo_push_token),
    [TOKEN_ENV],
    "même user + même école + autre environnement : jeton préprod exclu",
  );

  const missingSchool = await store.listActiveForUser({
    userId: USER_ID,
    backendEnvironment: "preproduction",
  });
  assert.deepEqual(missingSchool, [], "school_id absent : aucun élargissement de scope");
});

test("self-test utilise l'école de session ; spoof client et session * refusés", async () => {
  const store = createMemoryMobilePushDevicesStore();
  const env = preprodEnv();
  const principalA = { sub: USER_ID, schoolCode: "SCH-A", permissions: ["Push:TEST"] };
  const principalB = { sub: USER_ID, schoolCode: "SCH-B", permissions: ["Push:TEST"] };
  const principalStar = { sub: USER_ID, schoolCode: "*", permissions: ["ALL_PRIVILEGES"] };

  await upsertFromSession(
    store,
    principalA,
    { expoPushToken: TOKEN_A, platform: "android", appProfile: "preview" },
    env,
  );

  const targeted = [];
  const pushClient = {
    async sendToTokens(tokens) {
      targeted.push(...tokens);
      return { sent: tokens.length, ticketCount: tokens.length, revoked: [] };
    },
  };

  const sent = await sendSelfTest(store, principalA, { confirm: TEST_CONFIRM }, pushClient, env);
  assert.equal(sent.sent, 1);
  assert.deepEqual(targeted, [TOKEN_A], "self-test cible l'école de session");

  await assert.rejects(
    () => sendSelfTest(store, principalB, { confirm: TEST_CONFIRM }, pushClient, env),
    (error) => error.statusCode === 404,
  );
  assert.deepEqual(targeted, [TOKEN_A], "session école B : jeton école A non ciblé");

  await assert.rejects(
    () => sendSelfTest(store, principalStar, { confirm: TEST_CONFIRM }, pushClient, env),
    (error) => error.statusCode === 400,
  );
  assert.deepEqual(targeted, [TOKEN_A], "session * : pas de fan-out multi-écoles");

  await assert.rejects(
    () =>
      sendSelfTest(
        store,
        principalA,
        { confirm: TEST_CONFIRM, schoolId: await store.resolveSchoolId("SCH-B") },
        pushClient,
        env,
      ),
    (error) => error.statusCode === 400,
  );
  await assert.rejects(
    () =>
      sendSelfTest(store, principalA, { confirm: TEST_CONFIRM, school_id: "SCH-B" }, pushClient, env),
    (error) => error.statusCode === 400,
  );
  assert.deepEqual(targeted, [TOKEN_A], "school_id client ignoré / refusé");
});
