"use strict";

/**
 * Archivage réversible des doublons school_courses déjà tranchés par l'inventaire.
 *
 * Interdit :
 * - DELETE
 * - choix silencieux (needs_human)
 * - désactivation du fail-closed CANONICAL_SCHOOL_COURSE_AMBIGUOUS
 *
 * Idempotent : n'archive que les lignes encore active listées dans autoArchiveIds.
 * Réversible : restore status='active' pour les IDs archivés par apply.
 */

const ARCHIVE_PROPOSED_DUPLICATES_SQL = `
UPDATE school_courses
   SET status = 'archived',
       updated_at = NOW()
 WHERE id = ANY($1::uuid[])
   AND status = 'active'
RETURNING id
`;

const RESTORE_ARCHIVED_SQL = `
UPDATE school_courses
   SET status = 'active',
       updated_at = NOW()
 WHERE id = ANY($1::uuid[])
   AND status = 'archived'
RETURNING id
`;

function assertProposalSafeToApply(proposal) {
  if (proposal?.needsHuman) {
    const error = new Error(
      "Correctif school_courses refusé : au moins une collision needs_human. Aucun archivage.",
    );
    error.code = "SCHOOL_COURSE_AMBIGUITY_NEEDS_HUMAN";
    throw error;
  }
  const ids = Array.isArray(proposal?.autoArchiveIds) ? proposal.autoArchiveIds : [];
  if (ids.length === 0) {
    const error = new Error("Correctif school_courses : aucune ligne auto-archivable.");
    error.code = "SCHOOL_COURSE_AMBIGUITY_NOTHING_TO_ARCHIVE";
    throw error;
  }
  return ids;
}

async function applyProposedArchives(db, proposal) {
  const ids = assertProposalSafeToApply(proposal);
  const result = await db.query(ARCHIVE_PROPOSED_DUPLICATES_SQL, [ids]);
  const archivedIds = (result.rows ?? result).map((row) => row.id);
  return {
    archivedIds,
    reversal: {
      sql: RESTORE_ARCHIVED_SQL,
      ids: archivedIds,
    },
  };
}

async function reverseArchives(db, ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (list.length === 0) return { restoredIds: [] };
  const result = await db.query(RESTORE_ARCHIVED_SQL, [list]);
  return { restoredIds: (result.rows ?? result).map((row) => row.id) };
}

module.exports = {
  ARCHIVE_PROPOSED_DUPLICATES_SQL,
  RESTORE_ARCHIVED_SQL,
  assertProposalSafeToApply,
  applyProposedArchives,
  reverseArchives,
};
