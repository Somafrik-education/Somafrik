"use strict";

/**
 * Politique mince IN_APP | PUSH | EMAIL.
 *
 * Unique caller C4 : communicationsNotificationsWorker.runOnce, après drainOutbox.
 * Délègue PUSH/EMAIL à communicationChannelFanout (aucun SDK provider ici).
 * IN_APP n'est pas re-persisté : le propriétaire reste processOneEvent.
 *
 * Préférences = canaux (IN_APP | PUSH | EMAIL), jamais des fournisseurs.
 */

const { fanOutNotificationChannels } = require("./communicationChannelFanout");
const {
  defaultEnabledChannels,
  enabledChannelsForUser,
} = require("./communicationsPreferences");
const {
  resolveAllowedChannels,
  getDefaultSchoolNotificationSettings,
  getSchoolPolicyEventsBySchoolId,
} = require("./schoolNotificationPolicy");

const SUPPORTED_CHANNELS = Object.freeze(["IN_APP", "PUSH", "EMAIL"]);
const EXTERNAL_CHANNELS = Object.freeze(["PUSH", "EMAIL"]);

const EVENT_EXTERNAL_CHANNEL_POLICY = Object.freeze({
  "communication.message.created": ["PUSH", "EMAIL"],
  "communication.announcement.published": ["PUSH", "EMAIL"],
  "attendance.student.absent": ["PUSH", "EMAIL"],
  "pedagogy.grade.published": ["PUSH", "EMAIL"],
  "finance.payment.recorded": ["PUSH", "EMAIL"],
});

const EVENT_MANDATORY_CHANNEL_POLICY = Object.freeze({
  "auth.password.reset": ["EMAIL"],
});

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function unsupportedChannel(channel) {
  const label = asTrimmed(channel) || (channel === undefined ? "undefined" : "empty");
  const error = new Error(`unsupported_channel:${label}`);
  error.code = "unsupported_channel";
  return error;
}

function normalizeChannels(channels) {
  if (channels == null) {
    throw unsupportedChannel(channels === undefined ? "undefined" : "null");
  }
  if (!Array.isArray(channels)) {
    throw unsupportedChannel("malformed");
  }
  const normalized = [];
  for (const raw of channels) {
    if (typeof raw !== "string") {
      throw unsupportedChannel(raw);
    }
    const channel = asTrimmed(raw).toUpperCase();
    if (!channel) throw unsupportedChannel(raw);
    if (!SUPPORTED_CHANNELS.includes(channel)) {
      throw unsupportedChannel(channel);
    }
    if (!normalized.includes(channel)) normalized.push(channel);
  }
  return normalized;
}

function externalChannelsOf(channels) {
  return normalizeChannels(channels).filter((channel) => EXTERNAL_CHANNELS.includes(channel));
}

function policyChannelsForEventType(eventType) {
  const key = asTrimmed(eventType);
  const policy = EVENT_EXTERNAL_CHANNEL_POLICY[key];
  if (!policy) throw unsupportedChannel(key || "unknown_event");
  return [...policy];
}

function mandatoryChannelsForEvent(eventType) {
  const key = asTrimmed(eventType);
  const mandatory = EVENT_MANDATORY_CHANNEL_POLICY[key];
  return mandatory ? [...mandatory] : [];
}

function eventTypeFromKey(eventKey) {
  const key = asTrimmed(eventKey);
  if (!key) return "";
  const known = [
    ...Object.keys(EVENT_EXTERNAL_CHANNEL_POLICY),
    ...Object.keys(EVENT_MANDATORY_CHANNEL_POLICY),
  ].sort((left, right) => right.length - left.length);
  return known.find((type) => key === type || key.startsWith(`${type}:`)) || "";
}

function resolvePolicyChannels({ channels, eventType, eventPolicyChannels } = {}) {
  if (eventPolicyChannels !== undefined) return normalizeChannels(eventPolicyChannels);
  if (channels !== undefined) return normalizeChannels(channels);
  const key = asTrimmed(eventType);
  if (EVENT_EXTERNAL_CHANNEL_POLICY[key]) return policyChannelsForEventType(key);
  const mandatory = mandatoryChannelsForEvent(key);
  if (mandatory.length) return [...mandatory];
  if (eventType) return policyChannelsForEventType(eventType);
  throw unsupportedChannel("undefined");
}

function resolveUserEnabledChannels(userEnabledChannels) {
  if (userEnabledChannels == null) return defaultEnabledChannels();
  if (!Array.isArray(userEnabledChannels)) throw unsupportedChannel("malformed");
  if (!userEnabledChannels.length) return [];
  return normalizeChannels(userEnabledChannels);
}

