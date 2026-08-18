const {
  auditFullState,
  validateTouchedPayload,
  validateNoteWrite,
  validatePresenceWrite,
  validatePaymentWrite,
} = require("../lib/dataIntegrityRules");
const { BusinessError } = require("./authService");

function summarizeIssues(issues = []) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byCategory = {};
  for (const issue of issues) {
    const severity = issue.severity ?? "medium";
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    const category = issue.category ?? "other";
    byCategory[category] = (byCategory[category] ?? 0) + 1;
  }
  return {
    total: issues.length,
    bySeverity,
    byCategory,
    hasCritical: (bySeverity.critical ?? 0) > 0,
  };
}

function auditBackOfficeState(state = {}) {
  const issues = auditFullState(state);
  return {
    issues,
    summary: summarizeIssues(issues),
    ok: issues.filter((item) => item.severity === "critical").length === 0,
  };
}

function validateWritePayload(state = {}, payload = {}, touchedKeys = []) {
  const errors = validateTouchedPayload(state, payload, touchedKeys);
  return {
    ok: !errors.length,
    errors,
  };
}

function httpStatusForIntegrityMessage(message) {
  if (!message) return 400;
  if (/non validée|non validee|publiée|annulée|inactive/i.test(message)) return 409;
  if (/introuvable/i.test(message)) return 404;
  return 400;
}

function assertNoteWrite(state, note, options = {}) {
  const message = validateNoteWrite(state, note, options);
  if (!message) return;
  if (/non validée|non validee|publiée|annulée|inactive/i.test(message)) {
    const { createPedagogyError, PEDAGOGY_ERROR } = require("../lib/pedagogyManagement");
    throw createPedagogyError(409, message, PEDAGOGY_ERROR.EVALUATION_NOT_VALIDATED);
  }
  throw new BusinessError(httpStatusForIntegrityMessage(message), message);
}

function assertPresenceWrite(state, presence, options = {}) {
  const message = validatePresenceWrite(state, presence, options);
  if (message) throw new BusinessError(httpStatusForIntegrityMessage(message), message);
}

function assertPaymentWrite(state, payment, options = {}) {
  const message = validatePaymentWrite(state, payment, options);
  if (message) throw new BusinessError(httpStatusForIntegrityMessage(message), message);
}

module.exports = {
  auditBackOfficeState,
  validateWritePayload,
  assertNoteWrite,
  assertPresenceWrite,
  assertPaymentWrite,
  summarizeIssues,
};
