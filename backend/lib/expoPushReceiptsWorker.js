"use strict";

const { createExpoPushService } = require("./expoPushService");

const MAX_RECEIPT_ATTEMPTS = 5;
const RETRY_BASE_MS = 5 * 60 * 1000;

let timer = null;
let running = false;

function isDeviceNotRegistered(receipt) {
  const error = receipt?.details?.error || receipt?.error;
  if (receipt?.status === "error" && String(error) === "DeviceNotRegistered") return true;
  const details = receipt?.details || receipt?.message || "";
  return typeof details === "string" && /DeviceNotRegistered/i.test(details);
}

function isRetryableReceiptError(error) {
  return Boolean(error?.retryable) || error?.statusCode === 429 || (error?.statusCode ?? 0) >= 500;
}

async function processDuePushReceipts({ store, pushClient, now = Date.now(), limit = 50, logger = console } = {}) {
  if (!store || typeof store.listDuePushReceipts !== "function") return [];
  const due = await store.listDuePushReceipts({ now, limit });
  if (!due.length) return [];

  const outcomes = [];
  const ids = due.map((row) => row.receipt_id);
  let receiptMap = {};
  try {
    receiptMap = (await pushClient.fetchReceipts(ids)) || {};
  } catch (error) {
    if (!isRetryableReceiptError(error)) {
      logger.error?.("[push-n1] receipts fetch failed", { message: String(error?.message || error).slice(0, 200) });
    }
    for (const row of due) {
      const attempts = Number(row.attempts || 0) + 1;
      const expired = new Date(row.expires_at).getTime() <= now || attempts >= MAX_RECEIPT_ATTEMPTS;
      if (expired) {
        await store.markPushReceipt(row.id, {
          status: "expired",
          attempts,
          lastError: "receipt_fetch_failed",
          checkedAt: now,
        });
        outcomes.push({ id: row.id, status: "expired" });
      } else {
        await store.markPushReceipt(row.id, {
          status: "pending",
          attempts,
          nextCheckAt: now + RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 3),
          lastError: "receipt_fetch_retry",
        });
        outcomes.push({ id: row.id, status: "retry" });
      }
    }
    return outcomes;
  }

  for (const row of due) {
    if (new Date(row.expires_at).getTime() <= now) {
      await store.markPushReceipt(row.id, {
        status: "expired",
        attempts: Number(row.attempts || 0),
        lastError: "receipt_expired",
        checkedAt: now,
      });
      outcomes.push({ id: row.id, status: "expired" });
      continue;
    }

    const receipt = receiptMap[row.receipt_id];
    if (!receipt) {
      const attempts = Number(row.attempts || 0) + 1;
      if (attempts >= MAX_RECEIPT_ATTEMPTS) {
        await store.markPushReceipt(row.id, {
          status: "expired",
          attempts,
          lastError: "receipt_missing",
          checkedAt: now,
        });
        outcomes.push({ id: row.id, status: "expired" });
      } else {
        await store.markPushReceipt(row.id, {
          status: "pending",
          attempts,
          nextCheckAt: now + RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 3),
          lastError: "receipt_not_ready",
        });
        outcomes.push({ id: row.id, status: "retry" });
      }
      continue;
    }

    if (isDeviceNotRegistered(receipt)) {
      if (typeof store.revokeByToken === "function") {
        await store.revokeByToken(row.expo_push_token);
      }
      await store.markPushReceipt(row.id, {
        status: "error",
        attempts: Number(row.attempts || 0) + 1,
        lastError: "DeviceNotRegistered",
        checkedAt: now,
      });
      outcomes.push({ id: row.id, status: "error", revoked: true });
      continue;
    }

    if (receipt.status === "ok") {
      await store.markPushReceipt(row.id, {
        status: "ok",
        attempts: Number(row.attempts || 0) + 1,
        lastError: null,
        checkedAt: now,
      });
      outcomes.push({ id: row.id, status: "ok" });
      continue;
    }

    await store.markPushReceipt(row.id, {
      status: "error",
      attempts: Number(row.attempts || 0) + 1,
      lastError: String(receipt?.details?.error || receipt?.message || "receipt_error").slice(0, 120),
      checkedAt: now,
    });
    outcomes.push({ id: row.id, status: "error" });
  }

  return outcomes;
}

async function runOnce(repository, logger = console) {
  if (running) return [];
  if (!repository || typeof repository.getMobilePushStore !== "function") return [];
  running = true;
  try {
    const store = repository.getMobilePushStore();
    const pushClient = createExpoPushService({ store });
    return await processDuePushReceipts({ store, pushClient, logger });
  } catch (error) {
    logger.error?.("[push-n1] receipt worker failed", {
      message: String(error?.message || error).slice(0, 300),
    });
    return [];
  } finally {
    running = false;
  }
}

function startExpoPushReceiptsWorker(repository, logger = console) {
  if (process.env.NODE_ENV === "test" || process.env.EXPO_PUSH_RECEIPTS_WORKER === "disabled") {
    return null;
  }
  if (timer) return timer;
  const intervalMs = Math.max(5000, Number(process.env.EXPO_PUSH_RECEIPTS_POLL_MS || 60_000));
  void runOnce(repository, logger);
  timer = setInterval(() => {
    void runOnce(repository, logger);
  }, intervalMs);
  timer.unref?.();
  return timer;
}

function stopExpoPushReceiptsWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

module.exports = {
  processDuePushReceipts,
  runOnce,
  startExpoPushReceiptsWorker,
  stopExpoPushReceiptsWorker,
  MAX_RECEIPT_ATTEMPTS,
};
