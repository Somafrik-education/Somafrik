"use strict";

const assert = require("node:assert/strict");
const { upsertFromSession, revokeCurrentFromSession, sendSelfTest, TEST_CONFIRM } = require("./mobilePushDevicesService");

function throwsStatus(fn, status) {
  assert.throws(fn, (error) => error.statusCode === status);
}

async function throwsStatusAsync(fn, status) {
  await assert.rejects(fn, (error) => error.statusCode === status);
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
        release_profile: row.releaseProfile,
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
    async listActiveForUser({ userId, releaseProfile }) {
      return devices.filter(
        (item) => item.user_id === userId && item.release_profile === releaseProfile && !item.revoked_at,
      );
    },
  };

  const principal = { sub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", schoolCode: "SCH-A" };
  const other = { sub: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", schoolCode: "SCH-A" };
  const token = "ExponentPushToken[somafrik-android-n1]";

  await throwsStatusAsync(
    () => upsertFromSession(store, principal, { expoPushToken: token, platform: "android", releaseProfile: "preview", userId: "x" }),
    400,
  );
  await throwsStatusAsync(
    () => upsertFromSession(store, principal, { expoPushToken: token, platform: "ios", releaseProfile: "preview" }),
    400,
  );

  const upserted = await upsertFromSession(store, principal, {
    expoPushToken: token,
    platform: "android",
    releaseProfile: "preview",
  });
  assert.equal(upserted.platform, "android");
  assert.equal(devices[0].user_id, principal.sub);
  assert.equal(devices[0].school_id, "11111111-1111-4111-8111-111111111111");

  await upsertFromSession(store, principal, {
    expoPushToken: token,
    platform: "android",
    releaseProfile: "preview",
  });
  assert.equal(devices.length, 1, "upsert idempotent");

  await throwsStatusAsync(
    () => revokeCurrentFromSession(store, other, { expoPushToken: token }),
    403,
  );

  const revoked = await revokeCurrentFromSession(store, principal, { expoPushToken: token });
  assert.equal(revoked.revoked, true);

  await upsertFromSession(store, principal, {
    expoPushToken: token,
    platform: "android",
    releaseProfile: "preview",
  });
  const pushClient = {
    async sendToTokens(tokens, message) {
      assert.deepEqual(tokens, [token]);
      assert.equal(message.title, "Test Somafrik");
      assert.match(message.body, /fonctionnent correctement/);
      assert.equal(message.data.somafrikDestination, "Home");
      return { sent: 1, ticketCount: 1, revoked: [] };
    },
  };
  const sent = await sendSelfTest(
    store,
    principal,
    { confirm: TEST_CONFIRM, releaseProfile: "preview" },
    pushClient,
  );
  assert.equal(sent.sent, 1);

  await throwsStatusAsync(
    () => sendSelfTest(store, principal, { confirm: "nope", releaseProfile: "preview" }, pushClient),
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
