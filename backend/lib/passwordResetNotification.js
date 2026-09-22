"use strict";

/**
 * Email transactionnel de reset : commande durable EMAIL, jamais de SMTP dans la txn Auth.
 * Le mot de passe provisoire ne transite pas dans le payload.
 */

const { uuidOrNull } = require("./principalIdentity");
const { createSqlDeliveryAdapter } = require("./communicationChannelFanout");

const PASSWORD_RESET_EVENT_PREFIX = "auth.password.reset";

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function passwordResetDeliveryKey(userId, resetId) {
  return `${PASSWORD_RESET_EVENT_PREFIX}:${asTrimmed(userId)}:${asTrimmed(resetId)}`;
}

function buildPasswordResetEmailPayload({ firstName, lastName, schoolName } = {}) {
  const name = [firstName, lastName].map(asTrimmed).filter(Boolean).join(" ");
  const school = asTrimmed(schoolName);
  const greeting = name ? `${name},` : "Bonjour,";
  const who = school
    ? `Un administrateur de ${school} a réinitialisé votre accès Somafrik.`
    : "Un administrateur a réinitialisé votre accès Somafrik.";
  return {
    title: "Votre mot de passe Somafrik a été réinitialisé",
    body: [
      greeting,
      who,
      "Connectez-vous avec le mot de passe provisoire qui vous a été communiqué par votre administrateur, puis changez-le à la première connexion.",
      "Si vous n'êtes pas à l'origine de cette demande, contactez immédiatement l'administration de votre établissement.",
    ].join("\n\n"),
  };
}

function resolveDeliveryAdapter(store, adapter) {
  if (adapter && typeof adapter.ensureDelivery === "function") return adapter;
  if (store && typeof store.ensureDelivery === "function") return store;
  if (store && typeof store.one === "function") return createSqlDeliveryAdapter(store);
  return null;
}

async function enqueuePasswordResetNotification(store, { user = {}, deliveryKey, schoolName, adapter } = {}) {
  const deliveryAdapter = resolveDeliveryAdapter(store, adapter);
  if (!deliveryAdapter) return null;
  const userId = uuidOrNull(user.id || user.userId);
  const schoolId = uuidOrNull(user.schoolId || user.school_id);
  if (!userId || !schoolId) return null;
  const key = asTrimmed(deliveryKey) || passwordResetDeliveryKey(userId, require("node:crypto").randomUUID());
  const payload = buildPasswordResetEmailPayload({
    firstName: user.firstName || user.first_name,
    lastName: user.lastName || user.last_name,
    schoolName: schoolName || user.schoolName || user.school_name,
  });
  return deliveryAdapter.ensureDelivery({
    deliveryKey: key,
    eventKey: key,
    notificationId: null,
    schoolId,
    userId,
    channel: "EMAIL",
    payload,
  });
}

module.exports = {
  PASSWORD_RESET_EVENT_PREFIX,
  passwordResetDeliveryKey,
  buildPasswordResetEmailPayload,
  enqueuePasswordResetNotification,
};
