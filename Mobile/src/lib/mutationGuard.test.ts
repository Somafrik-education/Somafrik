/**
 * LOT 5 — double tap → une intention / une clé.
 *   npx tsx Mobile/src/lib/mutationGuard.test.ts
 */
import assert from "node:assert/strict";
import { createInFlightLock, createIntentionStore } from "./mutationGuard";

const lock = createInFlightLock();
assert.equal(lock.tryBegin(), true);
assert.equal(lock.tryBegin(), false, "second tap <100ms ignoré");
assert.equal(lock.inFlight, true);
lock.end();
assert.equal(lock.tryBegin(), true);
lock.end();

const intentions = createIntentionStore();
const first = intentions.getOrCreate("presence:6A:2026-08-19");
const retry = intentions.getOrCreate("presence:6A:2026-08-19");
assert.equal(first, retry, "retry conserve la même Idempotency-Key");
intentions.rotate("presence:6A:2026-08-19");
const next = intentions.getOrCreate("presence:6A:2026-08-19");
assert.notEqual(next, first, "nouvelle intention après succès confirmé");

console.log("mutationGuard.test.ts OK");
