"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createMemoryDeliveryAdapter,
  enqueueChannelDeliveries,
  drainChannelDeliveries,
  webPushDataForDelivery,
} = require("./communicationChannelFanout");
const { createMemoryWebPushSubscriptionsStore } = require("../db/webPushSubscriptionsStore");

const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const NOTE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const EVENT_KEY = "attendance.student.absent:cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/somafrik-web-delivery";

function envPreprod(extra = {}) {
  return { NODE_ENV: "test", APP_ENV: "preproduction", SMTP_HOST: "smtp.test.local", MAIL_FROM: "noreply@somafrik.app", ...extra };
}

test("livraison Web Push : payload navigationTarget, pas d'URL arbitraire", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [
      {
        id: NOTE_ID,
        event_key: EVENT_KEY,
        school_id: SCHOOL_A,
        title: "Absence enregistrée",
        body: "Un élève a été signalé(e) absent(e).",
        navigation_target: {
          type: "conversation",
          conversationId: "conv-1",
          url: "https://evil.example/steal",
        },
      },
    ],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  const webPushStore = createMemoryWebPushSubscriptionsStore();
  webPushStore._rows.push({
    id: "sub-1",
    user_id: USER_A,
    school_id: SCHOOL_A,
    endpoint: ENDPOINT,
    p256dh: "test-web-push-p256dh-key",
    auth: "test-web-push-auth-key",
    backend_environment: "preproduction",
    revoked_at: null,
  });

  const sent = [];
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, {
    pushStore: { async listActiveForUser() { return []; } },
    pushClient: { async sendToTokens() { throw new Error("Expo ne doit pas être appelé sans device"); } },
    webPushStore,
    webPushClient: {
      async sendToSubscriptions(subscriptions, message) {
        sent.push({ subscriptions, message });
        return { sent: 1, revoked: [] };
      },
    },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  });

  const push = adapter.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(push.status, "sent");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].subscriptions.map((row) => row.endpoint), [ENDPOINT]);
  assert.equal(sent[0].message.title, "Absence enregistrée");
  assert.equal(sent[0].message.data.navigationTarget.type, "conversation");
  assert.equal(sent[0].message.data.navigationTarget.conversationId, "conv-1");
  assert.equal(sent[0].message.data.navigationTarget.url, undefined);
});

test("aucune livraison Web Push si subscription absente / révoquée", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [
      {
        id: NOTE_ID,
        event_key: EVENT_KEY,
        school_id: SCHOOL_A,
        title: "Absence",
        body: "x",
      },
    ],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  let webCalls = 0;
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, {
    pushStore: { async listActiveForUser() { return []; } },
    pushClient: { async sendToTokens() { return { sent: 0 }; } },
    webPushStore: { async listActiveForUser() { return []; } },
    webPushClient: {
      async sendToSubscriptions() {
        webCalls += 1;
        return { sent: 1 };
      },
    },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  });
  assert.equal(webCalls, 0);
  assert.equal(adapter.deliveries.find((row) => row.channel === "PUSH").status, "skipped");
});

function pushDeps({ expo, web, devices = [], subscriptions = [] }) {
  return {
    pushStore: {
      async listActiveForUser() {
        return devices;
      },
    },
    pushClient: {
      async sendToTokens() {
        return expo();
      },
    },
    webPushStore: {
      async listActiveForUser() {
        return subscriptions;
      },
    },
    webPushClient: {
      async sendToSubscriptions() {
        return web();
      },
    },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  };
}

function deviceRow() {
  return {
    user_id: USER_A,
    school_id: SCHOOL_A,
    expo_push_token: "ExponentPushToken[school-a]",
    backend_environment: "preproduction",
  };
}

function subscriptionRow() {
  return {
    user_id: USER_A,
    school_id: SCHOOL_A,
    endpoint: ENDPOINT,
    p256dh: "test-web-push-p256dh-key",
    auth: "test-web-push-auth-key",
    backend_environment: "preproduction",
  };
}

