"use strict";

const { drainOutbox } = require("./communicationsNotificationsService");

let timer = null;
let running = false;

function resolveStore(repository) {
  if (!repository) return null;
  return typeof repository.getClientsStore === "function" ? repository.getClientsStore() : repository;
}

async function runOnce(repository, logger = console) {
  if (running) return [];
  const store = resolveStore(repository);
  if (!store || typeof store.withTransaction !== "function") return [];
  running = true;
  try {
    return await drainOutbox(store, { limit: Number(process.env.COMMUNICATION_NOTIFICATIONS_BATCH || 50) });
  } catch (error) {
    logger.error?.("[communications-c4] outbox dispatch failed", {
      message: String(error?.message || error).slice(0, 300),
    });
    return [];
  } finally {
    running = false;
  }
}

function startCommunicationsNotificationsWorker(repository, logger = console) {
  if (process.env.NODE_ENV === "test" || process.env.COMMUNICATION_NOTIFICATIONS_WORKER === "disabled") {
    return null;
  }
  if (timer) return timer;
  const intervalMs = Math.max(1000, Number(process.env.COMMUNICATION_NOTIFICATIONS_POLL_MS || 5000));
  void runOnce(repository, logger);
  timer = setInterval(() => {
    void runOnce(repository, logger);
  }, intervalMs);
  timer.unref?.();
  return timer;
}

function stopCommunicationsNotificationsWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

module.exports = {
  runOnce,
  startCommunicationsNotificationsWorker,
  stopCommunicationsNotificationsWorker,
};