function resolveEffectiveChannels({
  eventType,
  eventPolicyChannels,
  userEnabledChannels,
  channels,
} = {}) {
  const policy = resolvePolicyChannels({ channels, eventType, eventPolicyChannels });
  const mandatory = mandatoryChannelsForEvent(eventType);
  const enabled = new Set(resolveUserEnabledChannels(userEnabledChannels));
  const optional = policy.filter((channel) => enabled.has(channel));
  const effective = [];
  for (const channel of [...mandatory, ...optional]) {
    if (!SUPPORTED_CHANNELS.includes(channel)) continue;
    if (!effective.includes(channel)) effective.push(channel);
  }
  return effective;
}

function resolveChannels({ channels, eventType } = {}) {
  return resolvePolicyChannels({ channels, eventType });
}

async function loadSchoolPolicyEvents({ adapter, store, schoolId }) {
  if (adapter?.schoolNotificationPolicy) return adapter.schoolNotificationPolicy;
  if (typeof adapter?.loadSchoolNotificationPolicy === "function") {
    return adapter.loadSchoolNotificationPolicy({ schoolId });
  }
  if (store) return getSchoolPolicyEventsBySchoolId(store, schoolId);
  return getDefaultSchoolNotificationSettings().events;
}

async function loadEnabledChannels({ adapter, store, userId, schoolId }) {
  try {
    if (typeof adapter?.listEnabledChannels === "function") {
      return adapter.listEnabledChannels({ userId, schoolId });
    }
    if (store) return enabledChannelsForUser(store, { userId, schoolId });
    return defaultEnabledChannels();
  } catch {
    return defaultEnabledChannels();
  }
}

async function dispatchCommunication({
  eventKey,
  eventType,
  schoolId,
  recipients,
  channels,
  payload,
  adapter,
  store,
  repository,
  pushStore,
  pushClient,
  mailer,
  env,
  now,
  logger = console,
} = {}) {
  const resolved = resolveChannels({ channels, eventType });
  const providerChannels = resolved.filter((channel) => EXTERNAL_CHANNELS.includes(channel));
  void payload;
  if (!providerChannels.length) {
    return { channels: resolved, enqueued: 0, drained: [] };
  }
  const processed = eventKey ? [{ event_key: eventKey, eventKey, event_type: eventType }] : [];
  const drained = await fanOutNotificationChannels({
    store,
    repository,
    processed,
    adapter,
    pushStore,
    pushClient,
    mailer,
    env,
    now,
    logger,
    channels: providerChannels,
    resolveRecipientChannels: async (target) => {
      const resolvedType = target.event_type || eventType || eventTypeFromKey(target.event_key);
      const enabled = await loadEnabledChannels({
        adapter,
        store,
        userId: target.user_id,
        schoolId: target.school_id || schoolId,
      });
      const schoolPolicy = await loadSchoolPolicyEvents({
        adapter,
        store,
        schoolId: target.school_id || schoolId,
      });
      return resolveAllowedChannels({
        eventType: resolvedType,
        recipient: target.recipient_kind,
        schoolPolicy,
        userPreferences: enabled,
      }).filter((channel) => EXTERNAL_CHANNELS.includes(channel) && resolved.includes(channel));
    },
  });
  void recipients;
  return { channels: resolved, drained };
}

async function dispatchProcessedEvents({
  store,
  repository,
  processed = [],
  adapter,
  pushStore,
  pushClient,
  mailer,
  env,
  now,
  logger = console,
} = {}) {
  const policyChannels = externalChannelsOf(["PUSH", "EMAIL"]);
  return fanOutNotificationChannels({
    store,
    repository,
    processed,
    adapter,
    pushStore,
    pushClient,
    mailer,
    env,
    now,
    logger,
    channels: policyChannels,
    resolveRecipientChannels: async (target) => {
      const eventType = target.event_type || eventTypeFromKey(target.event_key);
      const enabled = await loadEnabledChannels({
        adapter,
        store,
        userId: target.user_id,
        schoolId: target.school_id,
      });
      const schoolPolicy = await loadSchoolPolicyEvents({
        adapter,
        store,
        schoolId: target.school_id,
      });
      return resolveAllowedChannels({
        eventType,
        recipient: target.recipient_kind,
        schoolPolicy,
        userPreferences: enabled,
      }).filter((channel) => EXTERNAL_CHANNELS.includes(channel) && policyChannels.includes(channel));
    },
  });
}

module.exports = {
  SUPPORTED_CHANNELS,
  EXTERNAL_CHANNELS,
  EVENT_EXTERNAL_CHANNEL_POLICY,
  EVENT_MANDATORY_CHANNEL_POLICY,
  normalizeChannels,
  policyChannelsForEventType,
  mandatoryChannelsForEvent,
  resolveEffectiveChannels,
  dispatchCommunication,
  dispatchProcessedEvents,
};
