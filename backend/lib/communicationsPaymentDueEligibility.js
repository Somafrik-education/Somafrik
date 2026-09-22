"use strict";

/**
 * Éligibilité canonique PAYMENT_DUE — partagée entre sweep et consommation outbox.
 * Alignée sur financeSchema : due_date < CURRENT_DATE (jour J exclus).
 */

const INELIGIBLE_STATUSES = Object.freeze(["Payé", "Exonéré", "Annulé"]);

function toIsoDate(value) {
  if (value == null || value === "") return null;
  const raw = value instanceof Date ? value.toISOString() : String(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function isPaymentDueEligible(obligation, { referenceDate = null } = {}) {
  if (!obligation) return false;
  if (obligation.archived_at) return false;
  if (obligation.cancelled_at) return false;
  const balance = Number(obligation.balance ?? 0);
  if (!(balance > 0)) return false;
  const amountDue = Number(obligation.amount_due ?? 0);
  const exemption = Number(obligation.exemption ?? 0);
  if (amountDue > 0 && exemption >= amountDue) return false;
  const status = String(obligation.status ?? "").trim();
  if (INELIGIBLE_STATUSES.includes(status)) return false;
  const dueDate = toIsoDate(obligation.due_date);
  if (!dueDate) return false;
  const ref = toIsoDate(referenceDate) || toIsoDate(new Date());
  if (!ref || dueDate >= ref) return false;
  return true;
}

function paymentDueEligibleSqlConditions(referenceDateParamIndex) {
  const dateExpr = referenceDateParamIndex
    ? `COALESCE($${referenceDateParamIndex}::date, CURRENT_DATE)`
    : "CURRENT_DATE";
  return `
    o.archived_at IS NULL
    AND (to_jsonb(o)->>'cancelled_at') IS NULL
    AND COALESCE(o.balance, 0) > 0
    AND NOT (COALESCE(o.exemption, 0) >= COALESCE(o.amount_due, 0) AND COALESCE(o.amount_due, 0) > 0)
    AND o.due_date IS NOT NULL
    AND o.due_date < ${dateExpr}
    AND o.status NOT IN ('Payé', 'Exonéré', 'Annulé')
  `;
}

module.exports = {
  INELIGIBLE_STATUSES,
  toIsoDate,
  isPaymentDueEligible,
  paymentDueEligibleSqlConditions,
};
