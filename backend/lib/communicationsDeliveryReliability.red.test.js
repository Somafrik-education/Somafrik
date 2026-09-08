"use strict";

/**
 * Lot K RED — Delivery Reliability & Retry (PUSH / EMAIL).
 * Contrats volontaires : ils échouent sur develop@d4c896b8 jusqu'au GREEN indépendant.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createMemoryDeliveryAdapter,
  enqueueChannelDeliveries,
  drainChannelDeliveries,
  MAX_ATTEMPTS,
  STALE_LEASE_MS,
} = require("./communicationChannelFanout");

const ROOT = path.resolve(__dirname, "../..");
const SCHOOL_A = "11111111-1111-4111-8111-111111111111";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const NOTE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const EVENT_KEY = "attendance.student.absent:cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const TOKEN_A = "ExponentPushToken[school-a]";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

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
  };
}

function pushOnlyAdapter() {
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
  });
  return adapter;
}

function pushDeps({ sendToTokens, now } = {}) {
  return {
    pushStore: createPushStore([
      {
        user_id: USER_A,
        school_id: SCHOOL_A,
        expo_push_token: TOKEN_A,
        backend_environment: "preproduction",
      },
    ]),
    pushClient: { sendToTokens },
    mailer: { async sendMail() {} },
    env: envPreprod(),
    now,
  };
}

test("RED-COM-08A — tentatives épuisées passent en dead_letter et ne sont plus claimed", async () => {
  const adapter = pushOnlyAdapter();
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  adapter.deliveries.find((row) => row.channel === "EMAIL").status = "skipped";
  let calls = 0;
  const base = Date.now();
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    await drainChannelDeliveries(
      adapter,
      pushDeps({
        async sendToTokens() {
          calls += 1;
          throw new Error("Expo 503");
        },
        now: () => new Date(base + i * 16 * 60 * 1000),
      }),
    );
  }
  const push = adapter.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(push.attempts, MAX_ATTEMPTS);
  assert.equal(push.status, "dead_letter", "après MAX_ATTEMPTS la delivery doit être dead_letter, pas failed+365j");
  const later = new Date(base + MAX_ATTEMPTS * 16 * 60 * 1000);
  await drainChannelDeliveries(
    adapter,
    pushDeps({
      async sendToTokens() {
        calls += 1;
        return { sent: 1 };
      },
      now: () => later,
    }),
  );
  assert.equal(calls, MAX_ATTEMPTS);
  assert.equal(push.status, "dead_letter");
});

test("RED-COM-08B — processing périmé sans appel fournisseur est récupérable (un seul envoi)", async () => {
  const adapter = pushOnlyAdapter();
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  adapter.deliveries.find((row) => row.channel === "EMAIL").status = "skipped";
  const claimed = await adapter.claimDue();
  assert.equal(claimed.channel, "PUSH");
  assert.equal(claimed.status, "processing");
  assert.equal(claimed.dispatch_started_at || null, null);
  let sent = 0;
  const later = new Date(Date.now() + STALE_LEASE_MS + 1000);
  await drainChannelDeliveries(
    adapter,
    pushDeps({
      async sendToTokens(tokens) {
        sent += 1;
        assert.deepEqual(tokens, [TOKEN_A]);
        return { sent: 1 };
      },
      now: () => later,
    }),
  );
  const push = adapter.deliveries.find((row) => row.channel === "PUSH");
  assert.equal(sent, 1, "un worker mort avant Expo/SMTP ne doit pas perdre l'envoi");
  assert.equal(push.status, "sent");
});

test("RED-COM-08C — snapshot diagnostic sans PII (compteurs, tentatives, last_error)", async () => {
  const fanout = require("./communicationChannelFanout");
  assert.equal(
    typeof fanout.summarizeChannelDeliveryHealth,
    "function",
    "summarizeChannelDeliveryHealth manquant",
  );
  const adapter = createMemoryDeliveryAdapter({
    notifications: [baseNote()],
    recipients: [{ notification_id: NOTE_ID, school_id: SCHOOL_A, user_id: USER_A }],
    users: [{ id: USER_A, school_id: SCHOOL_A, email: "parent-a@test.local" }],
  });
  await enqueueChannelDeliveries(adapter, [{ event_key: EVENT_KEY }]);
  adapter.deliveries.find((row) => row.channel === "EMAIL").status = "skipped";
  await drainChannelDeliveries(
    adapter,
    pushDeps({
      async sendToTokens() {
        throw new Error("Expo 503 parent-a@test.local " + TOKEN_A);
      },
    }),
  );
  const snapshot = fanout.summarizeChannelDeliveryHealth(adapter.deliveries);
  assert.equal(snapshot.counts.failed, 1);
  assert.ok(snapshot.counts.sent === 0 || snapshot.counts.sent >= 0);
  assert.ok(Number(snapshot.byChannel.PUSH.failed) >= 1);
  assert.ok(Array.isArray(snapshot.recentErrors));
  assert.ok(snapshot.recentErrors[0].attempts >= 1);
  const json = JSON.stringify(snapshot);
  assert.doesNotMatch(json, /parent-a@test\.local/);
  assert.doesNotMatch(json, /ExponentPushToken/);
  assert.doesNotMatch(json, /delivery_key/);
  assert.doesNotMatch(json, /"payload"/);
  assert.doesNotMatch(json, /SMTP_PASSWORD/);
});

test("RED-COM-08D — recoverStaleProcessing distingue reclaim vs no_redelivery", () => {
  const fanout = read("backend/lib/communicationChannelFanout.js");
  const recover = fanout.slice(fanout.indexOf("async recoverStaleProcessing"), fanout.indexOf("async claimDue"));
  assert.equal(/dispatch_started_at/.test(recover), true, "recoverStaleProcessing doit lire dispatch_started_at");
  assert.equal(
    /stale_lease_reclaimed|status='failed'|status="failed"/.test(recover),
    true,
    "lease périmée sans dispatch doit revenir en failed (reclaim)",
  );
  assert.equal(
    /markDispatchStarted|dispatch_started_at/.test(fanout),
    true,
    "marqueur dispatch_started_at / markDispatchStarted manquant",
  );
  const sqlClaim = fanout.slice(fanout.indexOf("async claimDue"), fanout.indexOf("async markSent"));
  assert.match(sqlClaim, /status IN \('pending','failed'\)/);
  assert.doesNotMatch(sqlClaim, /status = 'processing' AND claimed_at/);
  assert.doesNotMatch(sqlClaim, /dead_letter/);
});

test("RED-COM-08E — route diagnostic Superadmin/Admin sans données sensibles", () => {
  const server = read("backend/server.js");
  const rbac = read("backend/services/rbacService.js");
  const schema = read("backend/db/communicationsNotificationsSchema.js");
  const fanout = read("backend/lib/communicationChannelFanout.js");
  assert.equal(
    /\/api\/backoffice\/communications\/deliveries\/health/.test(server),
    true,
    "GET /api/backoffice/communications/deliveries/health manquant",
  );
  assert.equal(
    /GET \/api\/backoffice\/communications\/deliveries\/health/.test(rbac),
    true,
    "RBAC deliveries/health manquant",
  );
  assert.equal(/dispatch_started_at/.test(schema), true, "colonne dispatch_started_at manquante");
  assert.equal(/dead_letter/.test(fanout), true, "statut dead_letter manquant dans le fan-out");
});
