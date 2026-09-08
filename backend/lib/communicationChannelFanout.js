"use strict";

/**
 * Fan-out PUSH / EMAIL après persist C4 in-app.
 * Hors processOneEvent : un échec fournisseur ne rollback ni l'outbox ni la notification.
 */

const nodemailer = require("nodemailer");
const { uuidOrNull } = require("./principalIdentity");
const { resolvePushBackendEnvironment } = require("./mobilePushDevicesService");
const { createExpoPushService } = require("./expoPushService");
const { enabledChannelsFromRows } = require("./communicationsPreferences");

const CHANNELS = Object.freeze(["PUSH", "EMAIL"]);
const MAX_ATTEMPTS = 8;
const DRAIN_LIMIT = 50;
const RETRY_BASE_MS = 5000;
const RETRY_CAP_MS = 15 * 60 * 1000;
const STALE_LEASE_MS = 2 * 60 * 1000;
const STALE_PROCESSING_REASON = "stale_processing_no_redelivery";
const SMTP_NOT_CONFIGURED = "smtp_not_configured";

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function deliveryKey(eventKey, userId, channel) {
  return `${asTrimmed(eventKey)}:${asTrimmed(userId)}:${asTrimmed(channel).toUpperCase()}`;
}

function eventKeyOf(row = {}) {
  return asTrimmed(row.event_key || row.eventKey);
}

function smtpConfigured(env = process.env) {
  return Boolean(asTrimmed(env.SMTP_HOST) && asTrimmed(env.MAIL_FROM));
}

function createSmtpTransport(env = process.env) {
  const port = Number(env.SMTP_PORT || 587);
  const secure = asTrimmed(env.SMTP_SECURE).toLowerCase() === "true" || port === 465;
  const user = asTrimmed(env.SMTP_USER);
  const options = { host: env.SMTP_HOST, port, secure };
  if (user) {
    options.auth = { user, pass: env.SMTP_PASSWORD || "" };
  }
  return nodemailer.createTransport(options);
}

function retryDelayMs(attempts) {
  const exp = Math.max(0, Number(attempts) || 0);
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.min(exp, 10));
}