function noteAdapter() {
  return createMemoryDeliveryAdapter({
    notifications: [
      {
        id: NOTE_ID,
        event_key: EVENT_KEY,
        school_id: SCHOOL_A,
        title: "Absence",
        body: "x",
      },
    ],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
}

test("Expo réussit + Web échoue : livraison failed, Web retenté, Expo non renvoyé", async () => {
  const adapter = noteAdapter();
  let expoCalls = 0;
  let webCalls = 0;
  const deps = pushDeps({
    devices: [deviceRow()],
    subscriptions: [subscriptionRow()],
    expo: async () => {
      expoCalls += 1;
      return { sent: 1 };
    },
    web: async () => {
      webCalls += 1;
      if (webCalls === 1) throw new Error("Web Push 503");
      return { sent: 1 };
    },
  });
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, deps);
  const push = adapter.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(push.status, "failed");
  assert.match(push.last_error, /Web Push 503/);
  assert.match(push.provider_ref, /^expo:/);
  assert.equal(expoCalls, 1);
  assert.equal(webCalls, 1);

  await drainChannelDeliveries(adapter, {
    ...deps,
    now: () => Date.now() + 60 * 60 * 1000,
  });
  assert.equal(push.status, "sent");
  assert.equal(expoCalls, 1, "Expo déjà livré : pas de second envoi");
  assert.equal(webCalls, 2, "Web retenté après échec isolé");
  assert.match(push.provider_ref, /expo:/);
  assert.match(push.provider_ref, /web-push:/);
});

test("Expo échoue + Web réussit : livraison failed, Expo retenté, Web non renvoyé", async () => {
  const adapter = noteAdapter();
  let expoCalls = 0;
  let webCalls = 0;
  const deps = pushDeps({
    devices: [deviceRow()],
    subscriptions: [subscriptionRow()],
    expo: async () => {
      expoCalls += 1;
      if (expoCalls === 1) throw new Error("Expo 503");
      return { sent: 1 };
    },
    web: async () => {
      webCalls += 1;
      return { sent: 1 };
    },
  });
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, deps);
  const push = adapter.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(push.status, "failed");
  assert.match(push.last_error, /Expo 503/);
  assert.match(push.provider_ref, /web-push:/);
  assert.equal(expoCalls, 1);
  assert.equal(webCalls, 1);

  await drainChannelDeliveries(adapter, {
    ...deps,
    now: () => Date.now() + 60 * 60 * 1000,
  });
  assert.equal(push.status, "sent");
  assert.equal(webCalls, 1, "Web déjà livré : pas de second envoi");
  assert.equal(expoCalls, 2, "Expo retenté après échec isolé");
});

test("après révocation de session, le fan-out ne livre plus l'ancien user", async () => {
  const store = createMemoryWebPushSubscriptionsStore();
  store._rows.push({
    id: "sub-revoked",
    user_id: USER_A,
    school_id: SCHOOL_A,
    endpoint: ENDPOINT,
    p256dh: "test-web-push-p256dh-key",
    auth: "test-web-push-auth-key",
    backend_environment: "preproduction",
    revoked_at: null,
  });
  await store.revokeCurrent({ userId: USER_A, endpoint: ENDPOINT });
  const adapter = noteAdapter();
  let webCalls = 0;
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  await drainChannelDeliveries(adapter, {
    pushStore: { async listActiveForUser() { return []; } },
    pushClient: { async sendToTokens() { return { sent: 0 }; } },
    webPushStore: store,
    webPushClient: {
      async sendToSubscriptions() {
        webCalls += 1;
        return { sent: 1 };
      },
    },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  });
  assert.equal(webCalls, 0);
  assert.equal(adapter.deliveries.find((row) => row.channel === "PUSH").status, "skipped");
});

test("webPushDataForDelivery ignore url/href et ne retient que des identifiants sûrs", () => {
  const data = webPushDataForDelivery(
    { event_key: EVENT_KEY },
    {
      navigationTarget: {
        type: "announcement",
        announcementId: "ann-1",
        url: "https://evil.example",
        href: "javascript:alert(1)",
      },
    },
  );
  assert.deepEqual(data, {
    eventKey: EVENT_KEY,
    navigationTarget: { type: "announcement", announcementId: "ann-1" },
  });
});
