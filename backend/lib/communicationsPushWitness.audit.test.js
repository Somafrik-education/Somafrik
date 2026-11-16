"use strict";

/**
 * P0 PUSH — témoin positif = message direct.
 * Store worker = façade clientsPgStore (bind oui, all/rôles non).
 * Le snapshot Lot I se fait à la persist (tx bound), pas au fan-out.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createMemoryDeliveryAdapter } = require("./communicationChannelFanout");
const { dispatchProcessedEvents } = require("./communicationsDispatcher");
const { createManual } = require("./communicationsNotificationsService");
const { expandSchoolWideRecipientKinds } = require("./schoolNotificationPolicy");

const ROOT = path.resolve(__dirname, "../..");
const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const USER_OTHER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const TOKEN_A = "ExponentPushToken[witness-a]";
const TOKEN_A2 = "ExponentPushToken[witness-a-second]";
const TOKEN_B = "ExponentPushToken[school-b]";
const TOKEN_REVOKED = "ExponentPushToken[revoked-a]";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
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
    calls: [],
    async listActiveForUser({ userId, schoolId, backendEnvironment }) {
      this.calls.push({ userId, schoolId, backendEnvironment });
      return devices.filter(
        (item) =>
          String(item.user_id) === String(userId) &&
          String(item.school_id) === String(schoolId) &&
          item.backend_environment === backendEnvironment &&
          !item.revoked_at,
      );
    },
  };
}

function recordingPushClient() {
  const sent = [];
  return {
    sent,
    async sendToTokens(tokens, message) {
      sent.push({ tokens: [...tokens], title: message?.title, body: message?.body, data: message?.data });
      return { sent: tokens.length };
    },
  };
}

function workerLikeAdapter(seed) {
  const adapter = createMemoryDeliveryAdapter(seed);
  delete adapter.listUserRoleKeys;
  delete adapter.listEnabledChannels;
  delete adapter.loadSchoolNotificationPolicy;
  delete adapter.schoolNotificationPolicy;
  return adapter;
}

function workerShapedClientsStore() {
  const store = createClientsPgStore({
    async one() { return null; },
    async all() { return []; },
    async query() { return { rows: [], rowCount: 0 }; },
    async withTransaction(fn) { return fn({}); },
  });
  assert.equal(typeof store.all, "undefined");
  assert.equal(typeof store.listActiveUserRoleKeysForSchool, "undefined");
  return store;
}

function note({ id, eventKey, eventType, title, body, navigationTarget }) {
  return {
    id,
    event_key: eventKey,
    event_type: eventType,
    school_id: SCHOOL_A,
    title,
    body,
    navigation_target: navigationTarget,
  };
}

async function fanOutWorkerPath({
  notifications,
  recipients,
  devices,
  processed,
  pushClient,
  env = envPreprod(),
  mailer = { async sendMail() {} },
}) {
  const adapter = workerLikeAdapter({ notifications, recipients });
  const pushStore = createPushStore(devices);
  const client = pushClient || recordingPushClient();
  const drained = await dispatchProcessedEvents({
    store: workerShapedClientsStore(),
    adapter,
    processed,
    pushStore,
    pushClient: client,
    mailer,
    env,
    logger: { error() {}, info() {} },
  });
  return { adapter, pushStore, client, drained };
}

const WITNESS_DEVICE = {
  user_id: USER_A,
  school_id: SCHOOL_A,
  expo_push_token: TOKEN_A,
  backend_environment: "preproduction",
};

test("façade worker inchangée : bind oui, rôles/all non — Messages directs non touchés", () => {
  const src = read("backend/db/clientsPgStore.js");
  const facade = src.slice(src.indexOf("const store = {"));
  assert.match(facade, /bind,/);
  assert.doesNotMatch(facade, /listActiveUserRoleKeysForSchool/);
  const messages = read("backend/lib/communicationsMessagesService.js");
  assert.doesNotMatch(messages, /expandSchoolWideRecipientKinds|dispatchProcessedEvents/);
  const dispatcher = read("backend/lib/communicationsDispatcher.js");
  assert.match(dispatcher, /"communication\.message\.created": \["PUSH", "EMAIL"\]/);
});

test("expandSchoolWideRecipientKinds : school → PARENT, fail-closed sans rôle, parent inchangé", async () => {
  const store = {
    async listActiveUserRoleKeysForSchool(userId, schoolId) {
      assert.equal(String(schoolId), SCHOOL_A);
      if (String(userId) === USER_A) return ["PARENT"];
      return [];
    },
  };
  assert.deepEqual(
    await expandSchoolWideRecipientKinds(store, {
      userId: USER_A,
      schoolId: SCHOOL_A,
      kind: "school",
      kinds: ["school"],
    }),
    ["PARENT"],
  );
  assert.deepEqual(
    await expandSchoolWideRecipientKinds(store, {
      userId: USER_B,
      schoolId: SCHOOL_A,
      kind: "school",
      kinds: ["school"],
    }),
    [],
  );
  assert.deepEqual(
    await expandSchoolWideRecipientKinds(store, {
      userId: USER_A,
      schoolId: SCHOOL_A,
      kind: "parent",
      kinds: ["parent"],
    }),
    ["PARENT"],
  );
});

test("Test 1 — Message direct → même device → sendToTokens OUI", async () => {
  const eventKey = "communication.message.created:dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
  const { client, pushStore } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-msg",
      eventKey,
      eventType: "communication.message.created",
      title: "Nouveau message",
      body: "Vous avez reçu un nouveau message.",
      navigationTarget: { type: "conversation", conversationId: "conv-1" },
    })],
    recipients: [{ notification_id: "n-msg", school_id: SCHOOL_A, user_id: USER_A, recipient_kind: "participant" }],
    devices: [WITNESS_DEVICE],
    processed: [{ event_key: eventKey }],
  });
  assert.equal(client.sent.length, 1);
  assert.deepEqual(client.sent[0].tokens, [TOKEN_A]);
  assert.equal(client.sent[0].data.somafrikDestination, "Messages");
  assert.equal(pushStore.calls[0].userId, USER_A);
  assert.equal(pushStore.calls[0].schoolId, SCHOOL_A);
});

test("Test 2 — Annonce Tous après snapshot Lot I → sendToTokens OUI", async () => {
  const persistStore = {
    async listActiveUserRoleKeysForSchool(userId, schoolId) {
      assert.equal(String(schoolId), SCHOOL_A);
      assert.equal(String(userId), USER_A);
      return ["PARENT"];
    },
  };
  const kinds = await expandSchoolWideRecipientKinds(persistStore, {
    userId: USER_A,
    schoolId: SCHOOL_A,
    kind: "school",
    kinds: ["school"],
  });
  assert.deepEqual(kinds, ["PARENT"]);

  const eventKey = "communication.announcement.published:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
  const { client } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-ann",
      eventKey,
      eventType: "communication.announcement.published",
      title: "Nouvelle annonce",
      body: "Une nouvelle annonce est disponible : Réunion",
      navigationTarget: { type: "announcement", announcementId: "ann-1" },
    })],
    recipients: [{
      notification_id: "n-ann",
      school_id: SCHOOL_A,
      user_id: USER_A,
      recipient_kind: "school",
      recipient_context: { announcementId: "ann-1", kinds },
    }],
    devices: [WITNESS_DEVICE],
    processed: [{ event_key: eventKey }],
  });
  assert.equal(client.sent.length, 1);
  assert.deepEqual(client.sent[0].tokens, [TOKEN_A]);
  assert.equal(client.sent[0].data.somafrikDestination, "Announcements");
});

test("Annonce rôles (kind=parent) → sendToTokens OUI", async () => {
  const eventKey = "communication.announcement.published:ffffffff-ffff-4fff-8fff-fffffffffff1";
  const { client } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-ann-parent",
      eventKey,
      eventType: "communication.announcement.published",
      title: "Nouvelle annonce",
      body: "Parents",
      navigationTarget: { type: "announcement", announcementId: "ann-2" },
    })],
    recipients: [{
      notification_id: "n-ann-parent",
      school_id: SCHOOL_A,
      user_id: USER_A,
      recipient_kind: "parent",
      recipient_context: { announcementId: "ann-2", kinds: ["parent"] },
    }],
    devices: [WITNESS_DEVICE],
    processed: [{ event_key: eventKey }],
  });
  assert.equal(client.sent.length, 1);
  assert.deepEqual(client.sent[0].tokens, [TOKEN_A]);
});

test("Test 3 — Absence parent → sendToTokens OUI", async () => {
  const eventKey = "attendance.student.absent:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  const { client } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-abs",
      eventKey,
      eventType: "attendance.student.absent",
      title: "Absence enregistrée",
      body: "Un élève a été signalé(e) absent(e).",
      navigationTarget: { type: "attendance", studentId: "st-1" },
    })],
    recipients: [{
      notification_id: "n-abs",
      school_id: SCHOOL_A,
      user_id: USER_A,
      recipient_kind: "parent",
      recipient_context: { studentId: "st-1" },
    }],
    devices: [WITNESS_DEVICE],
    processed: [{ event_key: eventKey }],
  });
  assert.equal(client.sent.length, 1);
  assert.deepEqual(client.sent[0].tokens, [TOKEN_A]);
});

test("createManual rejoint l'outbox C4, pas le dispatcher in-process", () => {
  const service = read("backend/lib/communicationsNotificationsService.js");
  const createFn = service.slice(service.indexOf("async function createManual"), service.indexOf("async function downloadAttachment"));
  assert.match(createFn, /INSERT INTO communication_event_outbox/);
  assert.match(createFn, /notification\.manual/);
  assert.doesNotMatch(createFn, /dispatchProcessedEvents|fanOutNotificationChannels|expoPushService/);
  assert.doesNotMatch(service, /require\(["'].*communicationsDispatcher["']\)/);
});

test("createManual audience Tous snapshot PARENT + enqueue outbox", async () => {
  const captured = [];
  const store = {
    async withTransaction(fn) {
      const tx = {
        async getUserById() {
          return { id: USER_A, school_id: SCHOOL_A, first_name: "Ada", last_name: "Admin" };
        },
        async listSchoolActiveUserIds() {
          return [{ user_id: USER_B }];
        },
        async listActiveUserRoleKeysForSchool(userId, schoolId) {
          assert.equal(String(schoolId), SCHOOL_A);
          if (String(userId) === USER_B) return ["PARENT"];
          return [];
        },
        async one(sql) {
          if (/SELECT \* FROM communication_notifications WHERE event_key/.test(String(sql))) return null;
          if (/INSERT INTO communication_notifications/.test(String(sql))) {
            return {
              id: "manual-1",
              school_id: SCHOOL_A,
              event_key: `notification.manual:${SCHOOL_A}:idem-1`,
              event_type: "notification.manual",
              source_entity_id: "src-manual-1",
            };
          }
          return { id: "manual-1", school_id: SCHOOL_A, school_code: "SCH-A" };
        },
        async query(sql, params) {
          captured.push({ sql: String(sql), params });
          return { rowCount: 1 };
        },
        async all() { return []; },
      };
      return fn(tx);
    },
    async getSchoolByCode() {
      return { id: SCHOOL_A, school_code: "SCH-A" };
    },
  };
  await createManual(
    store,
    { title: "Notif métier", body: "Message admin" },
    { sub: USER_A, schoolCode: "SCH-A", permissions: ["Notifications:CREATE"] },
    {},
    "idem-1",
  );
  const recipientInsert = captured.find((row) => /INSERT INTO notification_recipients/.test(row.sql));
  assert.ok(recipientInsert);
  assert.equal(recipientInsert.params[3], "school");
  const context = JSON.parse(recipientInsert.params[4]);
  assert.deepEqual(context.kinds, ["PARENT"]);
  const outboxInsert = captured.find((row) => /INSERT INTO communication_event_outbox/.test(row.sql));
  assert.ok(outboxInsert, "createManual doit enqueuer l'outbox C4");
  assert.equal(outboxInsert.params[0], `notification.manual:${SCHOOL_A}:idem-1`);
});

test("createManual snapshot → sendToTokens OUI (pipeline worker)", async () => {
  const eventKey = `notification.manual:${SCHOOL_A}:idem-push`;
  const { client } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-manual",
      eventKey,
      eventType: "notification.manual",
      title: "Notif métier",
      body: "Message admin",
      navigationTarget: {},
    })],
    recipients: [{
      notification_id: "n-manual",
      school_id: SCHOOL_A,
      user_id: USER_A,
      recipient_kind: "school",
      recipient_context: { scope: "school", kinds: ["PARENT"] },
    }],
    devices: [WITNESS_DEVICE],
    processed: [{ event_key: eventKey, event_type: "notification.manual" }],
  });
  assert.equal(client.sent.length, 1);
  assert.deepEqual(client.sent[0].tokens, [TOKEN_A]);
});

test("aucun device → skipped", async () => {
  const eventKey = "communication.message.created:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
  const { client, adapter } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-nodev",
      eventKey,
      eventType: "communication.message.created",
      title: "Nouveau message",
      body: "x",
      navigationTarget: { type: "conversation", conversationId: "c1" },
    })],
    recipients: [{ notification_id: "n-nodev", school_id: SCHOOL_A, user_id: USER_A, recipient_kind: "participant" }],
    devices: [],
    processed: [{ event_key: eventKey }],
  });
  assert.equal(client.sent.length, 0);
  assert.equal(adapter.deliveries.find((row) => row.channel === "PUSH").status, "skipped");
});

test("token révoqué → sendToTokens NON", async () => {
  const eventKey = "communication.message.created:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
  const { client } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-rev",
      eventKey,
      eventType: "communication.message.created",
      title: "Nouveau message",
      body: "x",
      navigationTarget: { type: "conversation", conversationId: "c1" },
    })],
    recipients: [{ notification_id: "n-rev", school_id: SCHOOL_A, user_id: USER_A, recipient_kind: "participant" }],
    devices: [{ ...WITNESS_DEVICE, expo_push_token: TOKEN_REVOKED, revoked_at: "2026-09-01T00:00:00.000Z" }],
    processed: [{ event_key: eventKey }],
  });
  assert.equal(client.sent.length, 0);
});

test("mauvais tenant → token école B jamais ciblé", async () => {
  const eventKey = "attendance.student.absent:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
  const { client } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-tenant",
      eventKey,
      eventType: "attendance.student.absent",
      title: "Absence",
      body: "x",
      navigationTarget: { type: "attendance", studentId: "st-1" },
    })],
    recipients: [{ notification_id: "n-tenant", school_id: SCHOOL_A, user_id: USER_A, recipient_kind: "parent" }],
    devices: [
      WITNESS_DEVICE,
      { user_id: USER_A, school_id: SCHOOL_B, expo_push_token: TOKEN_B, backend_environment: "preproduction" },
    ],
    processed: [{ event_key: eventKey }],
  });
  assert.deepEqual(client.sent[0].tokens, [TOKEN_A]);
  assert.equal(client.sent[0].tokens.includes(TOKEN_B), false);
});

test("utilisateur non destinataire → pas de PUSH", async () => {
  const eventKey = "attendance.student.absent:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5";
  const { client } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-other",
      eventKey,
      eventType: "attendance.student.absent",
      title: "Absence",
      body: "x",
      navigationTarget: {},
    })],
    recipients: [{ notification_id: "n-other", school_id: SCHOOL_A, user_id: USER_OTHER, recipient_kind: "parent" }],
    devices: [WITNESS_DEVICE],
    processed: [{ event_key: eventKey }],
  });
  assert.equal(client.sent.length, 0);
});

test("plusieurs devices du même destinataire", async () => {
  const eventKey = "communication.message.created:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6";
  const { client } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-multi-dev",
      eventKey,
      eventType: "communication.message.created",
      title: "Nouveau message",
      body: "x",
      navigationTarget: { type: "conversation", conversationId: "c1" },
    })],
    recipients: [{ notification_id: "n-multi-dev", school_id: SCHOOL_A, user_id: USER_A, recipient_kind: "participant" }],
    devices: [WITNESS_DEVICE, { ...WITNESS_DEVICE, expo_push_token: TOKEN_A2 }],
    processed: [{ event_key: eventKey }],
  });
  assert.deepEqual(client.sent[0].tokens.sort(), [TOKEN_A, TOKEN_A2].sort());
});

test("plusieurs destinataires — pas de fuite cross-tenant", async () => {
  const eventKey = "attendance.student.absent:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7";
  const { client } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-multi-user",
      eventKey,
      eventType: "attendance.student.absent",
      title: "Absence",
      body: "x",
      navigationTarget: {},
    })],
    recipients: [
      { notification_id: "n-multi-user", school_id: SCHOOL_A, user_id: USER_A, recipient_kind: "parent" },
      { notification_id: "n-multi-user", school_id: SCHOOL_A, user_id: USER_B, recipient_kind: "parent" },
    ],
    devices: [
      WITNESS_DEVICE,
      { user_id: USER_B, school_id: SCHOOL_A, expo_push_token: "ExponentPushToken[user-b]", backend_environment: "preproduction" },
      { user_id: USER_B, school_id: SCHOOL_B, expo_push_token: TOKEN_B, backend_environment: "preproduction" },
    ],
    processed: [{ event_key: eventKey }],
  });
  const tokens = client.sent.flatMap((row) => row.tokens).sort();
  assert.deepEqual(tokens, ["ExponentPushToken[user-b]", TOKEN_A].sort());
  assert.equal(tokens.includes(TOKEN_B), false);
});

test("échec provider : sendToTokens atteint, delivery failed", async () => {
  const eventKey = "communication.message.created:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8";
  let reached = false;
  const { adapter } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-fail",
      eventKey,
      eventType: "communication.message.created",
      title: "Nouveau message",
      body: "x",
      navigationTarget: { type: "conversation", conversationId: "c1" },
    })],
    recipients: [{ notification_id: "n-fail", school_id: SCHOOL_A, user_id: USER_A, recipient_kind: "participant" }],
    devices: [WITNESS_DEVICE],
    processed: [{ event_key: eventKey }],
    pushClient: {
      async sendToTokens() {
        reached = true;
        throw new Error("Expo 503");
      },
    },
  });
  assert.equal(reached, true);
  assert.equal(adapter.deliveries.find((row) => row.channel === "PUSH").status, "failed");
});

test("eventSpec annonce school-wide snapshotte les catégories, pas seulement school", () => {
  const service = read("backend/lib/communicationsNotificationsService.js");
  const block = service.slice(
    service.indexOf('eventType === "communication.announcement.published"'),
    service.indexOf('eventType === "attendance.student.absent"'),
  );
  assert.match(block, /snapshotRecipientKinds|expandSchoolWideRecipientKinds/);
  assert.match(block, /if \(!kinds\.length\) continue/);
});
