"use strict";

/**
 * PR D — contrats dispatcher commun IN_APP | PUSH | EMAIL.
 * GREEN D′ : 04A / 04F / 04J doivent rester verts. AUDIT-COM-05 interdit
 * un second caller de fanOutNotificationChannels hors du dispatcher.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createMemoryDeliveryAdapter,
  drainChannelDeliveries,
} = require("./communicationChannelFanout");

const ROOT = path.resolve(__dirname, "../..");
const DISPATCHER_REL = "backend/lib/communicationsDispatcher.js";

const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function dispatcherPath() {
  return path.join(ROOT, DISPATCHER_REL);
}

test("RED-COM-04A — dispatcher commun capable de router IN_APP | PUSH | EMAIL", () => {
  assert.equal(
    fs.existsSync(dispatcherPath()),
    true,
    "aucun module dispatcher commun : impossible de déclarer explicitement IN_APP | PUSH | EMAIL par événement",
  );
  const src = read(DISPATCHER_REL);
  assert.match(
    src,
    /function dispatchCommunication|dispatchCommunication\s*=|exports\.dispatchCommunication/,
    "le dispatcher doit exposer dispatchCommunication (ou équivalent audité) pour une politique de canaux explicite",
  );
});

test("RED-COM-04F — canal inconnu fail-closed, jamais traité comme PUSH", async () => {
  const adapter = createMemoryDeliveryAdapter({
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "parent-a@test.local" }],
  });
  await adapter.ensureDelivery({
    deliveryKey: "audit.unknown-channel:user-a:SMS",
    eventKey: "audit.unknown-channel",
    notificationId: null,
    schoolId: SCHOOL_A,
    userId: USER_A,
    channel: "SMS",
    payload: { title: "SMS interdit", body: "ne doit pas partir en PUSH" },
  });

  let pushCalled = false;
  const results = await drainChannelDeliveries(adapter, {
    pushStore: {
      async listActiveForUser() {
        return [
          {
            user_id: USER_A,
            school_id: SCHOOL_A,
            expo_push_token: "ExponentPushToken[sms-must-not-fanout]",
            backend_environment: "preproduction",
          },
        ];
      },
    },
    pushClient: {
      async sendToTokens() {
        pushCalled = true;
        return { sent: 1 };
      },
    },
    mailer: {
      async sendMail() {
        throw new Error("EMAIL interdit pour un canal SMS");
      },
    },
    env: {
      NODE_ENV: "test",
      APP_ENV: "preproduction",
      SMTP_HOST: "smtp.test.local",
      MAIL_FROM: "noreply@somafrik.app",
    },
  });

  assert.equal(
    pushCalled,
    false,
    "canal SMS (ou tout canal non supporté) ne doit jamais emprunter dispatchPush",
  );
  assert.equal(results.length, 1, "une delivery SMS doit être tranchée, pas ignorée silencieusement");
  assert.notEqual(results[0].status, "sent", "un canal inconnu ne doit pas être marqué sent");
  assert.match(
    String(results[0].reason || results[0].error || results[0].status),
    /skip|reject|unknown|unsupported|invalid/i,
    "un canal inconnu doit être skipped/rejected de façon contrôlée, sans fallback implicite",
  );
});

test("RED-COM-04J — le dispatcher ne contient aucun SDK / provider spécifique", () => {
  assert.equal(
    fs.existsSync(dispatcherPath()),
    true,
    "dispatcher absent : le contrat 04J (aucun Nodemailer/Expo/Brevo dans la façade) n'est pas encore applicable",
  );
  const src = read(DISPATCHER_REL);
  assert.doesNotMatch(
    src,
    /nodemailer|expoPushService|createExpoPushService|expo-server-sdk|@getbrevo|brevo|twilio|sendgrid|createSmtpTransport/i,
    "le dispatcher doit déléguer, jamais importer un SDK provider",
  );
});

test("AUDIT-COM-05 — unique caller runtime de fanOutNotificationChannels = dispatcher", () => {
  const runtimeFiles = [
    "backend/lib/communicationsNotificationsWorker.js",
    "backend/lib/communicationsNotificationsService.js",
    "backend/lib/communicationsDispatcher.js",
    "backend/lib/passwordResetNotification.js",
    "backend/lib/trialAccessRequestNotification.js",
    "backend/lib/trialAccessRequests.js",
    "backend/server.js",
  ];
  const fanoutCallers = runtimeFiles.filter((rel) => /await\s+fanOutNotificationChannels\s*\(/.test(read(rel)));
  assert.deepEqual(
    fanoutCallers,
    ["backend/lib/communicationsDispatcher.js"],
    "un second caller runtime de fanOutNotificationChannels créerait un double fan-out PUSH/EMAIL",
  );
  const dispatcherCallers = runtimeFiles.filter((rel) => /await\s+dispatchProcessedEvents\s*\(/.test(read(rel)));
  assert.deepEqual(
    dispatcherCallers,
    ["backend/lib/communicationsNotificationsWorker.js"],
    "runOnce doit rester l'unique caller de dispatchProcessedEvents",
  );
});
