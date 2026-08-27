"use strict";

/**
 * Reçu unique (payments) + lignes de libellés (payment_items).
 * Le total serveur = SUM(items). Le total client n'est jamais une autorité.
 * Inventaire historique 1:1 — jamais de fusion par (élève, date).
 */

const { FINANCE_ERROR, createFinanceError, asTrimmed, normalizeKey, money } = require("./financeManagement");

const PAYMENT_ITEM_ERROR = Object.freeze({
  ITEMS_REQUIRED: "PAYMENT_ITEMS_REQUIRED",
  ITEM_AMOUNT_INVALID: "PAYMENT_ITEM_AMOUNT_INVALID",
  FEE_TYPE_REQUIRED: "PAYMENT_FEE_TYPE_REQUIRED",
  FEE_ITEM_NOT_FOUND: "FEE_ITEM_NOT_FOUND",
  FEE_ITEM_TENANT_MISMATCH: "FEE_ITEM_TENANT_MISMATCH",
});

const METHOD_ALIASES = Object.freeze({
  cash: "Espèces",
  especes: "Espèces",
  "espèces": "Espèces",
  mobile: "Mobile money",
  "mobile money": "Mobile money",
  mobile_money: "Mobile money",
  virement: "Virement bancaire",
  "bank transfer": "Virement bancaire",
  card: "Carte bancaire",
  cheque: "Chèque",
  "chèque": "Chèque",
});

function resolvePaymentMethod(payload = {}) {
  const raw = asTrimmed(payload.paymentMethod || payload.method);
  if (!raw) return "";
  const alias = METHOD_ALIASES[normalizeKey(raw)];
  return alias || raw;
}

function resolvePaidAt(payload = {}) {
  return payload.paidAt || payload.date;
}

function mapPaymentItemRow(row = {}) {
  return {
    id: row.id,
    feeTypeId: row.school_fee_item_id || row.feeTypeId || null,
    feeType: row.fee_type || row.feeType || "",
    feeLabel: row.fee_label || row.feeLabel || row.fee_type || row.feeType || "",
    amount: money(row.amount),
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
  };
}

function itemsDetailLabel(items = []) {
  if (!items.length) return "—";
  if (items.length === 1) return items[0].feeLabel || items[0].feeType || "1 libellé";
  return `${items.length} libellés`;
}

function decoratePaymentWithItems(payment, items = []) {
  const mapped = items.map(mapPaymentItemRow);
  const totalAmount = money(
    mapped.length ? mapped.reduce((sum, item) => sum + money(item.amount), 0) : payment?.amount,
  );
  return {
    ...payment,
    amount: totalAmount,
    totalAmount,
    items: mapped,
    itemCount: mapped.length,
    itemsDetail: itemsDetailLabel(mapped),
    feeType: mapped.length <= 1 ? mapped[0]?.feeType || payment.feeType || "" : itemsDetailLabel(mapped),
    label: mapped.length <= 1 ? mapped[0]?.feeLabel || payment.label || "" : itemsDetailLabel(mapped),
  };
}

function normalizeWriteItems(payload = {}) {
  const rawItems = Array.isArray(payload.items) ? payload.items : null;
  if (rawItems) {
    if (!rawItems.length) {
      throw createFinanceError(
        400,
        "Le reçu doit contenir au moins un libellé.",
        PAYMENT_ITEM_ERROR.ITEMS_REQUIRED,
      );
    }
    return rawItems;
  }
  const legacyType = asTrimmed(payload.feeType || payload.feeLabel || payload.label);
  const legacyAmount = payload.amount;
  if (legacyType || legacyAmount != null || payload.obligationId) {
    return [
      {
        feeTypeId: payload.feeTypeId || payload.schoolFeeItemId || null,
        feeType: legacyType,
        feeLabel: legacyType,
        amount: legacyAmount,
        obligationId: payload.obligationId || null,
      },
    ];
  }
  throw createFinanceError(
    400,
    "Le reçu doit contenir au moins un libellé.",
    PAYMENT_ITEM_ERROR.ITEMS_REQUIRED,
  );
}

function assertItemAmount(amount) {
  if (!(money(amount) > 0)) {
    throw createFinanceError(
      400,
      "Chaque libellé doit avoir un montant strictement positif.",
      PAYMENT_ITEM_ERROR.ITEM_AMOUNT_INVALID,
    );
  }
}

function inventoryHistoricalPayments(stats = {}) {
  return {
    payments: Number(stats.payments || 0),
    paymentsWithItems: Number(stats.paymentsWithItems || 0),
    paymentsWithoutItems: Number(stats.paymentsWithoutItems || 0),
    mergeByStudentAndDate: false,
    backfillStrategy: "one-payment-one-item",
  };
}

module.exports = {
  PAYMENT_ITEM_ERROR,
  resolvePaymentMethod,
  resolvePaidAt,
  mapPaymentItemRow,
  itemsDetailLabel,
  decoratePaymentWithItems,
  normalizeWriteItems,
  assertItemAmount,
  inventoryHistoricalPayments,
};