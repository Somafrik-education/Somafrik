"use strict";

const { readVapidConfig } = require("./webPushSubscriptionsService");

const EXPIRED_STATUSES = new Set([404, 410]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function statusOf(error) {
  const status = Number(error?.statusCode ?? error?.status ?? 0);
  return Number.isFinite(status) ? status : 0;
}

function createWebPushService({
  store,
  webpushImpl,
  env = process.env,
} = {}) {
  async function revokeExpired(endpoint) {
    if (typeof store?.revokeByEndpoint !== "function") return null;
    return store.revokeByEndpoint(endpoint);
  }

  async function sendOne(impl, vapid, subscription, payload) {
    impl.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    await impl.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      payload,
      { TTL: 60 * 60 },
    );
  }

  async function sendToSubscriptions(subscriptions, message = {}) {
    const vapid = readVapidConfig(env);
    if (!vapid) {
      return { sent: 0, skipped: "vapid_not_configured", revoked: [] };
    }
    const impl = webpushImpl || require("web-push");
    const payload = JSON.stringify({
      title: asTrimmed(message.title) || "Somafrik",
      body: asTrimmed(message.body),
      data: message.data && typeof message.data === "object" ? message.data : {},
    });
    let sent = 0;
    const revoked = [];
    for (const subscription of subscriptions || []) {
      const endpoint = asTrimmed(subscription?.endpoint);
      if (!endpoint) continue;
      try {
        await sendOne(impl, vapid, subscription, payload);
        sent += 1;
      } catch (error) {
        if (EXPIRED_STATUSES.has(statusOf(error))) {
          const row = await revokeExpired(endpoint);
          if (row?.id) revoked.push(row.id);
          continue;
        }
        throw error;
      }
    }
    return { sent, revoked };
  }

  return { sendToSubscriptions };
}

module.exports = {
  createWebPushService,
  EXPIRED_STATUSES,
};
