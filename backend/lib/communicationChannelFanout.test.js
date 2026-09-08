"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createMemoryDeliveryAdapter,
  enqueueChannelDeliveries,
  drainChannelDeliveries,
  fanOutNotificationChannels,
  deliveryKey,
  STALE_LEASE_MS,
  STALE_PROCESSING_REASON,
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

test("crash après succès Expo avant markSent n'envoie pas une seconde fois", async () => {
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
  adapter.deliveries.find((row) => row.channel === "EMAIL").status = "skipped";
  const claimed = await adapter.claimDue();
  assert.equal(claimed.channel, "PUSH");
  assert.equal(claimed.status, "processing");
  await deps.pushClient.sendToTokens([TOKEN_A], { title: "Absence enregistrée" });
  const stuck = adapter.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(stuck.status, "processing");
  const later = new Date(Date.now() + STALE_LEASE_MS + 1000);
  await drainChannelDeliveries(adapter, { ...deps, now: () => later });
  assert.equal(sent, 1);
  assert.equal(stuck.status, "skipped");
  assert.equal(stuck.last_error, STALE_PROCESSING_REASON);
});

test("crash après succès SMTP avant markSent n'envoie pas une seconde fois", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "parent-a@test.local" }],
  });
  let sent = 0;
  const deps = {
    pushStore: createPushStore([]),
    pushClient: {
      async sendToTokens() {
        throw new Error("ne doit pas renvoyer PUSH");
      },
    },
    mailer: {
      async sendMail() {
        sent += 1;
      },
    },
    env: envPreprod(),
  };
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  adapter.deliveries.find((row) => row.channel === "PUSH").status = "skipped";
  const claimed = await adapter.claimDue();
  assert.equal(claimed.channel, "EMAIL");
  await deps.mailer.sendMail({ to: "parent-a@test.local" });
  const stuck = adapter.deliveries.find((row) => row.channel === "EMAIL");
  assert.equal(stuck.status, "processing");
  const later = new Date(Date.now() + STALE_LEASE_MS + 1000);
  await drainChannelDeliveries(adapter, { ...deps, now: () => later });
  assert.equal(sent, 1);
  assert.equal(stuck.status, "skipped");
  assert.equal(stuck.last_error, STALE_PROCESSING_REASON);
});

test("échec Expo reste retryable et n'envoie qu'une fois au succès", async () => {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  let calls = 0;
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
      async sendToTokens() {
        calls += 1;
        if (calls === 1) throw new Error("Expo 503");
        return { sent: 1 };
      },
    },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  };
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  adapter.deliveries.find((row) => row.channel === "EMAIL").status = "skipped";
  await drainChannelDeliveries(adapter, deps);
  const push = adapter.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(push.status, "failed");
  assert.equal(calls, 1);
  const afterBackoff = new Date(Date.now() + 60 * 1000);
  await drainChannelDeliveries(adapter, { ...deps, now: () => afterBackoff });
  assert.equal(calls, 2);
  assert.equal(push.status, "sent");
  await drainChannelDeliveries(adapter, {
    ...deps,
    now: () => new Date(afterBackoff.getTime() + 60 * 1000),
  });
  assert.equal(calls, 2);
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
  const email = adapter.deliveries.find((row) => row.channel === "EMAIL");
  assert.equal(email.status, "failed");
  assert.match(String(email.last_error), /smtp_not_configured/);
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

test("échec de lecture prefs d'un destinataire n'abort pas l'enqueue des suivants", async () => {
  const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [
      { notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A },
      { notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_B },
    ],
  });
  const created = await enqueueChannelDeliveries(
    adapter,
    [{ event_key: EVENT_KEY }],
    ["PUSH", "EMAIL"],
    {
      logger: { error() {} },
      async resolveRecipientChannels(target) {
        if (String(target.user_id) === USER_A) throw new Error("prefs down");
        return ["EMAIL"];
      },
    },
  );
  assert.equal(created, 3);
  const byUser = {
    [USER_A]: adapter.deliveries.filter((row) => row.user_id === USER_A).map((row) => row.channel).sort(),
    [USER_B]: adapter.deliveries.filter((row) => row.user_id === USER_B).map((row) => row.channel).sort(),
  };
  assert.deepEqual(byUser[USER_A], ["EMAIL", "PUSH"]);
  assert.deepEqual(byUser[USER_B], ["EMAIL"]);
});

