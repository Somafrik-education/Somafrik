/**
 * D3.6b — Persistance BO Notes : strip JSON uniquement après sync PG réussie.
 * Jamais : warn → continuer → vider notes/evaluations.
 */

/**
 * Construit le payload durable BackOffice.
 * @param {object} payload
 * @param {{ syncSucceeded: boolean }} options
 */
function buildDurableNotesBackOfficePayload(payload = {}, { syncSucceeded } = {}) {
  const base = { ...(payload ?? {}) };
  if (!syncSucceeded) {
    // Conserves explicites — ne pas stripper si la sync PG a échoué.
    return {
      ...base,
      notes: Array.isArray(base.notes) ? base.notes : [],
      evaluations: Array.isArray(base.evaluations) ? base.evaluations : [],
    };
  }
  return {
    ...base,
    notes: [],
    evaluations: [],
  };
}

/**
 * Orchestration synchrone testable du flux saveBackOfficeState (notes domain).
 * syncFn doit throw si une entrée échoue — aucune absorption ici.
 */
async function persistBackOfficeAfterNotesSync({
  payload,
  syncFn,
  persistFn,
}) {
  await syncFn(payload ?? {});
  const durable = buildDurableNotesBackOfficePayload(payload ?? {}, { syncSucceeded: true });
  return persistFn(durable);
}

/**
 * Normalise une ligne grades pour permettre grades_status_score_coherence.
 */
function normalizeGradeStatusScoreRow(row = {}) {
  const status = String(row.grade_status ?? "graded").trim() || "graded";
  const hasScore = row.score != null && row.score !== "";
  const allowed = new Set(["graded", "absent", "excused", "not_submitted", "exempt"]);
  let gradeStatus = allowed.has(status) ? status : hasScore ? "graded" : "not_submitted";

  if (gradeStatus === "graded" && !hasScore) {
    return { ...row, grade_status: "not_submitted", score: null };
  }
  if (gradeStatus !== "graded" && hasScore) {
    return { ...row, grade_status: "graded", score: row.score };
  }
  return { ...row, grade_status: gradeStatus, score: hasScore ? row.score : null };
}

function rowsReadyForGradeStatusScoreConstraint(rows = []) {
  return (rows ?? []).every((row) => {
    const normalized = normalizeGradeStatusScoreRow(row);
    return (
      normalized.grade_status === row.grade_status &&
      (normalized.score ?? null) === (row.score ?? null)
    );
  });
}

module.exports = {
  buildDurableNotesBackOfficePayload,
  persistBackOfficeAfterNotesSync,
  normalizeGradeStatusScoreRow,
  rowsReadyForGradeStatusScoreConstraint,
};
