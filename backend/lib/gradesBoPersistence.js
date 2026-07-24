/**
 * D3.6b + HOTFIX-SYNC-01 — Persistance BO Notes.
 * Strip JSON uniquement pour les enregistrements acceptés (ACK).
 * Les rejets restent durables avec syncStatus=failed — jamais de perte silencieuse.
 */

/**
 * Construit le payload durable BackOffice.
 * @param {object} payload
 * @param {{ syncSucceeded?: boolean, accepted?: { evaluations?: string[], notes?: string[] }, rejected?: Array<object> }} options
 */
function buildDurableNotesBackOfficePayload(payload = {}, options = {}) {
  const base = { ...(payload ?? {}) };
  const {
    syncSucceeded,
    accepted = { evaluations: [], notes: [] },
    rejected = [],
  } = options;

  // Compat D3.6b : syncSucceeded false → tout conserver ; true sans listes → strip total.
  if (syncSucceeded === false) {
    return {
      ...base,
      notes: Array.isArray(base.notes) ? base.notes : [],
      evaluations: Array.isArray(base.evaluations) ? base.evaluations : [],
    };
  }

  const acceptedEvalIds = new Set((accepted.evaluations ?? []).map((id) => String(id)));
  const acceptedNoteIds = new Set((accepted.notes ?? []).map((id) => String(id)));
  const rejectedByKey = new Map();
  for (const item of rejected ?? []) {
    const key = `${item.entity ?? ""}:${item.id ?? item.clientMutationId ?? ""}`;
    rejectedByKey.set(key, item);
  }

  const keepWithFailure = (rows, entity, acceptedIds) =>
    (Array.isArray(rows) ? rows : [])
      .filter((row) => !acceptedIds.has(String(row.id ?? "")))
      .map((row) => {
        const reject =
          rejectedByKey.get(`${entity}:${row.id ?? ""}`) ||
          rejectedByKey.get(`${entity}:${row.clientMutationId ?? ""}`);
        if (!reject) return row;
        return {
          ...row,
          syncStatus: "failed",
          syncError: reject.error ?? "Échec de synchronisation",
          clientMutationId: row.clientMutationId ?? reject.clientMutationId,
        };
      });

  // HOTFIX-SYNC-01 : strip partiel si accepted fourni ; sinon comportement D3.6b syncSucceeded=true.
  if (acceptedEvalIds.size || acceptedNoteIds.size || (rejected ?? []).length) {
    return {
      ...base,
      evaluations: keepWithFailure(base.evaluations, "evaluations", acceptedEvalIds),
      notes: keepWithFailure(base.notes, "notes", acceptedNoteIds),
    };
  }

  if (syncSucceeded === true) {
    return {
      ...base,
      notes: [],
      evaluations: [],
    };
  }

  return {
    ...base,
    notes: Array.isArray(base.notes) ? base.notes : [],
    evaluations: Array.isArray(base.evaluations) ? base.evaluations : [],
  };
}

/**
 * Orchestration synchrone testable du flux saveBackOfficeState (notes domain).
 * HOTFIX-SYNC-01 : syncFn peut renvoyer { accepted, rejected } sans throw.
 * Throw global (infra) ⇒ aucune persistance JSON.
 */
async function persistBackOfficeAfterNotesSync({
  payload,
  syncFn,
  persistFn,
}) {
  const syncResult = (await syncFn(payload ?? {})) ?? {};
  const durable = buildDurableNotesBackOfficePayload(payload ?? {}, {
    syncSucceeded: true,
    accepted: syncResult.accepted ?? { evaluations: [], notes: [] },
    rejected: syncResult.rejected ?? [],
  });
  await persistFn(durable);
  return syncResult;
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
