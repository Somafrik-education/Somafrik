/**
 * D3.6b + HOTFIX-SYNC-01 — Pas de perte silencieuse.
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

  // Sync OK totale → strip autorisé (compat D3.6b)
  const stripped = buildDurableNotesBackOfficePayload(payload, { syncSucceeded: true });
  assert.deepStrictEqual(stripped.notes, []);
  assert.deepStrictEqual(stripped.evaluations, []);
  assert.strictEqual(stripped.schools.length, 1);

  // Sync KO globale → conservation explicite
  const kept = buildDurableNotesBackOfficePayload(payload, { syncSucceeded: false });
  assert.strictEqual(kept.notes.length, 1);
  assert.strictEqual(kept.evaluations.length, 1);
  assert.strictEqual(kept.notes[0].id, "N1");

  // HOTFIX-SYNC-01 : accept partiel → strip acceptés, conserve rejetés avec failed
  const partial = buildDurableNotesBackOfficePayload(
    {
      ...payload,
      evaluations: [
        { id: "EVAL-OK", title: "OK" },
        { id: "EVAL-BAD", title: "BAD", clientMutationId: "cm-1" },
      ],
    },
    {
      syncSucceeded: true,
      accepted: { evaluations: ["EVAL-OK"], notes: [] },
      rejected: [
        {
          entity: "evaluations",
          id: "EVAL-BAD",
          clientMutationId: "cm-1",
          error: "Classe ou matiere introuvable pour l'évaluation",
        },
      ],
    },
  );
  assert.strictEqual(partial.evaluations.length, 1);
  assert.strictEqual(partial.evaluations[0].id, "EVAL-BAD");
  assert.strictEqual(partial.evaluations[0].syncStatus, "failed");
  assert.match(partial.evaluations[0].syncError, /Classe ou matiere/);

  // Flux : échec infra sync → persistFn ne doit PAS être appelée
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
  assert.strictEqual(persisted, null, "aucune persistance JSON après échec infra");

  // Flux : sync partielle ACK → persist avec rejet conservé
  await persistBackOfficeAfterNotesSync({
    payload: {
      evaluations: [
        { id: "EVAL-OK", title: "OK" },
        { id: "EVAL-BAD", title: "BAD" },
      ],
      notes: [],
    },
    syncFn: async () => ({
      accepted: { evaluations: ["EVAL-OK"], notes: [] },
      rejected: [{ entity: "evaluations", id: "EVAL-BAD", error: "rattachement" }],
    }),
    persistFn: async (durable) => {
      persisted = durable;
    },
  });
  assert.ok(persisted);
  assert.strictEqual(persisted.evaluations.length, 1);
  assert.strictEqual(persisted.evaluations[0].syncStatus, "failed");

  // Flux : sync OK totale → strip puis persist
  await persistBackOfficeAfterNotesSync({
    payload,
    syncFn: async () => ({
      accepted: { evaluations: ["EVAL-1"], notes: ["N1"] },
      rejected: [],
    }),
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
