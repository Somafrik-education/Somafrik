/**
 * LOT 5 — classification / retry / Idempotency-Key.
 *   npx tsx Mobile/src/lib/networkResilience.test.ts
 */
import assert from "node:assert/strict";
import {
  classifyMutationFailure,
  createIdempotencyKey,
  executeMutation,
  retryDelayMs,
  setMutationDelayForTests,
} from "./networkResilience";

function apiError(message: string, status?: number, code?: string) {
  return Object.assign(new Error(message), { status, code });
}

async function run() {
  const keyA = createIdempotencyKey();
  const keyB = createIdempotencyKey();
  assert.match(keyA, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(keyA, keyB);

  assert.equal(classifyMutationFailure(apiError("Délai de requête dépassé. Vérifiez votre réseau.")), "retryable");
  assert.equal(
    classifyMutationFailure(apiError("Connexion Internet indisponible. Réessayez lorsque le réseau sera rétabli.")),
    "retryable",
  );
  assert.equal(classifyMutationFailure(apiError("bad gateway", 502)), "retryable");
  assert.equal(classifyMutationFailure(apiError("unavailable", 503)), "retryable");
  assert.equal(classifyMutationFailure(apiError("timeout", 504)), "retryable");
  assert.equal(classifyMutationFailure(apiError("too many", 429)), "retryable");
  assert.equal(classifyMutationFailure(apiError("validation", 400)), "non_retryable");
  assert.equal(
    classifyMutationFailure(Object.assign(new Error("OUTBOX_PERSIST_FAILED: disk"), { code: "OUTBOX_PERSIST_FAILED" })),
    "non_retryable",
  );
  assert.equal(classifyMutationFailure(apiError("interdit", 403)), "non_retryable");
  assert.equal(classifyMutationFailure(apiError("absent", 404)), "non_retryable");
  assert.equal(classifyMutationFailure(apiError("unprocessable", 422)), "non_retryable");
  assert.equal(classifyMutationFailure(apiError("Session expirée. Veuillez vous reconnecter.", 401)), "auth_required");
  assert.equal(
    classifyMutationFailure(apiError("Créneau en conflit", 409, "COURSE_SCHEDULE_CONFLICT")),
    "conflict",
  );
  assert.equal(
    classifyMutationFailure(apiError("clé réutilisée", 409, "IDEMPOTENCY_KEY_REUSED")),
    "conflict",
  );

  assert.equal(retryDelayMs(1, false), 1000);
  assert.equal(retryDelayMs(2, false), 3000);
  assert.equal(retryDelayMs(3, false), 8000);

  const reusedKey = createIdempotencyKey();
  const seen: string[] = [];
  let calls = 0;
  setMutationDelayForTests(async () => undefined);
  const result = await executeMutation({
    jitter: false,
    request: async () => {
      calls += 1;
      seen.push(reusedKey);
      if (calls < 3) throw apiError("unavailable", 503);
      return { ok: true, key: reusedKey };
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(seen, [reusedKey, reusedKey, reusedKey]);
  assert.equal(result.key, reusedKey);

  let badCalls = 0;
  await assert.rejects(() =>
    executeMutation({
      request: async () => {
        badCalls += 1;
        throw apiError("validation", 400);
      },
    }),
  );
  assert.equal(badCalls, 1, "400 jamais retried");

  let forbidden = 0;
  await assert.rejects(() =>
    executeMutation({
      request: async () => {
        forbidden += 1;
        throw apiError("interdit", 403);
      },
    }),
  );
  assert.equal(forbidden, 1, "403 jamais retried");

  let conflict = 0;
  await assert.rejects(() =>
    executeMutation({
      request: async () => {
        conflict += 1;
        throw apiError("collision", 409, "COURSE_SCHEDULE_CONFLICT");
      },
    }),
  );
  assert.equal(conflict, 1, "409 métier jamais retried");

  setMutationDelayForTests(null);
  console.log("networkResilience.test.ts OK");
}

run().catch((error) => {
  setMutationDelayForTests(null);
  console.error(error);
  process.exit(1);
});
