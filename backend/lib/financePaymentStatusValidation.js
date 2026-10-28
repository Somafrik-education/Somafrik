"use strict";

/** MONO-FIX-A5 — validation API des statuts financiers, sans upsert implicite sur PATCH. */
function paymentStatusError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
function textField(value, field, required) {
  if (value === undefined && !required) return;
  if (typeof value !== "string" || !value.trim()) {
    throw paymentStatusError(400, "FINANCE_PAYMENT_STATUS_INVALID", field + " doit être une chaîne non vide.");
  }
}
function assertPaymentStatusPayload(payload, { create = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw paymentStatusError(400, "FINANCE_PAYMENT_STATUS_INVALID", "Corps de statut financier invalide.");
  }
  textField(payload.code, "code", create);
  textField(payload.label, "label", create);
  if (payload.sortOrder !== undefined && (!Number.isFinite(Number(payload.sortOrder)) || payload.sortOrder === null || payload.sortOrder === "")) {
    throw paymentStatusError(400, "FINANCE_PAYMENT_STATUS_INVALID", "sortOrder invalide.");
  }
  if (payload.status !== undefined && !["Actif", "Inactif"].includes(payload.status)) {
    throw paymentStatusError(400, "FINANCE_PAYMENT_STATUS_INVALID", "status doit être Actif ou Inactif.");
  }
}
function assertKnownPaymentStatus(rows, statusId) {
  const code = String(statusId ?? "").trim();
  if (!code || !(rows ?? []).some((row) => String(row.code ?? row.statusCode ?? row.id ?? "").trim() === code)) {
    throw paymentStatusError(404, "FINANCE_PAYMENT_STATUS_NOT_FOUND", "Statut de paiement introuvable.");
  }
}
module.exports = { assertPaymentStatusPayload, assertKnownPaymentStatus };
