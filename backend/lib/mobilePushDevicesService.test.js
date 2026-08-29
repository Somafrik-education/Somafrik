"use strict";

const assert = require("node:assert/strict");
const {
  upsertFromSession,
  revokeCurrentFromSession,
  sendSelfTest,
  TEST_CONFIRM,
  resolvePushBackendEnvironment,
  resolveStoredPushScope,
  assertPushSelfTestAllowed,
  assertPushSelfTestActor,
  hasPushSelfTestPermission,
} = require("./mobilePushDevicesService");

function throwsStatus(fn, status) {
  assert.throws(fn, (error) => error.statusCode === status);
}

async function throwsStatusAsync(fn, status) {
  await assert.rejects(fn, (error) => error.statusCode === status);
}

function preprodEnv(extra = {}) {
  return {
    NODE_ENV: "test",
    APP_ENV: "preproduction",
    SOMAFRIK_PUSH_SELFTEST_ENABLED: "true",
    ...extra,
  };
}

async function main() {
  const devices = [];
  const store = {
    async resolveSchoolId(code) {
      return code === "SCH-A" ? "11111111-1111-4111-8111-111111111111" : null;
    },
    async upsertDevice(row) {
      const existing = devices.find((item) => item.expo_push_token === row.expoPushToken);
      const saved = {
        id: existing?.id || "dev-1",
        user_id: row.userId,
        school_id: row.schoolId,
        expo_push_token: row.expoPushToken,
        platform: row.platform,
        backend_environment: row.backendEnvironment,
        app_profile: row.appProfile,
        revoked_at: null,
        last_seen_at: new Date().toISOString(),
      };
      if (existing) Object.assign(existing, saved);
      else devices.push(saved);
      return saved;
    },
    async revokeCurrent({ userId, expoPushToken }) {
      const row = devices.find((item) => item.user_id === userId && item.expo_push_token === expoPushToken);
      if (!row) return null;
      row.revoked_at = new Date().toISOString();
      return row;
    },
    async getByToken(token) {
      return devices.find((item) => item.expo_push_token === token) || null;
    },
    async listActiveForUser({ userId, backendEnvironment }) {
      return devices.filter(
        (item) => item.user_id === userId && item.backend_environment === backendEnvironment && !item.revoked_at,
      );
    },
  };

  const principal = { sub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", schoolCode: "SCH-A", permissions: ["Push:TEST"] };
  const teacher = { sub: principal.sub, schoolCode: "SCH-A", permissions: [], roleKeys: ["TEACHER"] };
  const other = { sub: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", schoolCode: "SCH-A" };
  const token = "ExponentPushToken[somafrik-android-n1]";
  const env = preprodEnv();

  assert.equal(resolvePushBackendEnvironment({ APP_ENV: "preproduction" }), "preproduction");
  assert.equal(resolvePushBackendEnvironment({ NODE_ENV: "development" }), "development");
  assert.equal(resolvePushBackendEnvironment({ NODE_ENV: "test" }), "development");
  assert.equal(resolvePushBackendEnvironment({ NODE_ENV: "production", APP_ENV: "production" }), "production");

  const previewOnPreprod = resolveStoredPushScope({ appProfile: "preview" }, { APP_ENV: "preproduction" });
  assert.deepEqual(previewOnPreprod, { backendEnvironment: "preproduction", appProfile: "preview" });
  const preprodOnPreprod = resolveStoredPushScope({ appProfile: "preproduction" }, { APP_ENV: "preproduction" });
  assert.deepEqual(preprodOnPreprod, { backendEnvironment: "preproduction", appProfile: "preproduction" });
  throwsStatus(() => resolveStoredPushScope({ appProfile: "production" }, { APP_ENV: "preproduction" }), 400);
  throwsStatus(() => resolveStoredPushScope({ appProfile: "preview" }, { APP_ENV: "production" }), 400);
  assert.deepEqual(resolveStoredPushScope({ appProfile: "production" }, { APP_ENV: "production" }), {
    backendEnvironment: "production",
    appProfile: "production",
  });

  throwsStatus(() => assertPushSelfTestAllowed({ APP_ENV: "production", SOMAFRIK_PUSH_SELFTEST_ENABLED: "true" }), 403);
  throwsStatus(() => assertPushSelfTestAllowed({ APP_ENV: "preproduction" }), 403);
  throwsStatus(
    () => assertPushSelfTestAllowed({ APP_ENV: "preproduction", SOMAFRIK_PUSH_SELFTEST_ENABLED: "false" }),
    403,
  );
  assert.equal(assertPushSelfTestAllowed(preprodEnv()), "preproduction");
  assert.equal(assertPushSelfTestAllowed({ NODE_ENV: "development" }), "development");
  throwsStatus(() => assertPushSelfTestActor(teacher, preprodEnv()), 403);
  assert.equal(hasPushSelfTestPermission({ permissions: ["ALL_PRIVILEGES"] }), true);

  await throwsStatusAsync(
    () => upsertFromSession(store, principal, { expoPushToken: token, platform: "android", userId: "x" }, env),
    400,
  );
  await throwsStatusAsync(
    () => upsertFromSession(store, principal, { expoPushToken: token, platform: "ios", appProfile: "preview" }, env),
    400,
  );
  await throwsStatusAsync(
    () =>
      upsertFromSession(
        store,
        principal,
        { expoPushToken: token, platform: "android", appProfile: "production" },
        env,
      ),
    400,
  );

  const upserted = await upsertFromSession(
    store,
    principal,
    { expoPushToken: token, platform: "android", appProfile: "preview" },
    env,
  );
  assert.equal(upserted.platform, "android");
  assert.equal(upserted.appProfile, "preview");
  assert.equal(upserted.backendEnvironment, "preproduction");
  assert.equal(devices[0].user_id, principal.sub);
  assert.equal(devices[0].school_id, "11111111-1111-4111-8111-111111111111");

  await upsertFromSession(store, principal, { expoPushToken: token, platform: "android" }, env);
  assert.equal(devices.length, 1, "upsert idempotent");
  assert.equal(devices[0].backend_environment, "preproduction", "APP_ENV serveur, pas profil client");

  await throwsStatusAsync(
    () => revokeCurrentFromSession(store, other, { expoPushToken: token }),
    403,
  );

  const revoked = await revokeCurrentFromSession(store, principal, { expoPushToken: token });
  assert.equal(revoked.revoked, true);

  await upsertFromSession(store, principal, { expoPushToken: token, platform: "android", appProfile: "preview" }, env);
  let expoCalled = 0;
  const pushClient = {
    async sendToTokens(tokens, message) {
      expoCalled += 1;
      assert.deepEqual(tokens, [token]);
      assert.equal(message.title, "Test Somafrik");
      assert.match(message.body, /fonctionnent correctement/);
      assert.equal(message.data.somafrikDestination, "Home");
      return { sent: 1, ticketCount: 1, revoked: [] };
    },
  };
  const sent = await sendSelfTest(store, principal, { confirm: TEST_CONFIRM }, pushClient, env);
  assert.equal(sent.sent, 1);
  assert.equal(expoCalled, 1);

  await throwsStatusAsync(
    () => sendSelfTest(store, teacher, { confirm: TEST_CONFIRM }, pushClient, env),
    403,
  );
  assert.equal(expoCalled, 1, "enseignant sans permission : aucun envoi Expo");

  await throwsStatusAsync(
    () =>
      sendSelfTest(
        store,
        principal,
        { confirm: TEST_CONFIRM },
        pushClient,
        preprodEnv({ APP_ENV: "production", SOMAFRIK_PUSH_SELFTEST_ENABLED: "true" }),
      ),
    403,
  );
  await throwsStatusAsync(
    () =>
      sendSelfTest(
        store,
        principal,
        { confirm: TEST_CONFIRM },
        pushClient,
        { APP_ENV: "preproduction", SOMAFRIK_PUSH_SELFTEST_ENABLED: "false" },
      ),
    403,
  );
  assert.equal(expoCalled, 1, "prod/preprod sans flag : aucun appel Expo");

  await throwsStatusAsync(
    () => sendSelfTest(store, principal, { confirm: "nope" }, pushClient, env),
    400,
  );

  throwsStatus(() => {
    const { parseExpoPushToken } = require("./mobilePushDevicesService");
    parseExpoPushToken("raw-fcm-token");
  }, 400);

  console.log("mobilePushDevicesService.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
