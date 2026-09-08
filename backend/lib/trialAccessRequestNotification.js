"use strict";

/**
 * Intention EMAIL durable pour une demande d'essai.
 * Aucun SMTP ici : le drain C4 existant envoie via MAIL_FROM.
 */

const { createSqlDeliveryAdapter } = require("./communicationChannelFanout");
const {
  TRIAL_REQUEST_NOTIFY_TO,
  EXPECTED_TRIAL_REQUEST_EMAIL,
} = require("./trialAccessRequestNotification.emailCopy");

const TRIAL_ACCESS_REQUEST_KIND = "trial.access.request";

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function notifyTo() {
  const configured = String(process.env.TRIAL_REQUEST_NOTIFY_TO || "").trim();
  return configured || TRIAL_REQUEST_NOTIFY_TO;
}

function trialAccessRequestDeliveryKey(trialId) {
  return `trial.access.request:${asTrimmed(trialId)}:EMAIL`;
}

function buildTrialRequestNotificationEmail(request = {}) {
  return {
    to: notifyTo(),
    subject: EXPECTED_TRIAL_REQUEST_EMAIL.subject(request.schoolName),
    text: EXPECTED_TRIAL_REQUEST_EMAIL.text(request),
  };
}

function buildTrialRequestDeliveryPayload(request = {}) {
  const mail = buildTrialRequestNotificationEmail(request);
  return {
    kind: TRIAL_ACCESS_REQUEST_KIND,
    to: mail.to,
    title: mail.subject,
    body: mail.text,
  };
}

function resolveDeliveryAdapter(store, adapter) {
  if (adapter && typeof adapter.ensureDelivery === "function") return adapter;
  if (store && typeof store.ensureDelivery === "function") return store;
  if (store && typeof store.one === "function") return createSqlDeliveryAdapter(store);
  return null;
}

async function enqueueTrialAccessRequestNotification(store, request = {}, { adapter } = {}) {
  const deliveryAdapter = resolveDeliveryAdapter(store, adapter);
  if (!deliveryAdapter) return null;
  const trialId = asTrimmed(request.id);
  if (!trialId || trialId === "honeypot") return null;
  const payload = buildTrialRequestDeliveryPayload(request);
  const key = trialAccessRequestDeliveryKey(trialId);
  return deliveryAdapter.ensureDelivery({
    deliveryKey: key,
    eventKey: key,
    notificationId: null,
    schoolId: null,
    userId: null,
    channel: "EMAIL",
    payload,
  });
}

module.exports = {
  TRIAL_ACCESS_REQUEST_KIND,
  TRIAL_REQUEST_NOTIFY_TO,
  trialAccessRequestDeliveryKey,
  buildTrialRequestNotificationEmail,
  buildTrialRequestDeliveryPayload,
  enqueueTrialAccessRequestNotification,
};
