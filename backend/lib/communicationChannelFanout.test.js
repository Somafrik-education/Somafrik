"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createMemoryDeliveryAdapter,
  enqueueChannelDeliveries,
  drainChannelDeliveries,
  fanOutNotificationChannels,
  deliveryKey,
} = require("./communicationChannelFanout");

const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const NOTE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const EVENT_KEY = "attendance.student.absent:cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const TOKEN_A = "ExponentPushToken[school-a]";
const TOKEN_B = "ExponentPushToken[school-b]";
const TOKEN_PROD = "ExponentPushToken[school-a-prod]";

function baseNote() {
  return {
    id: NOTE_ID,
    event_key: EVENT_KEY,
    school_id: SCHOOL_A,
    title: "Absence enregistrée",
    body: "Un élève a été signalé(e) absent(e).",
  };
}

function envPreprod(extra = {}) {
  return {
    NODE_ENV: "test",
    APP_ENV: "preproduction",
    SMTP_HOST: "smtp.test.local",
    MAIL_FROM: "noreply@somafrik.app",
    ...extra,
  };
}

function createPushStore(devices) {
  return {
    async listActiveForUser({ userId, schoolId, backendEnvironment }) {
      return devices.filter(
        (item) =>
          item.user_id === userId &&
          item.school_id === schoolId &&
          item.backend_environment === backendEnvironment &&
          !item.revoked_at,
      );
    },
    async revokeByToken(token) {
      const row = devices.find((item) => item.expo_push_token === token);
      if (row) row.revoked_at = new Date().toISOString();
      return row || null;
    },
  };
}

test("in-app reste persistée si Expo échoue", async () => {
  const notifications = [baseNote()];
  const adapter = createMemoryDeliveryAdapter({
    notifications,
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  const pushStore = createPushStore([
    {
      user_id: USER_A,
      school_id: SCHOOL_A,
      expo_push_token: TOKEN_A,
      backend_environment: "preproduction",
    },
  ]);
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, {
    pushStore,
    pushClient: {
      async sendToTokens() {
        throw new Error("Expo 503");
      },
    },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].id, NOTE_ID);
  const push = adapter.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(push.status, "failed");
  assert.match(push.last_error, /Expo 503/);
});

test("in-app reste persistée si SMTP échoue", async () => {
  const notifications = [baseNote()];
  const adapter = createMemoryDeliveryAdapter({
    notifications,
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "parent-a@test.local" }],
  });
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, {
    pushStore: createPushStore([]),
    pushClient: { async sendToTokens() { return { sent: 0 }; } },
    mailer: {
      async sendMail() {
        throw new Error("SMTP timeout");
      },
    },
    env: envPreprod(),
  });
  assert.equal(notifications.length, 1);
  const email = adapter.deliveries.find((row) => row.channel === "EMAIL");
  assert.equal(email.status, "failed");
  assert.match(email.last_error, /SMTP timeout/);
});

test("retry PUSH n'envoie pas deux fois un succès", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  let sent = 0;
  const deps = {
    pushStore: createPushStore([
      {
        user_id: USER_A,
        school_id: SCHOOL_A,
        expo_push_token: TOKEN_A,
        backend_environment: "preproduction",
      },
    ]),
    pushClient: {
      async sendToTokens(tokens) {
        sent += 1;
        assert.deepEqual(tokens, [TOKEN_A]);
        return { sent: 1 };
      },
    },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  };
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, deps);
  await drainChannelDeliveries(adapter, deps);
  assert.equal(sent, 1);
  assert.equal(adapter.deliveries.find((row) => row.channel === "PUSH").status, "sent");
  assert.equal(deliveryKey(EVENT_KEY, USER_A, "PUSH"), `${EVENT_KEY}:${USER_A}:PUSH`);
});

test("retry EMAIL n'envoie pas deux fois un succès", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "parent-a@test.local" }],
  });
  let sent = 0;
  const deps = {
    pushStore: createPushStore([]),
    pushClient: { async sendToTokens() { return { sent: 0 }; } },
    mailer: {
      async sendMail() {
        sent += 1;
      },
    },
    env: envPreprod(),
  };
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, deps);
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, deps);
  assert.equal(sent, 1);
  assert.equal(adapter.deliveries.find((row) => row.channel === "EMAIL").status, "sent");
});

test("école A ne cible jamais un token de l'école B", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  const targeted = [];
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, {
    pushStore: createPushStore([
      {
        user_id: USER_A,
        school_id: SCHOOL_A,
        expo_push_token: TOKEN_A,
        backend_environment: "preproduction",
      },
      {
        user_id: USER_A,
        school_id: SCHOOL_B,
        expo_push_token: TOKEN_B,
        backend_environment: "preproduction",
      },
    ]),
    pushClient: {
      async sendToTokens(tokens) {
        targeted.push(...tokens);
        return { sent: tokens.length };
      },
    },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  });
  assert.deepEqual(targeted, [TOKEN_A]);
  assert.equal(targeted.includes(TOKEN_B), false);
});

test("preprod ne cible pas production", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  const targeted = [];
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, {
    pushStore: createPushStore([
      {
        user_id: USER_A,
        school_id: SCHOOL_A,
        expo_push_token: TOKEN_A,
        backend_environment: "preproduction",
      },
      {
        user_id: USER_A,
        school_id: SCHOOL_A,
        expo_push_token: TOKEN_PROD,
        backend_environment: "production",
      },
    ]),
    pushClient: {
      async sendToTokens(tokens) {
        targeted.push(...tokens);
        return { sent: tokens.length };
      },
    },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  });
  assert.deepEqual(targeted, [TOKEN_A]);
  assert.equal(targeted.includes(TOKEN_PROD), false);
});

test("événement sans canal externe reste traité (skipped)", async () => {
  const notifications = [baseNote()];
  const adapter = createMemoryDeliveryAdapter({
    notifications,
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "" }],
  });
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, {
    pushStore: createPushStore([]),
    pushClient: {
      async sendToTokens() {
        throw new Error("ne doit pas envoyer");
      },
    },
    env: { APP_ENV: "preproduction" },
  });
  assert.equal(notifications.length, 1);
  assert.equal(adapter.deliveries.find((row) => row.channel === "PUSH").status, "skipped");
  assert.equal(adapter.deliveries.find((row) => row.channel === "EMAIL").status, "skipped");
});

test("erreur fournisseur n'échoue pas le fan-out global", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  const results = await fanOutNotificationChannels({
    adapter: {
      async loadFanoutTargets() {
        throw new Error("adapter down");
      },
    },
    processed: [{ event_key: EVENT_KEY }],
    logger: { error() {} },
  });
  assert.deepEqual(results, []);
});

test("enqueue est idempotent par event_key + recipient + channel", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  const first = await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  const second = await enqueueChannelDeliveries(adapter, [{ eventKey: EVENT_KEY }]);
  assert.equal(first, 2);
  assert.equal(second, 0);
  assert.equal(adapter.deliveries.length, 2);
});
