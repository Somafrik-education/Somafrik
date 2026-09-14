"use strict";

/**
 * P0 #645 — contrat RED préprod / preview.
 * Jetons de test uniquement : ExponentPushToken[p0-…] — jamais un jeton réel.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  upsertFromSession,
  sendSelfTest,
  resolveStoredPushScope,
  assertPushSelfTestAllowed,
  TEST_CONFIRM,
} = require("./mobilePushDevicesService");
const { SOMAFRIK_PUSH_CHANNEL_ID } = require("./expoPushService");
const { processDuePushReceipts } = require("./expoPushReceiptsWorker");
const { createMemoryMobilePushDevicesStore } = require("../db/mobilePushDevicesStore");

const ROOT = path.resolve(__dirname, "../..");
const TOKEN = "ExponentPushToken[p0-preview-device]";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function throwsStatus(fn, status) {
  assert.throws(fn, (error) => error.statusCode === status);
}

function preprodEnv(extra = {}) {
  return {
    NODE_ENV: "test",
    APP_ENV: "preproduction",
    SOMAFRIK_PUSH_SELFTEST_ENABLED: "true",
    ...extra,
  };
}

function memoryStore() {
  const devices = [];
  return {
    devices,
    async resolveSchoolId(code) {
      return code === "SCH-A" ? "11111111-1111-4111-8111-111111111111" : null;
    },
    async upsertDevice(row) {
      const existing = devices.find((item) => item.expo_push_token === row.expoPushToken);
      const saved = {
        id: existing?.id || "dev-p0-1",
        user_id: row.userId,
        school_id: row.schoolId,
        expo_push_token: row.expoPushToken,
        platform: row.platform,
        backend_environment: row.backendEnvironment,
        app_profile: row.appProfile,
        revoked_at: null,
        last_seen_at: new Date().toISOString(),
      };
      if (existing) Object.assign(existing, saved);
      else devices.push(saved);
      return saved;
    },
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

async function main() {
  const serviceSrc = read("backend/lib/mobilePushDevicesService.js");
  const runtimeSrc = read("Mobile/src/components/PushNotificationsRuntime.tsx");
  const mobileSrc = read("Mobile/src/services/pushNotifications.ts");
  const appConfig = read("Mobile/app.config.js");
  const plugin = read("Mobile/plugins/withSomafrikAndroidSecurity.js");
  const preprodExample = read(".env.preproduction.example");
  const preprodCompose = read("docker-compose.preprod.yml");
  const docsPush = fs.existsSync(path.join(ROOT, "docs/mobile/PUSH-PREVIEW-PREPROD.md"))
    ? read("docs/mobile/PUSH-PREVIEW-PREPROD.md")
    : "";

  assert.equal(SOMAFRIK_PUSH_CHANNEL_ID, "somafrik-default-v2");
  assert.match(appConfig, /defaultChannel:\s*"somafrik-default-v2"/);
  assert.doesNotMatch(appConfig, /blockedPermissions[\s\S]*POST_NOTIFICATIONS/);
  assert.doesNotMatch(plugin, /POST_NOTIFICATIONS/);
  assert.match(mobileSrc, /requestPermissionsAsync/);
  assert.match(mobileSrc, /setNotificationChannelAsync\(SOMAFRIK_PUSH_CHANNEL_ID/);
  assert.match(mobileSrc, /AndroidImportance\?\.HIGH/);

  assert.doesNotMatch(
    runtimeSrc,
    /registerAuthenticatedPushDevice\(\)\.catch\(\(\) => undefined\)/,
    "enregistrement device : l'échec ne doit pas être absorbé silencieusement",
  );
  assert.match(
    runtimeSrc,
    /push device registration failed|observePushRegistration/,
    "échec d'enregistrement runtime doit être journalisé / observable",
  );
  assert.match(
    mobileSrc,
    /push device registration failed/,
    "registerAuthenticatedPushDevice doit journaliser l'échec (sans jeton)",
  );
  assert.match(mobileSrc, /getLastPushRegistrationOutcome/);

  assert.doesNotMatch(serviceSrc, /channelId:\s*"somafrik-default"/);
  assert.match(serviceSrc, /SOMAFRIK_PUSH_CHANNEL_ID/);
  assert.match(preprodExample, /SOMAFRIK_PUSH_SELFTEST_ENABLED/);
  assert.match(preprodCompose, /SOMAFRIK_PUSH_SELFTEST_ENABLED: \$\{SOMAFRIK_PUSH_SELFTEST_ENABLED:-false\}/);
  assert.match(
    docsPush,
    /SOMAFRIK_PUSH_SELFTEST_ENABLED/,
    "prérequis self-test préprod documenté (sans modifier le secret Render)",
  );
  assert.match(docsPush, /somafrik-default-v2/);
  assert.match(docsPush, /FCM V1|EAS/);

  const previewOnPreprod = resolveStoredPushScope({ appProfile: "preview" }, { APP_ENV: "preproduction" });
  assert.deepEqual(previewOnPreprod, { backendEnvironment: "preproduction", appProfile: "preview" });
  throwsStatus(() => resolveStoredPushScope({ appProfile: "preview" }, { APP_ENV: "production" }), 400);
  throwsStatus(() => assertPushSelfTestAllowed({ APP_ENV: "preproduction" }), 403);
  throwsStatus(
    () => assertPushSelfTestAllowed({ APP_ENV: "preproduction", SOMAFRIK_PUSH_SELFTEST_ENABLED: "false" }),
    403,
  );
  assert.equal(assertPushSelfTestAllowed(preprodEnv()), "preproduction");

  const store = memoryStore();
  const principal = {
    sub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    schoolCode: "SCH-A",
    permissions: ["Push:TEST"],
  };
  const env = preprodEnv();
  const upserted = await upsertFromSession(
    store,
    principal,
    { expoPushToken: TOKEN, platform: "android", appProfile: "preview" },
    env,
  );
  assert.equal(upserted.platform, "android");
  assert.equal(upserted.appProfile, "preview");
  assert.equal(upserted.backendEnvironment, "preproduction");
  assert.equal(store.devices[0].user_id, principal.sub);
  assert.equal(store.devices[0].school_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(store.devices[0].revoked_at, null);
  assert.doesNotMatch(JSON.stringify(upserted), /ExponentPushToken/);

  let seenMessage = null;
  const pushClient = {
    async sendToTokens(tokens, message) {
      seenMessage = message;
      assert.equal(tokens.length, 1);
      assert.doesNotMatch(JSON.stringify(message), /ExponentPushToken/);
      return {
        sent: 1,
        ticketCount: 1,
        revoked: [],
        pendingReceipts: [{ receiptId: "ticket-ok-p0" }],
        publicTickets: [{ status: "ok", id: "ticket-ok-p0", error: null }],
      };
    },
  };
  const sent = await sendSelfTest(store, principal, { confirm: TEST_CONFIRM }, pushClient, env);
  assert.equal(sent.sent, 1);
  assert.equal(seenMessage.channelId, "somafrik-default-v2");
  assert.ok(sent.proof, "self-test doit renvoyer une preuve exploitable");
  assert.equal(sent.proof.channelId, "somafrik-default-v2");
  assert.equal(sent.proof.pendingReceipts, 1);
  assert.equal(sent.proof.tickets[0].status, "ok");
  assert.equal(sent.proof.tickets[0].id, "ticket-ok-p0");
  assert.doesNotMatch(JSON.stringify(sent), /ExponentPushToken/);
  assert.doesNotMatch(JSON.stringify(sent), /p0-preview-device/);

  const deadClient = {
    async sendToTokens() {
      return {
        sent: 1,
        ticketCount: 1,
        revoked: ["rev-dead"],
        pendingReceipts: [],
        publicTickets: [{ status: "error", id: null, error: "DeviceNotRegistered" }],
      };
    },
  };
  const dead = await sendSelfTest(store, principal, { confirm: TEST_CONFIRM }, deadClient, env);
  assert.equal(dead.proof.tickets[0].error, "DeviceNotRegistered");
  assert.ok(dead.revoked.length >= 1);

  const receiptStore = createMemoryMobilePushDevicesStore();
  await receiptStore.upsertDevice({
    userId: principal.sub,
    schoolId: "11111111-1111-4111-8111-111111111111",
    expoPushToken: "ExponentPushToken[p0-receipt-ok]",
    platform: "android",
    backendEnvironment: "preproduction",
    appProfile: "preview",
  });
  const t0 = Date.parse("2026-09-14T00:00:00.000Z");
  await receiptStore.enqueuePushReceipts(
    [{ receiptId: "rcpt-ok-p0", expoPushToken: "ExponentPushToken[p0-receipt-ok]" }],
    { delayMs: 0, ttlMs: 24 * 60 * 60 * 1000, now: t0 },
  );
  const okOutcomes = await processDuePushReceipts({
    store: receiptStore,
    pushClient: {
      async fetchReceipts() {
        return { "rcpt-ok-p0": { status: "ok" } };
      },
    },
    now: t0,
  });
  assert.equal(okOutcomes[0].status, "ok");
  const stillActive = await receiptStore.getByToken("ExponentPushToken[p0-receipt-ok]");
  assert.equal(stillActive.revoked_at, null, "receipt ok : appareil reste actif");

  await receiptStore.enqueuePushReceipts(
    [{ receiptId: "rcpt-dnr-p0", expoPushToken: "ExponentPushToken[p0-receipt-ok]" }],
    { delayMs: 0, ttlMs: 24 * 60 * 60 * 1000, now: t0 },
  );
  const dnrOutcomes = await processDuePushReceipts({
    store: receiptStore,
    pushClient: {
      async fetchReceipts() {
        return { "rcpt-dnr-p0": { status: "error", details: { error: "DeviceNotRegistered" } } };
      },
    },
    now: t0,
  });
  assert.equal(dnrOutcomes[0].revoked, true);
  const revoked = await receiptStore.getByToken("ExponentPushToken[p0-receipt-ok]");
  assert.ok(revoked.revoked_at, "receipt DeviceNotRegistered révoque le device");

  console.log("mobilePushP0.contract.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
