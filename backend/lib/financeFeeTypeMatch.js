"use strict";

/**
 * Alignement libellé paiement (Mobile/Web) ↔ type d'obligation canonique.
 * Contrat validé uniquement :
 *   Scolarité → Mensualité
 *   Minerval / scolarité → Mensualité
 *   Inscription → Inscription
 *   Cantine → Annexe dont le label est Cantine
 * Pas d'alias implicite hors de cette liste.
 */

const { normalizeKey } = require("./financeManagement");

function feeTypeToken(value) {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function isTuitionPayment(token) {
  return token === "scolarite" || token === "minerval" || token === "minerval scolarite" || token === "mensualite";
}

function isCantineToken(token) {
  return token === "cantine" || token === "annexe cantine";
}

function obligationMatchesPaymentFeeType(obligation, paymentFeeType) {
  const pay = feeTypeToken(paymentFeeType);
  const type = feeTypeToken(obligation?.feeType);
  const label = feeTypeToken(obligation?.label);
  if (!pay) return false;

  if (type && type === pay) return true;
  if (isTuitionPayment(pay) && type === "mensualite") return true;
  if (isCantineToken(pay) && (type === "cantine" || (type === "annexe" && isCantineToken(label)))) return true;
  return false;
}

module.exports = {
  feeTypeToken,
  isTuitionPayment,
  obligationMatchesPaymentFeeType,
};