test("payload.to n'override pas l'email tenant scoped user+school", async () => {
  const adapter = createMemoryDeliveryAdapter({
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "parent-a@test.local" }],
  });
  await adapter.ensureDelivery({
    deliveryKey: "c4.tenant.email:1",
    eventKey: EVENT_KEY,
    notificationId: NOTE_ID,
    schoolId: SCHOOL_A,
    userId: USER_A,
    channel: "EMAIL",
    payload: {
      title: "Absence",
      body: "Un élève est absent.",
      to: "attacker@evil.test",
      kind: "trial.access.request",
    },
  });
  const mails = [];
  await drainChannelDeliveries(adapter, {
    pushStore: createPushStore([]),
    pushClient: { async sendToTokens() { return { sent: 0 }; } },
    mailer: {
      async sendMail(message) {
        mails.push(message);
      },
    },
    env: envPreprod(),
  });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "parent-a@test.local");
  assert.notEqual(mails[0].to, "attacker@evil.test");
});

test("EMAIL opérationnel trial.access.request utilise payload.to sans user/school", async () => {
  const adapter = createMemoryDeliveryAdapter({ users: [] });
  await adapter.ensureDelivery({
    deliveryKey: "trial.access.request:tar_1:EMAIL",
    eventKey: "trial.access.request:tar_1:EMAIL",
    notificationId: null,
    schoolId: null,
    userId: null,
    channel: "EMAIL",
    payload: {
      kind: "trial.access.request",
      to: "contact@somafrik.app",
      title: "[Somafrik] Nouvelle demande d'essai — Horizon",
      body: "Nouvelle demande d'essai Somafrik",
    },
  });
  const mails = [];
  await drainChannelDeliveries(adapter, {
    pushStore: createPushStore([]),
    pushClient: { async sendToTokens() { throw new Error("PUSH interdit pour essai"); } },
    mailer: {
      async sendMail(message) {
        mails.push(message);
      },
    },
    env: envPreprod(),
  });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "contact@somafrik.app");
  await drainChannelDeliveries(adapter, {
    mailer: {
      async sendMail() {
        throw new Error("ne doit pas renvoyer");
      },
    },
    env: envPreprod(),
  });
  assert.equal(mails.length, 1);
});

test("payload.to sans kind trial.access.request ne bypasse pas l'isolation tenant", async () => {
  const adapter = createMemoryDeliveryAdapter({ users: [] });
  await adapter.ensureDelivery({
    deliveryKey: "orphan.email:1",
    eventKey: "orphan.email:1",
    notificationId: null,
    schoolId: null,
    userId: null,
    channel: "EMAIL",
    payload: { to: "stranger@example.test", title: "x", body: "y" },
  });
  const mails = [];
  await drainChannelDeliveries(adapter, {
    mailer: {
      async sendMail(message) {
        mails.push(message);
      },
    },
    env: envPreprod(),
  });
  assert.equal(mails.length, 0);
  assert.equal(adapter.deliveries[0].status, "skipped");
});

test("smtp_not_configured laisse la delivery EMAIL retryable", async () => {
  const adapter = createMemoryDeliveryAdapter({ users: [] });
  await adapter.ensureDelivery({
    deliveryKey: "trial.access.request:tar_smtp:EMAIL",
    eventKey: "trial.access.request:tar_smtp:EMAIL",
    notificationId: null,
    schoolId: null,
    userId: null,
    channel: "EMAIL",
    payload: {
      kind: "trial.access.request",
      to: "contact@somafrik.app",
      title: "essai",
      body: "body",
    },
  });
  const mails = [];
  await drainChannelDeliveries(adapter, {
    mailer: {
      async sendMail(message) {
        mails.push(message);
      },
    },
    env: { NODE_ENV: "test" },
  });
  assert.equal(mails.length, 0);
  assert.equal(adapter.deliveries[0].status, "failed");
  assert.match(String(adapter.deliveries[0].last_error), /smtp_not_configured/);
  const afterBackoff = new Date(Date.now() + 60 * 1000);
  await drainChannelDeliveries(adapter, {
    mailer: {
      async sendMail(message) {
        mails.push(message);
      },
    },
    env: envPreprod(),
    now: () => afterBackoff,
  });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "contact@somafrik.app");
  assert.equal(adapter.deliveries[0].status, "sent");
});
