"use strict";

const { createHttpError } = require("./classesManagement");
const { isStudentCardCapabilityEnabled, mapSettingsRow } = require("./schoolSettingsManagement");
const { createSchoolSettingsPgStore } = require("../db/schoolSettingsPgStore");
const { hasAttendanceIntent } = require("./studentCardAttendance");
const { isDueDatePast, isOverdueStudentFee } = require("../services/unpaidService");
const {
  isUnallocatedStatus,
  isPendingCashStatus,
} = require("./financeUnallocatedCash");
const { isPaymentCancelled, isPaymentCounted, money } = require("./financeManagement");

const STUDENT_CARD_FINANCE_ERROR = Object.freeze({
  DISABLED: "STUDENT_CARD_FINANCE_CHECK_DISABLED",
  INTENTS_CONFLICT: "STUDENT_CARD_SCAN_INTENTS_CONFLICT",
  INTENT_INVALID: "STUDENT_CARD_FINANCE_INTENT_INVALID",
});

const FINANCE_BADGES = Object.freeze({
  UP_TO_DATE: Object.freeze({ code: "UP_TO_DATE", label: "À jour" }),
  PARTIAL: Object.freeze({ code: "PARTIAL", label: "Paiement partiel" }),
  OVERDUE: Object.freeze({ code: "OVERDUE", label: "Échéance impayée" }),
  REVIEW: Object.freeze({ code: "REVIEW", label: "Situation à vérifier" }),
});

const BADGE_RANK = Object.freeze({
  UP_TO_DATE: 0,
  PARTIAL: 1,
  OVERDUE: 2,
  REVIEW: 3,
});

function badge(code) {
  const source = FINANCE_BADGES[code] || FINANCE_BADGES.REVIEW;
  return { code: source.code, label: source.label };
}

function hasFinanceIntent(payload) {
  return Boolean(payload)
    && typeof payload === "object"
    && !Array.isArray(payload)
    && payload.finance === true;
}

function assertStudentCardScanIntents(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  if (Object.prototype.hasOwnProperty.call(payload, "finance")) {
    const value = payload.finance;
    if (value !== true && value !== false && value !== null) {
      throw createHttpError(
        400,
        "Intention finance invalide.",
        STUDENT_CARD_FINANCE_ERROR.INTENT_INVALID,
      );
    }
  }
  if (hasAttendanceIntent(payload) && hasFinanceIntent(payload)) {
    throw createHttpError(
      400,
      "Présence et finance sont des opérations indépendantes.",
      STUDENT_CARD_FINANCE_ERROR.INTENTS_CONFLICT,
    );
  }
}

function settingsStore(repo) {
  if (typeof repo.getSchoolSettingsStore === "function") {
    return repo.getSchoolSettingsStore();
  }
  return createSchoolSettingsPgStore(repo);
}

async function assertStudentCardFinanceEnabled(repo, schoolId) {
  const store = settingsStore(repo);
  const row = typeof store.getSettings === "function" ? await store.getSettings(schoolId) : null;
  if (!isStudentCardCapabilityEnabled(mapSettingsRow(row), "studentCardFinanceCheckEnabled")) {
    throw createHttpError(
      404,
      "Contrôle finance par carte désactivé.",
      STUDENT_CARD_FINANCE_ERROR.DISABLED,
    );
  }
}

function hasMixedCurrencies(fees) {
  const tokens = new Set();
  for (const fee of fees) {
    if (fee?.status === "Annulé") continue;
    tokens.add(String(fee?.currency ?? "").trim().toUpperCase());
  }
  return tokens.size > 1;
}

function hasUnallocatedCash(payments) {
  for (const payment of payments) {
    if (isPaymentCancelled(payment)) continue;
    if (isUnallocatedStatus(payment?.status)) return true;
    if (isPendingCashStatus(payment?.status)) continue;
    if (!isPaymentCounted(payment)) continue;
    if (money(payment?.unallocatedAmount) > 0) return true;
  }
  return false;
}

function obligationLevel(fee, now) {
  const status = fee?.status;
  if (status === "Annulé" || status === "Payé" || status === "Exonéré") return "UP_TO_DATE";
  const balance = Number(fee?.balance);
  if (!Number.isFinite(balance)) return "REVIEW";
  if (balance <= 0) return "UP_TO_DATE";
  if (isOverdueStudentFee(fee, now)) return "OVERDUE";
  if (status === "Partiellement payé" && !isDueDatePast(fee?.dueDate, now)) return "PARTIAL";
  if (status === "À payer" && !isDueDatePast(fee?.dueDate, now)) return "UP_TO_DATE";
  return "REVIEW";
}

/**
 * Badge D2=B. `now` est injectable pour des dates déterministes.
 * Priorité : REVIEW > OVERDUE > PARTIAL > UP_TO_DATE.
 */
function classifyStudentCardFinance({ fees, payments, applicableGrid = false, now = new Date() } = {}) {
  if (!Array.isArray(fees) || !Array.isArray(payments)) return badge("REVIEW");
  if (hasMixedCurrencies(fees) || hasUnallocatedCash(payments)) return badge("REVIEW");
  if (fees.length === 0) return badge(applicableGrid ? "REVIEW" : "UP_TO_DATE");
  let rank = BADGE_RANK.UP_TO_DATE;
  for (const fee of fees) {
    const level = obligationLevel(fee, now);
    if (level === "REVIEW") return badge("REVIEW");
    rank = Math.max(rank, BADGE_RANK[level]);
  }
  if (rank >= BADGE_RANK.OVERDUE) return badge("OVERDUE");
  if (rank >= BADGE_RANK.PARTIAL) return badge("PARTIAL");
  return badge("UP_TO_DATE");
}

async function scanStudentCardFinance(repo, resolved, principal, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  try {
    const studentId = resolved?.student?.id;
    const classId = resolved?.class?.id;
    if (!studentId || !classId) return badge("REVIEW");
    const [fees, payments, applicableGrid] = await Promise.all([
      repo.listFinanceStudentFees(principal, { studentId }),
      repo.listFinanceStudentPayments(principal, { studentId }),
      repo.hasApplicableActiveFeeGrid(principal, { classId }),
    ]);
    return classifyStudentCardFinance({
      fees,
      payments,
      applicableGrid: Boolean(applicableGrid),
      now,
    });
  } catch (error) {
    if (error?.statusCode) throw error;
    return badge("REVIEW");
  }
}

module.exports = {
  STUDENT_CARD_FINANCE_ERROR,
  FINANCE_BADGES,
  hasFinanceIntent,
  assertStudentCardScanIntents,
  assertStudentCardFinanceEnabled,
  classifyStudentCardFinance,
  scanStudentCardFinance,
};
