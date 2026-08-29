"use strict";

const assert = require("node:assert/strict");
const { createMemoryMobilePushDevicesStore } = require("../db/mobilePushDevicesStore");
const { processDuePushReceipts, MAX_RECEIPT_ATTEMPTS } = require("./expoPushReceiptsWorker");

async function main() {
  const store = createMemoryMobilePushDevicesStore();
  await store.upsertDevice({
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    schoolId: null,
    expoPushToken: "ExponentPushToken[alive]",
    platform: "android",
    releaseProfile: "preview",
  });

  const t0 = Date.parse("2026-08-29T12:00:00.000Z");
  await store.enqueuePushReceipts(
    [{ receiptId: "rcpt-1", expoPushToken: "ExponentPushToken[alive]" }],
    { delayMs: 15 * 60 * 1000, ttlMs: 24 * 60 * 60 * 1000, now: t0 },
  );

  const immediate = await store.listDuePushReceipts({ now: t0 + 1000 });
  assert.equal(immediate.length, 0, "aucun check considéré définitif immédiatement");

  const due = await store.listDuePushReceipts({ now: t0 + 15 * 60 * 1000 });
  assert.equal(due.length, 1);
  assert.equal(due[0].receipt_id, "rcpt-1");
  assert.equal(due[0].status, "pending");

  const outcomes = await processDuePushReceipts({
    store,
    pushClient: {
      async fetchReceipts() {
        return { "rcpt-1": { status: "error", details: { error: "DeviceNotRegistered" } } };
      },
    },
    now: t0 + 15 * 60 * 1000,
  });
  assert.equal(outcomes[0].revoked, true);
  const device = await store.getByToken("ExponentPushToken[alive]");
  assert.ok(device.revoked_at, "receipt différé DeviceNotRegistered révoque le token");

  const retryStore = createMemoryMobilePushDevicesStore();
  await retryStore.enqueuePushReceipts(
    [{ receiptId: "rcpt-retry", expoPushToken: "ExponentPushToken[retry]" }],
    { delayMs: 0, ttlMs: 24 * 60 * 60 * 1000, now: t0 },
  );
  const retryError = Object.assign(new Error("Expo Push HTTP 503"), { statusCode: 503, retryable: true });
  const retried = await processDuePushReceipts({
    store: retryStore,
    pushClient: {
      async fetchReceipts() {
        throw retryError;
      },
    },
    now: t0,
  });
  assert.equal(retried[0].status, "retry");
  const stillPending = await retryStore.listDuePushReceipts({ now: t0 });
  assert.equal(stillPending.length, 0, "next_check_at reculé");
  const later = await retryStore.listDuePushReceipts({ now: t0 + 60 * 60 * 1000 });
  assert.equal(later.length, 1);
  assert.equal(later[0].status, "pending");

  const expireStore = createMemoryMobilePushDevicesStore();
  await expireStore.enqueuePushReceipts(
    [{ receiptId: "rcpt-old", expoPushToken: "ExponentPushToken[old]" }],
    { delayMs: 0, ttlMs: 1000, now: t0 },
  );
  const expired = await processDuePushReceipts({
    store: expireStore,
    pushClient: {
      async fetchReceipts() {
        return {};
      },
    },
    now: t0 + 2000,
  });
  assert.equal(expired[0].status, "expired");
  const afterExpire = await expireStore.listDuePushReceipts({ now: t0 + 10 * 60 * 60 * 1000 });
  assert.equal(afterExpire.length, 0, "expiration : pas de boucle");

  const missingStore = createMemoryMobilePushDevicesStore();
  await missingStore.enqueuePushReceipts(
    [{ receiptId: "rcpt-miss", expoPushToken: "ExponentPushToken[miss]" }],
    { delayMs: 0, ttlMs: 24 * 60 * 60 * 1000, now: t0 },
  );
  for (let i = 0; i < MAX_RECEIPT_ATTEMPTS; i += 1) {
    await processDuePushReceipts({
      store: missingStore,
      pushClient: { async fetchReceipts() { return {}; } },
      now: t0 + i * 60 * 60 * 1000,
    });
  }
  const terminal = missingStore._receipts[0];
  assert.equal(terminal.status, "expired");

  console.log("expoPushReceiptsWorker.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