function createSqlDeliveryAdapter(store) {
  const one = (sql, params) => store.one(sql, params);
  const all = (sql, params) => store.all(sql, params);
  const query = (sql, params) => store.query(sql, params);

  return {
    async loadFanoutTargets(eventKey) {
      const key = asTrimmed(eventKey);
      if (!key || typeof all !== "function") return [];
      return all(
        `SELECT n.id AS notification_id, n.event_key, n.event_type, n.school_id, n.title, n.body, n.navigation_target,
                r.user_id, r.recipient_kind
         FROM communication_notifications n
         JOIN notification_recipients r
           ON r.notification_id = n.id AND r.school_id = n.school_id
         WHERE n.event_key = $1`,
        [key],
      );
    },

    async ensureDelivery(row) {
      if (typeof one !== "function") return null;
      return one(
        `INSERT INTO communication_channel_deliveries (
           delivery_key, event_key, notification_id, school_id, user_id, channel, status, payload, available_at
         ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7::jsonb, NOW())
         ON CONFLICT (delivery_key) DO NOTHING
         RETURNING *`,
        [
          row.deliveryKey,
          row.eventKey,
          row.notificationId,
          row.schoolId,
          row.userId,
          row.channel,
          JSON.stringify(row.payload || {}),
        ],
      );
    },

    async recoverStaleProcessing({ now = new Date() } = {}) {
      if (typeof all !== "function") return [];
      return all(
        `UPDATE communication_channel_deliveries
         SET status='skipped', last_error=$2, updated_at=NOW()
         WHERE status='processing'
           AND claimed_at < $1::timestamptz - INTERVAL '2 minutes'
         RETURNING *`,
        [now.toISOString(), STALE_PROCESSING_REASON],
      );
    },

    async claimDue({ now = new Date() } = {}) {
      const claim = async (tx) => {
        const row = await tx.one(
          `SELECT * FROM communication_channel_deliveries
           WHERE attempts < $2
             AND status IN ('pending','failed')
             AND available_at <= $1
           ORDER BY available_at, id
           FOR UPDATE SKIP LOCKED LIMIT 1`,
          [now.toISOString(), MAX_ATTEMPTS],
        );
        if (!row) return null;
        await tx.query(
          `UPDATE communication_channel_deliveries
           SET status='processing', claimed_at=$2, attempts=attempts+1, updated_at=NOW()
           WHERE id=$1`,
          [row.id, now.toISOString()],
        );
        return { ...row, attempts: Number(row.attempts || 0) + 1, status: "processing" };
      };
      if (typeof store.withTransaction === "function") {
        return store.withTransaction(claim);
      }
      return claim({ one, query });
    },

    async markSent(id, { providerRef = null, now = new Date() } = {}) {
      return one(
        `UPDATE communication_channel_deliveries
         SET status='sent', sent_at=$2, last_error=NULL, provider_ref=$3, updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [id, now.toISOString(), providerRef],
      );
    },

    async markSkipped(id, reason) {
      return one(
        `UPDATE communication_channel_deliveries
         SET status='skipped', last_error=$2, updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [id, asTrimmed(reason).slice(0, 500)],
      );
    },

    async markFailed(id, error, { attempts = 0, now = new Date() } = {}) {
      const exhausted = Number(attempts) >= MAX_ATTEMPTS;
      const next = exhausted
        ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
        : new Date(now.getTime() + retryDelayMs(attempts));
      return one(
        `UPDATE communication_channel_deliveries
         SET status='failed', last_error=$2, available_at=$3, updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [id, String(error?.message || error).slice(0, 500), next.toISOString()],
      );
    },

    async getUserEmail(userId, schoolId) {
      const row = await one(
        `SELECT email FROM users
         WHERE id = $1 AND school_id = $2 AND COALESCE(status,'active') = 'active'
         LIMIT 1`,
        [userId, schoolId],
      );
      return asTrimmed(row?.email);
    },
  };
}

function createMemoryDeliveryAdapter({ notifications = [], recipients = [], users = [], preferences = [] } = {}) {
  const deliveries = [];
  return {
    notifications,
    recipients,
    users,
    deliveries,
    preferences,
    async listEnabledChannels({ userId, schoolId }) {
      const rows = preferences.filter(
        (row) => String(row.user_id) === String(userId) && String(row.school_id) === String(schoolId),
      );
      return enabledChannelsFromRows(rows);
    },
    async loadFanoutTargets(eventKey) {
      const key = asTrimmed(eventKey);
      const notes = notifications.filter((row) => asTrimmed(row.event_key || row.eventKey) === key);
      const rows = [];
      for (const note of notes) {
        for (const recipient of recipients) {
          if (String(recipient.notification_id) !== String(note.id)) continue;
          if (String(recipient.school_id) !== String(note.school_id)) continue;
          rows.push({
            notification_id: note.id,
            event_key: note.event_key || note.eventKey,
            event_type: note.event_type || note.eventType,
            school_id: note.school_id,
            title: note.title,
            body: note.body,
            navigation_target: note.navigation_target || note.navigationTarget || {},
            user_id: recipient.user_id,
            recipient_kind: recipient.recipient_kind || recipient.recipientKind || recipient.kind,
          });
        }
      }
      return rows;
    },
    async ensureDelivery(row) {
      const existing = deliveries.find((item) => item.delivery_key === row.deliveryKey);
      if (existing) return null;
      const saved = {
        id: require("node:crypto").randomUUID(),
        delivery_key: row.deliveryKey,
        event_key: row.eventKey,
        notification_id: row.notificationId,
        school_id: row.schoolId,
        user_id: row.userId,
        channel: row.channel,
        status: "pending",
        attempts: 0,
        available_at: new Date().toISOString(),
        payload: row.payload || {},
        last_error: null,
        sent_at: null,
      };
      deliveries.push(saved);
      return { ...saved };
    },
    async recoverStaleProcessing({ now = new Date() } = {}) {
      const stale = new Date(now.getTime() - STALE_LEASE_MS).toISOString();
      const recovered = [];
      for (const item of deliveries) {
        if (item.status !== "processing" || !item.claimed_at || item.claimed_at >= stale) continue;
        item.status = "skipped";
        item.last_error = STALE_PROCESSING_REASON;
        recovered.push({ ...item });
      }
      return recovered;
    },
    async claimDue({ now = new Date() } = {}) {
      const ts = now.toISOString();
      const row = deliveries.find(
        (item) =>
          item.attempts < MAX_ATTEMPTS &&
          ["pending", "failed"].includes(item.status) &&
          item.available_at <= ts,
      );
      if (!row) return null;
      row.status = "processing";
      row.claimed_at = ts;
      row.attempts += 1;
      return { ...row };
    },
    async markSent(id, { providerRef = null, now = new Date() } = {}) {
      const row = deliveries.find((item) => item.id === id);
      if (!row) return null;
      row.status = "sent";
      row.sent_at = now.toISOString();
      row.last_error = null;
      row.provider_ref = providerRef;
      return { ...row };
    },
    async markSkipped(id, reason) {
      const row = deliveries.find((item) => item.id === id);
      if (!row) return null;
      row.status = "skipped";
      row.last_error = asTrimmed(reason).slice(0, 500);
      return { ...row };
    },
    async markFailed(id, error, { attempts = 0, now = new Date() } = {}) {
      const row = deliveries.find((item) => item.id === id);
      if (!row) return null;
      row.status = "failed";
      row.last_error = String(error?.message || error).slice(0, 500);
      const exhausted = Number(attempts) >= MAX_ATTEMPTS;
      row.available_at = new Date(
        now.getTime() + (exhausted ? 365 * 24 * 60 * 60 * 1000 : retryDelayMs(attempts)),
      ).toISOString();
      return { ...row };
    },
    async getUserEmail(userId, schoolId) {
      const row = users.find(
        (item) => String(item.id) === String(userId) && String(item.school_id) === String(schoolId),
      );
      return asTrimmed(row?.email);
    },
  };
}

function providerChannelsOf(channels = CHANNELS) {
  const requested = [...new Set((channels || CHANNELS).map((item) => asTrimmed(item).toUpperCase()))];
  return requested.filter((channel) => CHANNELS.includes(channel));
}

async function enqueueChannelDeliveries(adapter, processed = [], channels = CHANNELS, options = {}) {
  const keys = [...new Set((processed || []).map(eventKeyOf).filter(Boolean))];
  const providerChannels = providerChannelsOf(channels);
  const resolveRecipientChannels = options.resolveRecipientChannels;
  const logger = options.logger || console;
  let created = 0;
  for (const eventKey of keys) {
    const targets = await adapter.loadFanoutTargets(eventKey);
    for (const target of targets) {
      const schoolId = uuidOrNull(target.school_id);
      const userId = uuidOrNull(target.user_id);
      if (!schoolId || !userId) continue;
      let recipientChannels = providerChannels;
      if (typeof resolveRecipientChannels === "function") {
        try {
          recipientChannels = providerChannelsOf(
            await resolveRecipientChannels(target, providerChannels),
          );
        } catch (error) {
          logger.error?.("[communications-c4] preference lookup failed, enqueue policy channels", {
            eventKey,
            userId,
            schoolId,
            message: String(error?.message || error).slice(0, 300),
          });
          recipientChannels = providerChannels;
        }
      }
      for (const channel of recipientChannels) {
        const inserted = await adapter.ensureDelivery({
          deliveryKey: deliveryKey(eventKey, userId, channel),
          eventKey,
          notificationId: target.notification_id,
          schoolId,
          userId,
          channel,
          payload: {
            title: target.title,
            body: target.body,
            navigationTarget: target.navigation_target || {},
          },
        });
        if (inserted) created += 1;
      }
    }
  }
  return created;
}

function asPayload(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? raw : {};
}

function scopedDevices(devices, { userId, schoolId, backendEnvironment }) {
  return (devices || []).filter((row) => {
    return (
      String(row.user_id) === String(userId) &&
      String(row.school_id) === String(schoolId) &&
      asTrimmed(row.backend_environment) === asTrimmed(backendEnvironment) &&
      !row.revoked_at
    );
  });
}

async function dispatchPush(row, { pushStore, pushClient, env = process.env }) {
  const userId = uuidOrNull(row.user_id);
  const schoolId = uuidOrNull(row.school_id);
  if (!userId || !schoolId) return { skipped: "missing_school_or_user" };
  let backendEnvironment;
  try {
    backendEnvironment = resolvePushBackendEnvironment(env);
  } catch {
    return { skipped: "invalid_backend_environment" };
  }
  if (typeof pushStore?.listActiveForUser !== "function") {
    return { skipped: "push_store_unavailable" };
  }
  const listed = await pushStore.listActiveForUser({ userId, schoolId, backendEnvironment });
  const devices = scopedDevices(listed, { userId, schoolId, backendEnvironment });
  if (!devices.length) return { skipped: "no_active_devices" };
  if (typeof pushClient?.sendToTokens !== "function") {
    return { skipped: "push_client_unavailable" };
  }
  const payload = asPayload(row.payload);
  const result = await pushClient.sendToTokens(
    devices.map((device) => device.expo_push_token),
    {
      title: payload.title || "Somafrik",
      body: payload.body || "",
      data: { somafrikDestination: "Home", eventKey: row.event_key },
      channelId: "somafrik-default",
    },
  );
  return { sent: result?.sent ?? devices.length, providerRef: `expo:${row.delivery_key}` };
}

function operationalTrialEmailTo(row, payload) {
  if (uuidOrNull(row.user_id) && uuidOrNull(row.school_id)) return "";
  if (asTrimmed(payload.kind) !== "trial.access.request") return "";
  return asTrimmed(payload.to);
}

async function dispatchEmail(row, { adapter, mailer, env = process.env }) {
  if (!smtpConfigured(env)) return { skipped: SMTP_NOT_CONFIGURED };
  const payload = asPayload(row.payload);
  const userId = uuidOrNull(row.user_id);
  const schoolId = uuidOrNull(row.school_id);
  let to = "";
  if (userId && schoolId) {
    to = await adapter.getUserEmail(userId, schoolId);
    if (!to) return { skipped: "no_recipient_email" };
  } else {
    to = operationalTrialEmailTo(row, payload);
    if (!to) return { skipped: "missing_school_or_user" };
  }
  const send = mailer?.sendMail
    ? mailer.sendMail.bind(mailer)
    : async (message) => {
        const transporter = createSmtpTransport(env);
        await transporter.sendMail({
          from: env.MAIL_FROM,
          to: message.to,
          subject: message.subject,
          text: message.text,
          headers: {
            "Idempotency-Key": row.delivery_key,
            "Message-ID": `<${row.delivery_key}@somafrik.app>`,
          },
        });
      };
  await send({
    to,
    subject: payload.title || "Somafrik",
    text: payload.body || "",
    deliveryKey: row.delivery_key,
  });
  return { sent: 1, providerRef: `smtp:${row.delivery_key}` };
}

async function drainChannelDeliveries(adapter, deps = {}) {
  const now = deps.now ? new Date(deps.now()) : new Date();
  // At-most-once: a stale processing lease is closed as skipped, never redispatched.
  // Residual: crash after claim and before the provider call also skips (lost send).
  if (typeof adapter.recoverStaleProcessing === "function") {
    await adapter.recoverStaleProcessing({ now });
  }
  const results = [];
  for (let i = 0; i < DRAIN_LIMIT; i += 1) {
    const row = await adapter.claimDue({ now });
    if (!row) break;
    try {
      const channel = asTrimmed(row.channel).toUpperCase();
      let outcome;
      if (channel === "EMAIL") {
        outcome = await dispatchEmail(row, { adapter, mailer: deps.mailer, env: deps.env });
      } else if (channel === "PUSH") {
        outcome = await dispatchPush(row, {
          pushStore: deps.pushStore,
          pushClient: deps.pushClient,
          env: deps.env,
        });
      } else {
        outcome = { skipped: "unsupported_channel" };
      }
      if (outcome?.skipped === SMTP_NOT_CONFIGURED) {
        await adapter.markFailed(row.id, new Error(SMTP_NOT_CONFIGURED), {
          attempts: row.attempts,
          now: deps.now ? new Date(deps.now()) : new Date(),
        });
        results.push({ id: row.id, status: "failed", reason: SMTP_NOT_CONFIGURED });
      } else if (outcome?.skipped) {
        await adapter.markSkipped(row.id, outcome.skipped);
        results.push({ id: row.id, status: "skipped", reason: outcome.skipped });
      } else {
        await adapter.markSent(row.id, { providerRef: outcome?.providerRef });
        results.push({ id: row.id, status: "sent", channel: row.channel });
      }
    } catch (error) {
      await adapter.markFailed(row.id, error, {
        attempts: row.attempts,
        now: deps.now ? new Date(deps.now()) : new Date(),
      });
      results.push({ id: row.id, status: "failed", error: String(error?.message || error) });
    }
  }
  return results;
}

function defaultPushDeps(repository) {
  const pushStore =
    typeof repository?.getMobilePushStore === "function" ? repository.getMobilePushStore() : null;
  return {
    pushStore,
    pushClient: createExpoPushService({ store: pushStore }),
  };
}

function resolveFanoutDeliveryAdapter(store, adapter) {
  if (adapter && typeof adapter.ensureDelivery === "function") return adapter;
  if (
    store &&
    typeof store.ensureDelivery === "function" &&
    typeof store.claimDue === "function"
  ) {
    return store;
  }
  return createSqlDeliveryAdapter(store);
}

async function fanOutNotificationChannels({
  store,
  repository,
  processed = [],
  adapter,
  pushStore,
  pushClient,
  mailer,
  env = process.env,
  now,
  logger = console,
  channels,
  resolveRecipientChannels,
} = {}) {
  const deliveryAdapter = resolveFanoutDeliveryAdapter(store, adapter);
  const pushDeps =
    pushStore || pushClient
      ? { pushStore, pushClient }
      : defaultPushDeps(repository);
  try {
    await enqueueChannelDeliveries(deliveryAdapter, processed, channels || CHANNELS, {
      resolveRecipientChannels,
      logger,
    });
    return await drainChannelDeliveries(deliveryAdapter, {
      ...pushDeps,
      mailer,
      env,
      now,
    });
  } catch (error) {
    logger.error?.("[communications-c4] channel fan-out failed", {
      message: String(error?.message || error).slice(0, 300),
    });
    return [];
  }
}

module.exports = {
  CHANNELS,
  MAX_ATTEMPTS,
  STALE_LEASE_MS,
  STALE_PROCESSING_REASON,
  SMTP_NOT_CONFIGURED,
  deliveryKey,
  smtpConfigured,
  createSqlDeliveryAdapter,
  createMemoryDeliveryAdapter,
  enqueueChannelDeliveries,
  drainChannelDeliveries,
  fanOutNotificationChannels,
};
