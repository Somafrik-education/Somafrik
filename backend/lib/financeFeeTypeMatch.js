"use strict";

/**
 * Alignement libellé paiement (Mobile/Web) ↔ type d'obligation canonique.
 * Les grilles créent Inscription | Mensualité | Annexe.
 * Mobile envoie Scolarité | Inscription | Cantine ; le Web envoie « Minerval / scolarité ».
 * Sans cet alias, createPayment n'alloue rien : amount_paid reste 0 alors que le reçu existe.
 */

const { normalizeKey } = require("./financeManagement");

function feeTypeToken(value) {
  return normalizeKey(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function isTuitionFamily(token) {
  return (
    token === "mensualite" ||
    token === "scolarite" ||
    token === "minerval" ||
    token === "minerval scolarite" ||
    token.includes("scolarite") ||
    token.includes("minerval")
  );
}

function obligationMatchesPaymentFeeType(obligation, paymentFeeType) {
  const pay = feeTypeToken(paymentFeeType);
  const type = feeTypeToken(obligation?.feeType);
  const label = feeTypeToken(obligation?.label);
  if (!pay) return false;
  if (type && type === pay) return true;

  if (isTuitionFamily(pay) && (isTuitionFamily(type) || isTuitionFamily(label))) return true;

  if (pay.includes("reinscription") && (type === "inscription" || label.includes("reinscription"))) {
    return true;
  }

  if (pay.includes("cantine")) {
    return type === "cantine" || label.includes("cantine");
  }
  if (pay.includes("examen")) {
    return type.includes("examen") || label.includes("examen");
  }
  if (pay.includes("bulletin")) {
    return label.includes("bulletin") || type.includes("bulletin");
  }
  if (pay.includes("transport")) {
    return label.includes("transport") || type.includes("transport");
  }
  if ((pay === "autre frais" || pay.includes("autre frais")) && type === "annexe") {
    return true;
  }

  return false;
}

module.exports = {
  feeTypeToken,
  isTuitionFamily,
  obligationMatchesPaymentFeeType,
};
