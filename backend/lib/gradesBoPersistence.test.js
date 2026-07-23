/**
 * D3.6b — Pas de perte silencieuse : échec PG → JSON non vidé.
 */
const assert = require("assert");
const {
  buildDurableNotesBackOfficePayload,
  persistBackOfficeAfterNotesSync,
  normalizeGradeStatusScoreRow,
  rowsReadyForGradeStatusScoreConstraint,
} = require("./gradesBoPersistence");

async function run() {
  const payload = {
    schools: [{ id: "S1" }],
    notes: [{ id: "N1", evaluationId: "EVAL-1", studentId: "STU-1", value: 12 }],
    evaluations: [{ id: "EVAL-1", title: "Devoir 1", status: "open" }],
  };

  // Sync OK → strip autorisé
  const stripped = buildDurableNotesBackOfficePayload(payload, { syncSucceeded: true });
  assert.deepStrictEqual(stripped.notes, []);
  assert.deepStrictEqual(stripped.evaluations, []);
  assert.strictEqual(stripped.schools.length, 1);

  // Sync KO → conservation explicite
  const kept = buildDurableNotesBackOfficePayload(payload, { syncSucceeded: false });
  assert.strictEqual(kept.notes.length, 1);
  assert.strictEqual(kept.evaluations.length, 1);
  assert.strictEqual(kept.notes[0].id, "N1");

  // Flux : échec sync → persistFn ne doit PAS être appelée avec collections vides
  let persisted = null;
  await assert.rejects(
    () =>
      persistBackOfficeAfterNotesSync({
        payload,
        syncFn: async () => {
          throw new Error("PG upsert failed");
        },
        persistFn: async (durable) => {
          persisted = durable;
        },
      }),
    /PG upsert failed/,
  );
  assert.strictEqual(persisted, null, "aucune persistance JSON après échec PG");

  // Flux : sync OK → strip puis persist
  await persistBackOfficeAfterNotesSync({
    payload,
    syncFn: async () => {},
    persistFn: async (durable) => {
      persisted = durable;
    },
  });
  assert.ok(persisted);
  assert.deepStrictEqual(persisted.notes, []);
  assert.deepStrictEqual(persisted.evaluations, []);

  // Normalisation legacy avant contrainte
  const invalidGraded = normalizeGradeStatusScoreRow({ grade_status: "graded", score: null });
  assert.strictEqual(invalidGraded.grade_status, "not_submitted");
  assert.strictEqual(invalidGraded.score, null);

  const invalidAbsentWithScore = normalizeGradeStatusScoreRow({
    grade_status: "absent",
    score: 10,
  });
  assert.strictEqual(invalidAbsentWithScore.grade_status, "graded");
  assert.strictEqual(invalidAbsentWithScore.score, 10);

  assert.strictEqual(
    rowsReadyForGradeStatusScoreConstraint([{ grade_status: "graded", score: null }]),
    false,
    "ligne legacy invalide → contrainte non applicable",
  );
  assert.strictEqual(
    rowsReadyForGradeStatusScoreConstraint([invalidGraded]),
    true,
    "après normalisation → contrainte applicable",
  );

  console.log("gradesBoPersistence.test.js : OK");
}

run();
