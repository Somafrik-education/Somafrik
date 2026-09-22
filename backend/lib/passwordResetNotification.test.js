"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createMemoryDeliveryAdapter,
  drainChannelDeliveries,
} = require("./communicationChannelFanout");
const {
  PASSWORD_RESET_EVENT_PREFIX,
  passwordResetDeliveryKey,
  buildPasswordResetEmailPayload,
  enqueuePasswordResetNotification,
} = require("./passwordResetNotification");

const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const RESET_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const SECRET = "SomaReset-99";

function envSmtp() {
  return {
    NODE_ENV: "test",
    APP_ENV: "preproduction",
    SMTP_HOST: "smtp.test.local",
    MAIL_FROM: "noreply@somafrik.app",
  };
}

test("payload de reset n'embarque jamais le mot de passe provisoire", () => {
  const payload = buildPasswordResetEmailPayload({
    firstName: "Ada",
    lastName: "Lovelace",
    schoolName: "Lycée Test",
    temporaryPassword: SECRET,
    password: SECRET,
  });
  const blob = JSON.stringify(payload);
  assert.doesNotMatch(blob, new RegExp(SECRET, "i"));
  assert.doesNotMatch(blob, /temporaryPassword|passwordHash|pinHash/i);
  assert.match(payload.title, /réinitialisé/i);
  assert.match(payload.body, /provisoire qui vous a été communiqué/);
  assert.equal(passwordResetDeliveryKey(USER_A, RESET_ID), `${PASSWORD_RESET_EVENT_PREFIX}:${USER_A}:${RESET_ID}`);
});

test("enqueue + drain EMAIL une seule fois, sans secret dans SMTP", async () => {
  const adapter = createMemoryDeliveryAdapter({
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "ada@test.local" }],
  });
  const deliveryKey = passwordResetDeliveryKey(USER_A, RESET_ID);
  const inserted = await enqueuePasswordResetNotification(adapter, {
    user: { id: USER_A, schoolId: SCHOOL_A, firstName: "Ada", lastName: "Lovelace" },
    deliveryKey,
    schoolName: "Lycée Test",
  });
  assert.equal(inserted.channel, "EMAIL");
  assert.equal(inserted.status, "pending");
  assert.doesNotMatch(JSON.stringify(inserted.payload), new RegExp(SECRET, "i"));

  let sent = 0;
  const mails = [];
  const deps = {
    pushStore: { async listActiveForUser() { return []; } },
    pushClient: { async sendToTokens() { throw new Error("PUSH interdit pour reset"); } },
    mailer: {
      async sendMail(message) {
        sent += 1;
        mails.push(message);
      },
    },
    env: envSmtp(),
  };
  await drainChannelDeliveries(adapter, deps);
  await drainChannelDeliveries(adapter, deps);
  assert.equal(sent, 1);
  assert.equal(adapter.deliveries[0].status, "sent");
  assert.equal(mails[0].subject, "Votre mot de passe Somafrik a été réinitialisé");
  assert.doesNotMatch(JSON.stringify(mails[0]), new RegExp(SECRET, "i"));
});

test("retry ensureDelivery est idempotent pour le même delivery_key", async () => {
  const adapter = createMemoryDeliveryAdapter({
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "ada@test.local" }],
  });
  const deliveryKey = passwordResetDeliveryKey(USER_A, RESET_ID);
  const first = await enqueuePasswordResetNotification(adapter, {
    user: { id: USER_A, schoolId: SCHOOL_A, firstName: "Ada" },
    deliveryKey,
  });
  const second = await enqueuePasswordResetNotification(adapter, {
    user: { id: USER_A, schoolId: SCHOOL_A, firstName: "Ada" },
    deliveryKey,
  });
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(adapter.deliveries.length, 1);
});

test("sans school_id UUID, le reset n'échoue pas (pas d'INSERT)", async () => {
  const adapter = createMemoryDeliveryAdapter({ users: [] });
  const result = await enqueuePasswordResetNotification(adapter, {
    user: { id: "USER-MEM-1", schoolId: "CD-2026-0001", firstName: "Mémoire" },
    deliveryKey: "auth.password.reset:skip:1",
  });
  assert.equal(result, null);
  assert.equal(adapter.deliveries.length, 0);
});
