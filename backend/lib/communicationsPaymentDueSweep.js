"use strict";

/**
 * Lot L3 — producteur PAYMENT_DUE via balayage idempotent des obligations exigibles.
 * SoT : student_fee_obligations (due_date DATE, balance, statut Finance canonique).
 */

const { paymentDueEligibleSqlConditions } = require("./communicationsPaymentDueEligibility");

const PD_EVENT = "finance.payment.due";

function eventKeyForObligation(obligationId) {
  return `${PD_EVENT}:${obligationId}`;
}

function sweepDueSql(referenceDateParamIndex) {
  const eligible = paymentDueEligibleSqlConditions(referenceDateParamIndex);
  return `
    INSERT INTO communication_event_outbox (
      event_key, event_type, school_id, actor_user_id,
      source_entity_type, source_entity_id, occurred_at, payload, status, available_at
    )
    SELECT
      $1 || ':' || o.id::text,
      $1,
      o.school_id,
      NULL,
      'student_fee_obligation',
      o.id,
      NOW(),
      jsonb_build_object(
        'studentId', o.student_id,
        'obligationId', o.id,
        'dueDate', o.due_date,
        'feeType', o.fee_type,
        'periodLabel', o.period_label
      ),
      'pending',
      NOW()
    FROM student_fee_obligations o
    WHERE ${eligible}
      AND NOT EXISTS (
        SELECT 1 FROM communication_event_outbox e
        WHERE e.event_key = $1 || ':' || o.id::text
      )
    ORDER BY o.due_date, o.id
    LIMIT $2
    ON CONFLICT (event_key) DO NOTHING
    RETURNING id, event_key, event_type, school_id, source_entity_id
  `;
}

async function sweepPaymentDueOutbox(store, { limit = 100, referenceDate = null } = {}) {
  if (!store || typeof store.withTransaction !== "function") return [];
  const batch = Math.max(1, Math.min(500, Number(limit) || 100));
  return store.withTransaction(async (tx) => {
    const params = referenceDate ? [PD_EVENT, batch, referenceDate] : [PD_EVENT, batch];
    const sql = sweepDueSql(referenceDate ? 3 : null);
    const result = await tx.query(sql, params);
    return result.rows ?? [];
  });
}

module.exports = {
  PD_EVENT,
  eventKeyForObligation,
  sweepPaymentDueOutbox,
};
