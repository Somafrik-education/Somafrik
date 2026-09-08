"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createMemoryDeliveryAdapter,
} = require("./communicationChannelFanout");
const {
  normalizeChannels,
  dispatchCommunication,
  dispatchProcessedEvents,
  EVENT_EXTERNAL_CHANNEL_POLICY,
} = require("./communicationsDispatcher");

const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const NOTE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const EVENT_KEY = "attendance.student.absent:cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

function adapterWithTarget() {
  return createMemoryDeliveryAdapter({
    notifications: [
      {
        id: NOTE_ID,
        event_key: EVENT_KEY,
        school_id: SCHOOL_A,
        title: "Absence enregistrée",
        body: "Un élève a été signalé(e) absent(e).",
      },
    ],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "parent-a@test.local" }],
  });
}

function envPreprod() {
  return {
    NODE_ENV: "test",
    APP_ENV: "preproduction",
    SMTP_HOST: "smtp.test.local",
    MAIL_FROM: "noreply@somafrik.app",
  };
}

test("normalizeChannels déduplique et refuse SMS / null / malformé", () => {
  assert.deepEqual(normalizeChannels(["push", "EMAIL", "PUSH"]), ["PUSH", "EMAIL"]);
  assert.throws(() => normalizeChannels(["SMS"]), (error) => error.code === "unsupported_channel");
  assert.throws(() => normalizeChannels(null), (error) => error.code === "unsupported_channel");
  assert.throws(() => normalizeChannels(undefined), (error) => error.code === "unsupported_channel");
  assert.throws(() => normalizeChannels("PUSH"), (error) => error.code === "unsupported_channel");
  assert.throws(() => normalizeChannels([""]), (error) => error.code === "unsupported_channel");
});

test("dispatchCommunication SMS ne crée aucune delivery et n'appelle pas PUSH", async () => {
  const adapter = adapterWithTarget();
  let pushCalled = false;
  await assert.rejects(
    () =>
      dispatchCommunication({
        eventKey: EVENT_KEY,
        eventType: "attendance.student.absent",
        schoolId: SCHOOL_A,
        channels: ["SMS"],
        adapter,
        pushClient: {
          async sendToTokens() {
            pushCalled = true;
            return { sent: 1 };
          },
        },
        env: envPreprod(),
      }),
    (error) => error.code === "unsupported_channel",
  );
  assert.equal(pushCalled, false);
  assert.equal(adapter.deliveries.length, 0);
});

test("IN_APP seul ne crée pas de delivery PUSH/EMAIL", async () => {
  const adapter = adapterWithTarget();
  const result = await dispatchCommunication({
    eventKey: EVENT_KEY,
    eventType: "attendance.student.absent",
    schoolId: SCHOOL_A,
    channels: ["IN_APP"],
    adapter,
    env: envPreprod(),
  });
  assert.deepEqual(result.channels, ["IN_APP"]);
  assert.equal(result.enqueued, 0);
  assert.equal(adapter.deliveries.length, 0);
});

test("PUSH seul n'enqueue pas EMAIL", async () => {
  const adapter = adapterWithTarget();
  await dispatchCommunication({
    eventKey: EVENT_KEY,
    eventType: "attendance.student.absent",
    schoolId: SCHOOL_A,
    channels: ["PUSH"],
    adapter,
    pushStore: { async listActiveForUser() { return []; } },
    pushClient: { async sendToTokens() { throw new Error("ne doit pas envoyer sans device"); } },
    mailer: { async sendMail() { throw new Error("EMAIL interdit pour PUSH-only"); } },
    env: envPreprod(),
  });
  assert.equal(adapter.deliveries.length, 1);
  assert.equal(adapter.deliveries[0].channel, "PUSH");
});

test("double dispatchCommunication n'ajoute pas de seconde delivery", async () => {
  const adapter = adapterWithTarget();
  const deps = {
    eventKey: EVENT_KEY,
    eventType: "attendance.student.absent",
    schoolId: SCHOOL_A,
    channels: ["PUSH", "EMAIL"],
    adapter,
    pushStore: { async listActiveForUser() { return []; } },
    mailer: { async sendMail() {} },
    env: envPreprod(),
  };
  await dispatchCommunication(deps);
  await dispatchCommunication(deps);
  assert.equal(adapter.deliveries.length, 2);
  assert.deepEqual(
    adapter.deliveries.map((row) => row.channel).sort(),
    ["EMAIL", "PUSH"],
  );
});

test("politique C4 conservatrice reste PUSH+EMAIL pour les 5 eventTypes", () => {
  const types = [
    "communication.message.created",
    "communication.announcement.published",
    "attendance.student.absent",
    "pedagogy.grade.published",
    "finance.payment.recorded",
  ];
  for (const eventType of types) {
    assert.deepEqual(EVENT_EXTERNAL_CHANNEL_POLICY[eventType], ["PUSH", "EMAIL"]);
  }
});

test("dispatchProcessedEvents drain même sans event C4 (reset EMAIL)", async () => {
  const adapter = createMemoryDeliveryAdapter({
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "ada@test.local" }],
  });
  await adapter.ensureDelivery({
    deliveryKey: `auth.password.reset:${USER_A}:reset-1`,
    eventKey: `auth.password.reset:${USER_A}:reset-1`,
    notificationId: null,
    schoolId: SCHOOL_A,
    userId: USER_A,
    channel: "EMAIL",
    payload: { title: "reset", body: "body" },
  });
  let sent = 0;
  await dispatchProcessedEvents({
    adapter,
    processed: [],
    mailer: {
      async sendMail() {
        sent += 1;
      },
    },
    pushClient: { async sendToTokens() { throw new Error("PUSH interdit"); } },
    env: envPreprod(),
  });
  assert.equal(sent, 1);
  assert.equal(adapter.deliveries[0].status, "sent");
});
