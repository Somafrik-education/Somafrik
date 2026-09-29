"use strict";

/**
 * AUDIT PUSH ANNONCES & NOTIFICATIONS — témoin positif = message direct.
 *
 * Reproduit le chemin worker réel :
 *   communicationsNotificationsWorker.runOnce
 *     → getClientsStore()  (façade SANS all / SANS listActiveUserRoleKeysForSchool)
 *     → dispatchProcessedEvents({ store, repository, processed })  (pas d'adapter mémoire)
 *
 * Les tests existants (schoolNotificationSettings, fan-out) passent un adapter
 * avec listUserRoleKeys — ils masquent le trou de production.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createMemoryDeliveryAdapter } = require("./communicationChannelFanout");
const { dispatchProcessedEvents } = require("./communicationsDispatcher");
const { createManual } = require("./communicationsNotificationsService");

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

/**
 * Mimics production worker: delivery adapter without role/prefs helpers.
 * Role lookup then falls through to `store` (clients façade).
 */
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
  assert.equal(typeof store.all, "undefined", "la façade worker n'expose pas all()");
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

test("façade clientsPgStore = store worker : bind oui, rôles/all non", () => {
  const src = read("backend/db/clientsPgStore.js");
  const facade = src.slice(src.indexOf("const store = {"));
  assert.match(facade, /bind,/);
  assert.match(facade, /withTransaction\(/);
  assert.doesNotMatch(facade, /listActiveUserRoleKeysForSchool/);
  assert.doesNotMatch(facade, /^\s*all,/m);
  const worker = read("backend/lib/communicationsNotificationsWorker.js");
  assert.match(worker, /getClientsStore\(\)/);
  assert.match(worker, /dispatchProcessedEvents\(\{/);
  assert.doesNotMatch(worker.slice(worker.indexOf("await dispatchProcessedEvents")), /adapter:/);
});

test("message.created n'est pas Lot I — Annonce et métier le sont", () => {
  const policy = read("backend/lib/schoolNotificationPolicy.js");
  assert.match(policy, /"communication\.announcement\.published": "ANNOUNCEMENT_PUBLISHED"/);
  assert.match(policy, /"attendance\.student\.absent": "STUDENT_ABSENT"/);
  assert.doesNotMatch(policy, /communication\.message\.created/);
  const dispatcher = read("backend/lib/communicationsDispatcher.js");
  assert.match(dispatcher, /"communication\.message\.created": \["PUSH", "EMAIL"\]/);
  assert.match(dispatcher, /"communication\.announcement\.published": \["PUSH", "EMAIL"\]/);
  assert.match(dispatcher, /isSchoolWideRecipientKind/);
  assert.match(policy, /if \(isSchoolWideRecipientKind\(recipient\)\) return \[\];/);
});

test("Test 1 — Message direct → même device → sendToTokens atteint", async () => {
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
  assert.equal(client.sent.length, 1, "le message direct doit appeler Expo");
  assert.deepEqual(client.sent[0].tokens, [TOKEN_A]);
  assert.equal(client.sent[0].title, "Nouveau message");
  assert.equal(client.sent[0].data.somafrikDestination, "Messages");
  assert.equal(pushStore.calls[0].userId, USER_A);
  assert.equal(pushStore.calls[0].schoolId, SCHOOL_A);
});

test("GAP Annonce — audience établissement (kind=school) via store worker n'atteint PAS sendToTokens", async () => {
  const eventKey = "communication.announcement.published:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
  const { client, adapter, pushStore } = await fanOutWorkerPath({
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
      recipient_context: { announcementId: "ann-1", kinds: ["school"] },
    }],
    devices: [WITNESS_DEVICE],
    processed: [{ event_key: eventKey }],
  });
  assert.equal(
    adapter.deliveries.filter((row) => row.channel === "PUSH").length,
    0,
    "aucune delivery PUSH : catégories vides → fail-closed Lot I",
  );
  assert.equal(client.sent.length, 0, "Expo non appelé pour l'annonce établissement");
  assert.equal(pushStore.calls.length, 0);
});

test("Annonce rôles (kind=parent) via store worker ATTEINT sendToTokens — même device", async () => {
  const eventKey = "communication.announcement.published:ffffffff-ffff-4fff-8fff-fffffffffff1";
  const { client } = await fanOutWorkerPath({
    notifications: [note({
      id: "n-ann-parent",
      eventKey,
      eventType: "communication.announcement.published",
      title: "Nouvelle annonce",
      body: "Une nouvelle annonce est disponible : Parents",
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
  assert.equal(client.sent.length, 1, "annonce ciblée parent doit pousser comme le DM");
  assert.deepEqual(client.sent[0].tokens, [TOKEN_A]);
  assert.equal(client.sent[0].data.somafrikDestination, "Announcements");
});

test("Test 3 — Notification métier absence (kind=parent) → même device → sendToTokens atteint", async () => {
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
  assert.equal(client.sent.length, 1, "l'absence parent doit appeler Expo sur le device témoin");
  assert.deepEqual(client.sent[0].tokens, [TOKEN_A]);
  assert.equal(client.sent[0].data.somafrikDestination, "Home");
});

test("Notification métier manuelle (createManual) n'appelle jamais le dispatcher", () => {
  const service = read("backend/lib/communicationsNotificationsService.js");
  const createFn = service.slice(service.indexOf("async function createManual"), service.indexOf("async function downloadAttachment"));
  assert.doesNotMatch(createFn, /dispatchProcessedEvents|fanOutNotificationChannels|dispatchCommunication|communication_event_outbox/);
  assert.match(createFn, /notification\.manual/);
  const dispatcher = read("backend/lib/communicationsDispatcher.js");
  assert.doesNotMatch(dispatcher, /notification\.manual/);
  const server = read("backend/server.js");
  const post = server.slice(
    server.indexOf('app.post("/api/backoffice/internal-notifications"'),
    server.indexOf("app.post(\"/api/backoffice/internal-notifications/attachments\""),
  );
  assert.match(post, /createManual/);
  assert.doesNotMatch(post, /dispatchProcessedEvents|fanOutNotificationChannels/);
  const web = read("web/src/components/communications/InternalNotificationsCenter.tsx");
  assert.match(web, /internalNotificationsApi\.create\(/);
  assert.match(web, /title: title\.trim\(\), body: body\.trim\(\), attachmentIds/);
  const mobile = read("Mobile/src/screens/InternalNotificationsScreen.tsx");
  assert.match(mobile, /createInternalNotification\(\{/);
});

test("createManual audience défaut = school (mêmes kinds que l'annonce Tous)", async () => {
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
        async one(sql) {
          if (/SELECT \* FROM communication_notifications WHERE event_key/.test(String(sql))) return null;
          if (/INSERT INTO communication_notifications/.test(String(sql))) {
            return { id: "manual-1", school_id: SCHOOL_A, event_key: "notification.manual:x", event_type: "notification.manual" };
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
    "idem-manual-1",
  );
  const recipientInsert = captured.find((row) => /INSERT INTO notification_recipients/.test(row.sql));
  assert.ok(recipientInsert, "createManual doit insérer un destinataire in-app");
  assert.equal(recipientInsert.params[3], "school", "audience défaut Web/Mobile = school, pas parent");
});

test("aucun device → sendToTokens non appelé, delivery skipped", async () => {
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
  const push = adapter.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(push.status, "skipped");
  assert.match(String(push.last_error || ""), /no_active_devices/);
});

test("token révoqué → sendToTokens non appelé", async () => {
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
  const { client, pushStore } = await fanOutWorkerPath({
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
  assert.equal(pushStore.calls.every((call) => call.schoolId === SCHOOL_A), true);
});

test("utilisateur non destinataire → pas de PUSH", async () => {
  const eventKey = "attendance.student.absent:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5";
  const { client, adapter } = await fanOutWorkerPath({
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
  const push = adapter.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(push.user_id, USER_OTHER);
  assert.equal(push.status, "skipped");
});

test("plusieurs devices du même destinataire → tous les tokens", async () => {
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
    devices: [
      WITNESS_DEVICE,
      { ...WITNESS_DEVICE, expo_push_token: TOKEN_A2 },
    ],
    processed: [{ event_key: eventKey }],
  });
  assert.deepEqual(client.sent[0].tokens.sort(), [TOKEN_A, TOKEN_A2].sort());
});

test("plusieurs destinataires → un envoi par user, pas de fuite cross-tenant", async () => {
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

test("échec provider → in-app/delivery persistée, sendToTokens a bien été atteint", async () => {
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
  assert.equal(reached, true, "l'échec Expo doit survenir APRÈS l'appel provider");
  const push = adapter.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(push.status, "failed");
  assert.match(push.last_error, /Expo 503/);
});

test("snapshot C3 annonce établissement écrit kind=school, pas les catégories Lot I", () => {
  const announcements = read("backend/lib/communicationsAnnouncementsService.js");
  assert.match(announcements, /add\(row\.user_id \|\| row\.id, "school"/);
  assert.match(announcements, /scope: "school"/);
  const c4 = read("backend/lib/communicationsNotificationsService.js");
  const block = c4.slice(
    c4.indexOf('eventType === "communication.announcement.published"'),
    c4.indexOf('eventType === "attendance.student.absent"'),
  );
  assert.match(block, /addExact\(row\.user_id, row\.recipient_kind/);
  assert.match(block, /kinds/);
  assert.doesNotMatch(block, /resolveUserRecipientCategories|listActiveUserRoleKeysForSchool/);
});

test("annonces plateforme : aucun câblage Push", () => {
  const platform = read("backend/lib/platformAnnouncementsService.js");
  assert.doesNotMatch(platform, /communication_event_outbox|fanOutNotificationChannels|dispatchProcessedEvents|expoPushService/);
});
