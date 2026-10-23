"use strict";

/**
 * CARTE-BATCH-API-01 — précontrôle pur et sans effet de bord.
 *
 * Cette fonction n'émet aucune carte, ne génère aucun jeton et ne modifie pas PostgreSQL.
 * Les contrôles RBAC, tenant, scolarité courante et titulaire doivent être exécutés
 * côté route / service AVANT d'appeler ce planificateur.
 */
const BATCH_CARD_DECISIONS = Object.freeze({
  ISSUE_CANDIDATE: "issue_candidate",
  ALREADY_ACTIVE: "already_active",
  INELIGIBLE: "ineligible",
});

function planStudentCardBatch(rows) {
  if (!Array.isArray(rows)) throw new TypeError("Liste d'élèves invalide.");
  const seen = new Set();
  const entries = rows.map((row) => {
    const studentId = typeof row?.studentId === "string" ? row.studentId.trim() : "";
    if (!studentId || seen.has(studentId)) {
      throw new TypeError("Identifiant élève absent ou dupliqué.");
    }
    seen.add(studentId);
    const active = row.hasActiveCard === true;
    const eligible = row.eligible === true;
    const holderDetermined = row.holderKind === "eleve" || row.holderKind === "etudiant";
    const decision = active
      ? BATCH_CARD_DECISIONS.ALREADY_ACTIVE
      : eligible && holderDetermined
        ? BATCH_CARD_DECISIONS.ISSUE_CANDIDATE
        : BATCH_CARD_DECISIONS.INELIGIBLE;
    return {
      studentId,
      decision,
      reason: decision === BATCH_CARD_DECISIONS.INELIGIBLE
        ? !eligible ? "NOT_ELIGIBLE" : "HOLDER_UNDETERMINED"
        : null,
    };
  });
  return {
    entries,
    counts: {
      issueCandidates: entries.filter((x) => x.decision === BATCH_CARD_DECISIONS.ISSUE_CANDIDATE).length,
      alreadyActive: entries.filter((x) => x.decision === BATCH_CARD_DECISIONS.ALREADY_ACTIVE).length,
      ineligible: entries.filter((x) => x.decision === BATCH_CARD_DECISIONS.INELIGIBLE).length,
    },
  };
}

module.exports = { BATCH_CARD_DECISIONS, planStudentCardBatch };
