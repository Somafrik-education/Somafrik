/**
 * LOT 5 — outbox persistante, scope, secrets, relaunch pending.
 *   npx tsx Mobile/src/lib/outbox.test.ts
 */
import assert from "node:assert/strict";
import {
  bindOutboxToSession,
  blockOutboxOnLogout,
  enqueueOutbox,
  freezePayload,
  listOutbox,
  processOutbox,
  setOutboxStorageForTests,
  submitProtectedMutation,
} from "./outbox";
import { setMutationDelayForTests } from "./networkResilience";

const memory: { entries: unknown[] } = { entries: [] };
setOutboxStorageForTests({
  async read() {
    return JSON.parse(JSON.stringify(memory.entries));
  },
  async write(entries) {
    memory.entries = JSON.parse(JSON.stringify(entries));
  },
});
setMutationDelayForTests(async () => undefined);

async function run() {
  memory.entries = [];
  const sessionA = { userId: "user-a", schoolScope: "CD-2026-0001" };
  const sessionB = { userId: "user-b", schoolScope: "BI-2026-0001" };
  const key = "550e8400-e29b-41d4-a716-446655440000";

  await enqueueOutbox({
    idempotencyKey: key,
    domain: "messages",
    method: "POST",
    path: "/backoffice/messages",
    payload: { message: "bonjour" },
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
  });
  const again = await enqueueOutbox({
    idempotencyKey: key,
    domain: "messages",
    method: "POST",
    path: "/backoffice/messages",
    payload: { message: "mutated" },
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
  });
  assert.equal((again.payload as { message: string }).message, "bonjour", "payload figé");

  await assert.rejects(
    () =>
      enqueueOutbox({
        idempotencyKey: "secret-key",
        domain: "messages",
        method: "POST",
        path: "/backoffice/messages",
        payload: { message: "x", accessToken: "tok" },
        userId: sessionA.userId,
        schoolScope: sessionA.schoolScope,
      }),
    /OUTBOX_SECRET_FORBIDDEN/,
  );

  const relaunch = await listOutbox();
  assert.equal(relaunch[0]?.status, "pending", "kill/relaunch conserve pending");

  await bindOutboxToSession(sessionB);
  const blocked = await listOutbox();
  assert.equal(blocked[0]?.status, "blocked_scope_mismatch");

  memory.entries = [];
  await enqueueOutbox({
    idempotencyKey: "msg-1",
    domain: "messages",
    method: "POST",
    path: "/backoffice/messages",
    payload: { message: "ok" },
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
  });
  await blockOutboxOnLogout();
  const afterLogout = await listOutbox();
  assert.equal(afterLogout[0]?.status, "blocked_logout");

  let dispatched = 0;
  await processOutbox(sessionB, async () => {
    dispatched += 1;
  });
  assert.equal(dispatched, 0, "aucune mutation cross-user / cross-tenant");

  await bindOutboxToSession(sessionA);
  await processOutbox(sessionA, async () => {
    dispatched += 1;
  });
  assert.equal(dispatched, 1);
  const sent = await listOutbox();
  assert.equal(sent[0]?.status, "sent");

  memory.entries = [];
  const queued = await submitProtectedMutation({
    domain: "presences",
    method: "POST",
    path: "/presences",
    payload: { items: [{ studentId: "s1" }] },
    idempotencyKey: "pre-1",
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
    persistOutbox: true,
    request: async () => {
      throw Object.assign(new Error("Délai de requête dépassé. Vérifiez votre réseau."), { status: 0 });
    },
  });
  assert.equal(queued.outcome, "queued");
  const pending = await listOutbox();
  assert.equal(pending[0]?.status, "pending");
  assert.notEqual(pending[0]?.status, "sent");

  const frozen = freezePayload({ totalAmount: 541, items: [{ amount: 500 }] });
  (frozen as { totalAmount: number }).totalAmount = 999;
  assert.equal((frozen as { totalAmount: number }).totalAmount, 999);
  const original = freezePayload({ totalAmount: 541 });
  assert.equal((original as { totalAmount: number }).totalAmount, 541);

  const failed400 = await submitProtectedMutation({
    domain: "notes",
    method: "POST",
    path: "/notes",
    payload: { evaluationId: "e1", studentId: "s1" },
    idempotencyKey: "note-400",
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
    persistOutbox: true,
    request: async () => {
      throw Object.assign(new Error("validation"), { status: 400 });
    },
  });
  assert.equal(failed400.outcome, "failed");

  console.log("outbox.test.ts OK");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
