/**
 * D3.6b — Ordre de migration + idempotence + anomalies explicites.
 */
const assert = require("assert");
const {
  GRADES_MIGRATION_STEPS,
  assertMigrationOrder,
  planNoteMigration,
} = require("./gradesMigrationOrder");

function run() {
  assert.strictEqual(assertMigrationOrder([...GRADES_MIGRATION_STEPS]), null);
  assert.ok(assertMigrationOrder(["schema_non_blocking"]));
  assert.ok(
    assertMigrationOrder([
      "schema_non_blocking",
      "attach_notes", // mauvais ordre
      "inventory_json_evaluations",
      "create_or_resolve_evaluation_id",
      "inventory_anomalies",
      "deterministic_dedup",
      "post_migration_check",
      "create_unique_index",
      "apply_contract_constraints",
      "flip_writes_to_pg",
    ]),
  );

  const resolved = new Set(["EVAL-1", "EVAL-2"]);
  const already = new Set(["EVAL-1|STU-1"]);
  const plan = planNoteMigration(
    [
      { id: "N1", evaluationId: "EVAL-1", studentId: "STU-1" }, // déjà liée
      { id: "N2", evaluationId: "EVAL-2", studentId: "STU-2" }, // à rattacher
      { id: "N3", evaluationId: "", studentId: "STU-3" }, // anomalie
      { id: "N4", evaluationId: "EVAL-MISSING", studentId: "STU-4" }, // anomalie
    ],
    resolved,
    already,
  );

  assert.strictEqual(plan.attached.length, 1);
  assert.strictEqual(plan.attached[0].id, "N2");
  assert.strictEqual(plan.skipped.length, 1);
  assert.strictEqual(plan.skipped[0].reason, "already_linked");
  assert.strictEqual(plan.anomalies.length, 2);
  assert.ok(plan.anomalies.some((row) => row.reason === "missing_evaluation_id"));
  assert.ok(plan.anomalies.some((row) => row.reason === "unresolvable_evaluation_id"));

  // Relance idempotente : plus rien à attacher
  const second = planNoteMigration(plan.attached, resolved, new Set(["EVAL-2|STU-2"]));
  assert.strictEqual(second.attached.length, 0);
  assert.strictEqual(second.skipped.length, 1);

  console.log("gradesMigrationOrder.test.js : OK");
}

run();
