"use strict";

/**
 * Politique mince IN_APP | PUSH | EMAIL.
 *
 * Unique caller C4 : communicationsNotificationsWorker.runOnce, après drainOutbox.
 * Délègue PUSH/EMAIL à communicationChannelFanout (aucun SDK provider ici).
 * IN_APP n'est pas re-persisté : le propriétaire reste processOneEvent.
 */

const { fanOutNotificationChannels } = require("./communicationChannelFanout");

const SUPPORTED_CHANNELS = Object.freeze(["IN_APP", "PUSH", "EMAIL"]);
const EXTERNAL_CHANNELS = Object.freeze(["PUSH", "EMAIL"]);

const EVENT_EXTERNAL_CHANNEL_POLICY = Object.freeze({
  "communication.message.created": ["PUSH", "EMAIL"],
  "communication.announcement.published": ["PUSH", "EMAIL"],
  "attendance.student.absent": ["PUSH", "EMAIL"],
  "pedagogy.grade.published": ["PUSH", "EMAIL"],
  "finance.payment.recorded": ["PUSH", "EMAIL"],
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

function resolveChannels({ channels, eventType } = {}) {
  if (channels !== undefined) return normalizeChannels(channels);
  if (eventType) return normalizeChannels(policyChannelsForEventType(eventType));
  throw unsupportedChannel("undefined");
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
  void schoolId;
  void recipients;
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
  });
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
  const channels = externalChannelsOf(["PUSH", "EMAIL"]);
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
    channels,
  });
}

module.exports = {
  SUPPORTED_CHANNELS,
  EXTERNAL_CHANNELS,
  EVENT_EXTERNAL_CHANNEL_POLICY,
  normalizeChannels,
  policyChannelsForEventType,
  dispatchCommunication,
  dispatchProcessedEvents,
};
