"use strict";

/**
 * Compatibilité de lecture paiement ↔ obligation.
 * L'autorité est financeFeeTypes (codes). Les aliases ne sont plus une loi métier.
 *
 * Historique Annexe : uniquement le contrat déjà validé
 *   Cantine → Annexe dont le label est Cantine
 *   Annexe  → Annexe (type legacy, pas au catalogue)
 */

const { resolveFeeType, feeTypeToken, isUnallocatedFeeTypeInput } = require("./financeFeeTypes");

function isCantineToken(token) {
  return token === "cantine" || token === "annexe cantine";
}

function obligationMatchesPaymentFeeType(obligation, paymentFeeType) {
  if (isUnallocatedFeeTypeInput(paymentFeeType)) return false;

  const pay = resolveFeeType(paymentFeeType, { mode: "read" });
  const obl = resolveFeeType(obligation?.feeType, { mode: "read" });
  if (pay && obl) return pay.code === obl.code;

  const payToken = feeTypeToken(paymentFeeType);
  const typeToken = feeTypeToken(obligation?.feeType);
  const labelToken = feeTypeToken(obligation?.label);
  if (!payToken) return false;
  if (typeToken && typeToken === payToken) return true;

  if (pay?.code === "CANTEEN" && typeToken === "annexe" && isCantineToken(labelToken)) return true;
  if (isCantineToken(payToken) && typeToken === "annexe" && isCantineToken(labelToken)) return true;
  return false;
}

module.exports = {
  feeTypeToken,
  obligationMatchesPaymentFeeType,
};
