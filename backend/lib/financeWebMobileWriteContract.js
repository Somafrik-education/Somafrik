"use strict";

/**
 * F5 — contrat d'écriture Finance Web ↔ Mobile.
 * Les deux clients doivent produire le même payload d'imputation.
 * Ce module est l'autorité de forme ; PostgreSQL / financeService restent
 * l'autorité de calcul (allocation, solde, Non imputé, pending, annulation).
 */

const UNALLOCATED_FEE_TYPE = "Non imputé";
const UNALLOCATED_TARGET = "__unallocated__";

function trim(value) {
  return String(value ?? "").trim();
}

function parseFinanceAmount(value) {
  const amount = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(amount) ? amount : Number.NaN;
}

function isUnallocatedTarget(value) {
  return trim(value) === UNALLOCATED_TARGET;
}

function financeObligationIdRequired() {
  const error = new Error("FINANCE_OBLIGATION_ID_REQUIRED");
  error.code = "FINANCE_OBLIGATION_ID_REQUIRED";
  return error;
}

function normalizeObligationStatus(status) {
  return trim(status)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Lecture d'une obligation depuis la projection serveur.
 * Jamais un solde recalculé côté client : si `balance` n'est pas numérique, l'obligation n'est pas ouverte.
 */
function isOpenObligationFromProjection(fee) {
  if (!fee || typeof fee !== "object") return false;
  if (fee.archivedAt || fee.archived_at) return false;
  const status = normalizeObligationStatus(fee.status);
  if (
    status === "annule" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "paye" ||
    status === "exonere"
  ) {
    return false;
  }
  const balance = Number(fee.balance);
  return Number.isFinite(balance) && balance > 0;
}

function collectOpenObligationsFromProjection(studentId, fees) {
  const wanted = trim(studentId).toUpperCase();
  if (!wanted) return [];
  const rows = Array.isArray(fees) ? fees : [];
  const open = [];
  for (const fee of rows) {
    const id = trim(fee?.id ?? fee?.obligationId);
    if (!id) continue;
    if (isUnallocatedTarget(id)) continue;
    if (trim(fee?.studentId).toUpperCase() !== wanted) continue;
    if (!isOpenObligationFromProjection(fee)) continue;
    const balance = Number(fee.balance);
    const label = trim(fee.label) || trim(fee.feeType) || "Frais";
    open.push({
      obligationId: id,
      schoolFeeItemId: trim(fee.schoolFeeItemId ?? fee.school_fee_item_id),
      feeType: trim(fee.feeType) || label,
      feeTypeCode: trim(fee.feeTypeCode ?? fee.fee_type_code),
      label,
      periodLabel: trim(fee.periodLabel ?? fee.period_label),
      amountDue: Number(fee.amountDue ?? fee.amount_due),
      amountPaid: Number(fee.amountPaid ?? fee.amount_paid),
      exemption: Number(fee.exemption ?? 0),
      balance,
      status: trim(fee.status),
      dueDate: trim(fee.dueDate ?? fee.due_date),
      academicYear: trim(fee.academicYear ?? fee.academic_year),
      classId: trim(fee.classId ?? fee.class_id),
      className: trim(fee.className ?? fee.class_name),
      currency: trim(fee.currency),
    });
  }
  return open;
}

function buildFinancePaymentItems(lines) {
  const rows = Array.isArray(lines) ? lines : [];
  return rows.map((line) => {
    const amount =
      typeof line.amount === "number" ? line.amount : parseFinanceAmount(line.amount);
    if (isUnallocatedTarget(line.obligationId)) {
      return { feeType: UNALLOCATED_FEE_TYPE, amount };
    }
    const obligationId = trim(line.obligationId);
    if (!obligationId) {
      throw financeObligationIdRequired();
    }
    const item = {
      obligationId,
      amount,
    };
    const feeType = trim(line.feeType || line.feeLabel || line.label);
    if (feeType && feeType !== UNALLOCATED_FEE_TYPE) item.feeType = feeType;
    const feeLabel = trim(line.feeLabel || line.label || feeType);
    if (feeLabel) item.feeLabel = feeLabel;
    return item;
  });
}

function assertNoFeeTypeOnlyImputation(items) {
  for (const item of Array.isArray(items) ? items : []) {
    const obligationId = trim(item.obligationId);
    const feeType = trim(item.feeType || item.feeLabel || item.label);
    if (!obligationId && feeType !== UNALLOCATED_FEE_TYPE) {
      throw financeObligationIdRequired();
    }
  }
}

function buildFinancePaymentWritePayload(input) {
  const items = Array.isArray(input.items)
    ? input.items
    : buildFinancePaymentItems(input.lines || []);
  assertNoFeeTypeOnlyImputation(items);
  const method = trim(input.method || input.paymentMethod);
  const date = trim(input.date || input.paidAt);
  const payload = {
    studentId: trim(input.studentId),
    classId: trim(input.classId),
    method,
    paymentMethod: method,
    date,
    paidAt: date,
    items,
  };
  const comment = trim(input.comment);
  if (comment) payload.comment = comment;
  return payload;
}

function presentPaymentCashFromProjection(payment) {
  const received = Number(payment?.amount ?? payment?.totalAmount ?? 0);
  const allocated = Number(payment?.allocatedAmount ?? 0);
  const unallocated = Number(payment?.unallocatedAmount ?? 0);
  return {
    received: Number.isFinite(received) ? received : 0,
    allocated: Number.isFinite(allocated) ? allocated : 0,
    unallocated: Number.isFinite(unallocated) ? unallocated : 0,
  };
}

function isPendingPaymentStatus(status) {
  const key = normalizeObligationStatus(status);
  return key.includes("attente") || key === "pending";
}

module.exports = {
  UNALLOCATED_FEE_TYPE,
  UNALLOCATED_TARGET,
  parseFinanceAmount,
  isUnallocatedTarget,
  isOpenObligationFromProjection,
  collectOpenObligationsFromProjection,
  buildFinancePaymentItems,
  assertNoFeeTypeOnlyImputation,
  buildFinancePaymentWritePayload,
  presentPaymentCashFromProjection,
  isPendingPaymentStatus,
};
