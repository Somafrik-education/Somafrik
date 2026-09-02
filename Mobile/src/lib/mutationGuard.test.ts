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
assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const seeded = createIntentionStore();
assert.equal(seeded.seed("presence:cls:23-08-2026", first), first);
assert.equal(seeded.seed("presence:cls:23-08-2026", "other-key"), first, "seed ne remplace pas une clé vivante");
intentions.rotate("presence:6A:2026-08-19");
const next = intentions.getOrCreate("presence:6A:2026-08-19");
assert.notEqual(next, first, "nouvelle intention après succès confirmé");

console.log("mutationGuard.test.ts OK");
