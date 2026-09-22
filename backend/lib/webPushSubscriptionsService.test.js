"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createMemoryWebPushSubscriptionsStore } = require("../db/webPushSubscriptionsStore");
const {
  upsertFromSession,
  revokeCurrentFromSession,
  publicPushConfig,
} = require("./webPushSubscriptionsService");
const { createWebPushService } = require("./webPushService");

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ENDPOINT_A = "https://fcm.googleapis.com/fcm/send/somafrik-web-a";
const ENDPOINT_B = "https://fcm.googleapis.com/fcm/send/somafrik-web-b";
const KEYS = {
  p256dh: "test-web-push-p256dh-key",
  auth: "test-web-push-auth-key",
};

function envPreprod(extra = {}) {
  return { NODE_ENV: "test", APP_ENV: "preproduction", ...extra };
}

function principal(sub = USER_A, schoolCode = "SCH-A") {
  return { sub, schoolCode };
}

function throwsStatus(fn, status) {
  return assert.rejects(fn, (error) => error.statusCode === status);
}

test("permission denied côté client : le serveur n'accepte pas une identité spoofée", async () => {
  const store = createMemoryWebPushSubscriptionsStore();
  await throwsStatus(
    () =>
      upsertFromSession(
        store,
        principal(),
        { endpoint: ENDPOINT_A, keys: KEYS, userId: USER_B },
        envPreprod(),
      ),
    400,
  );
  await throwsStatus(
    () =>
      upsertFromSession(
        store,
        principal(),
        { endpoint: ENDPOINT_A, keys: KEYS, schoolId: "22222222-2222-4222-8222-222222222222" },
        envPreprod(),
      ),
    400,
  );
  assert.equal((await store.listActiveForUser({ userId: USER_A, schoolId: "x", backendEnvironment: "preproduction" })).length, 0);
});

test("création / stockage : subscription rattachée au user + school de session", async () => {
  const store = createMemoryWebPushSubscriptionsStore();
  const saved = await upsertFromSession(
    store,
    principal(),
    { endpoint: ENDPOINT_A, keys: KEYS, userAgent: "Chrome" },
    envPreprod(),
  );
  assert.ok(saved.id);
  assert.equal(saved.backendEnvironment, "preproduction");
  assert.equal(saved.revokedAt, null);
  assert.equal(saved.p256dh, undefined);
  assert.equal(saved.auth, undefined);
  assert.equal(saved.endpoint, undefined);

  const schoolA = await store.resolveSchoolId("SCH-A");
  const listed = await store.listActiveForUser({
    userId: USER_A,
    schoolId: schoolA,
    backendEnvironment: "preproduction",
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].user_id, USER_A);
  assert.equal(listed[0].school_id, schoolA);
  assert.equal(listed[0].endpoint, ENDPOINT_A);
});

test("session * et école absente : refus ; isolation tenant", async () => {
  const store = createMemoryWebPushSubscriptionsStore();
  await upsertFromSession(store, principal(), { endpoint: ENDPOINT_A, keys: KEYS }, envPreprod());

  await throwsStatus(
    () => upsertFromSession(store, principal(USER_A, "*"), { endpoint: ENDPOINT_B, keys: KEYS }, envPreprod()),
    400,
  );

  const schoolA = await store.resolveSchoolId("SCH-A");
  const schoolB = await store.resolveSchoolId("SCH-B");
  await upsertFromSession(store, principal(USER_A, "SCH-B"), { endpoint: ENDPOINT_B, keys: KEYS }, envPreprod());

  const onlyA = await store.listActiveForUser({
    userId: USER_A,
    schoolId: schoolA,
    backendEnvironment: "preproduction",
  });
  const onlyB = await store.listActiveForUser({
    userId: USER_A,
    schoolId: schoolB,
    backendEnvironment: "preproduction",
  });
  assert.deepEqual(onlyA.map((row) => row.endpoint), [ENDPOINT_A]);
  assert.deepEqual(onlyB.map((row) => row.endpoint), [ENDPOINT_B]);

  const missingSchool = await store.listActiveForUser({
    userId: USER_A,
    backendEnvironment: "preproduction",
  });
  assert.deepEqual(missingSchool, []);
});

test("unsubscribe + subscription expirée (410) révoquée proprement", async () => {
  const store = createMemoryWebPushSubscriptionsStore();
  await upsertFromSession(store, principal(), { endpoint: ENDPOINT_A, keys: KEYS }, envPreprod());

  await throwsStatus(
    () => revokeCurrentFromSession(store, principal(USER_B), { endpoint: ENDPOINT_A }),
    403,
  );

  const revoked = await revokeCurrentFromSession(store, principal(), { endpoint: ENDPOINT_A });
  assert.equal(revoked.revoked, true);

  const schoolA = await store.resolveSchoolId("SCH-A");
  assert.equal(
    (await store.listActiveForUser({ userId: USER_A, schoolId: schoolA, backendEnvironment: "preproduction" })).length,
    0,
  );

  await upsertFromSession(store, principal(), { endpoint: ENDPOINT_A, keys: KEYS }, envPreprod());
  const client = createWebPushService({
    store,
    env: envPreprod({
      VAPID_PUBLIC_KEY: "public-test-key-not-a-secret",
      VAPID_PRIVATE_KEY: "private-test-key-not-a-secret",
    }),
    webpushImpl: {
      setVapidDetails() {},
      async sendNotification() {
        const error = new Error("Gone");
        error.statusCode = 410;
        throw error;
      },
    },
  });
  const listed = await store.listActiveForUser({
    userId: USER_A,
    schoolId: schoolA,
    backendEnvironment: "preproduction",
  });
  const result = await client.sendToSubscriptions(listed, { title: "Somafrik", body: "test", data: {} });
  assert.equal(result.sent, 0);
  assert.equal(result.revoked.length, 1);
  assert.equal(
    (await store.listActiveForUser({ userId: USER_A, schoolId: schoolA, backendEnvironment: "preproduction" })).length,
    0,
  );
});

test("config publique : jamais de clé privée, disabled sans secrets", () => {
  const disabled = publicPushConfig({ APP_ENV: "preproduction" });
  assert.deepEqual(disabled, { enabled: false, vapidPublicKey: null });
  assert.equal(Object.prototype.hasOwnProperty.call(disabled, "vapidPrivateKey"), false);

  const enabled = publicPushConfig({
    VAPID_PUBLIC_KEY: "public-only",
    VAPID_PRIVATE_KEY: "must-never-leak",
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.vapidPublicKey, "public-only");
  assert.equal(JSON.stringify(enabled).includes("must-never-leak"), false);
});
