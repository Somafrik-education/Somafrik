/**
 * D3.6b — Ordre normatif de migration legacy Notes (idempotent, relançable).
 * Utilisé par postgresRepository.ensureNotesCanonicalPersistence et les tests.
 */
const GRADES_MIGRATION_STEPS = Object.freeze([
  "schema_non_blocking",
  "inventory_json_evaluations",
  "create_or_resolve_evaluation_id",
  "attach_notes",
  "inventory_anomalies",
  "deterministic_dedup",
  "post_migration_check",
  "create_unique_index",
  "apply_contract_constraints",
  "flip_writes_to_pg",
]);

function assertMigrationOrder(steps = []) {
  const expected = GRADES_MIGRATION_STEPS;
  if (!Array.isArray(steps) || steps.length !== expected.length) {
    return `Nombre d'étapes invalide: ${steps?.length ?? 0} (attendu ${expected.length})`;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (steps[index] !== expected[index]) {
      return `Étape ${index + 1} invalide: ${steps[index]} (attendu ${expected[index]})`;
    }
  }
  return null;
}

/**
 * Simule le rattachement idempotent : une note déjà liée est ignorée.
 */
function planNoteMigration(notes = [], resolvedEvaluationIds = new Set(), alreadyLinkedKeys = new Set()) {
  const attached = [];
  const anomalies = [];
  const skipped = [];

  for (const note of notes) {
    const evaluationId = String(note.evaluationId ?? "").trim();
    const studentId = String(note.studentId ?? "").trim();
    const key = `${evaluationId}|${studentId}`;
    if (!evaluationId) {
      anomalies.push({ note, reason: "missing_evaluation_id" });
      continue;
    }
    if (!resolvedEvaluationIds.has(evaluationId)) {
      anomalies.push({ note, reason: "unresolvable_evaluation_id" });
      continue;
    }
    if (alreadyLinkedKeys.has(key)) {
      skipped.push({ note, reason: "already_linked" });
      continue;
    }
    attached.push(note);
    alreadyLinkedKeys.add(key);
  }

  return { attached, anomalies, skipped };
}

module.exports = {
  GRADES_MIGRATION_STEPS,
  assertMigrationOrder,
  planNoteMigration,
};
