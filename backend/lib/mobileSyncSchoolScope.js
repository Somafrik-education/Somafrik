"use strict";

/**
 * GP-020 / SY-08 — Sync L1 refuse leftover school_code quand login_code est vide.
 * Une école résolue avec login_code NULL/vide ne peut pas servir d'autorité tenant.
 */

const { BusinessError } = require("../services/authService");

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function schoolHasLoginCodeField(school) {
  return (
    school &&
    (Object.prototype.hasOwnProperty.call(school, "login_code") ||
      Object.prototype.hasOwnProperty.call(school, "loginCode"))
  );
}

/**
 * Fail-closed si l'école PG a un login_code vide.
 * Les fixtures mémoire/unit sans colonne login_code restent inchangées.
 */
function assertMobileSyncCanonicalLoginCode(school) {
  if (!schoolHasLoginCodeField(school)) {
    return school;
  }
  const loginCode = asTrimmed(school.login_code ?? school.loginCode);
  if (!loginCode || loginCode === "*") {
    throw new BusinessError(403, "Accès refusé: établissement hors périmètre.");
  }
  return school;
}

module.exports = {
  assertMobileSyncCanonicalLoginCode,
  schoolHasLoginCodeField,
};
