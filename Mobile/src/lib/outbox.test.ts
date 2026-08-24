/**
 * LOT 5 — outbox persistante, scope, secrets, relaunch pending.
 *   npx tsx Mobile/src/lib/outbox.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bindOutboxToSession,
  blockOutboxOnLogout,
  enqueueOutbox,
  freezePayload,
  listOutbox,
  OUTBOX_INTENTION_SENDING,
  OUTBOX_READ_FAILED,
  processOutbox,
  resolveOutboxIntentionKey,
  setOutboxStorageForTests,
  submitProtectedMutation,
  type OutboxStorage,
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

  memory.entries = [];
  let offlinePosts = 0;
  const offlineImmediate = await submitProtectedMutation({
    domain: "presences",
    method: "POST",
    path: "/presences",
    payload: { classId: "cls-1", classCode: "CLS-1", items: [{ studentId: "s1", status: "Présent" }] },
    idempotencyKey: "pre-offline-1",
    intentionId: "presence:cls-1:23-08-2026",
    replacePendingPayload: true,
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
    persistOutbox: true,
    knownOffline: true,
    request: async () => {
      offlinePosts += 1;
      return [{ id: "should-not-run" }];
    },
  });
  assert.equal(offlineImmediate.outcome, "queued");
  assert.equal(offlinePosts, 0, "offline connu : aucun POST avant replay");
  assert.equal((await listOutbox())[0]?.intentionId, "presence:cls-1:23-08-2026");

  const updated = await submitProtectedMutation({
    domain: "presences",
    method: "POST",
    path: "/presences",
    payload: { classId: "cls-1", classCode: "CLS-1", items: [{ studentId: "s1", status: "Absent" }] },
    idempotencyKey: "pre-offline-should-reuse",
    intentionId: "presence:cls-1:23-08-2026",
    replacePendingPayload: true,
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
    persistOutbox: true,
    knownOffline: true,
    request: async () => {
      offlinePosts += 1;
      return [];
    },
  });
  assert.equal(updated.outcome, "queued");
  const afterChange = await listOutbox();
  assert.equal(afterChange.length, 1, "une seule intention concurrente");
  assert.equal(afterChange[0]?.idempotencyKey, "pre-offline-1");
  assert.equal(
    (afterChange[0]?.payload as { items: Array<{ status: string }> }).items[0]?.status,
    "Absent",
    "changement de statut avant replay met à jour le payload",
  );

  const relaunchedKey = await resolveOutboxIntentionKey("presence:cls-1:23-08-2026");
  assert.equal(relaunchedKey, "pre-offline-1", "kill/relaunch conserve la même clé");

  let replayed = 0;
  const replay = await processOutbox(sessionA, async (entry) => {
    replayed += 1;
    assert.equal(entry.idempotencyKey, "pre-offline-1");
    return [{ id: "PRE-1", studentId: "s1", status: "Absent" }];
  });
  assert.equal(replay.sent, 1);
  assert.equal(replayed, 1, "replay unique");
  assert.equal((await listOutbox())[0]?.status, "sent");

  const persistStore: OutboxStorage = {
    async read() {
      return [];
    },
    async write() {
      throw new Error("disk full");
    },
  };
  setOutboxStorageForTests(persistStore);
  let persistPosts = 0;
  const persistFailed = await submitProtectedMutation({
    domain: "presences",
    method: "POST",
    path: "/presences",
    payload: { classId: "cls-1", items: [{ studentId: "s1" }] },
    idempotencyKey: "pre-fs-fail",
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
    persistOutbox: true,
    knownOffline: true,
    request: async () => {
      persistPosts += 1;
      return [{ id: "nope" }];
    },
  });
  assert.equal(persistFailed.outcome, "failed");
  assert.equal(persistFailed.persistFailed, true);
  assert.equal(persistPosts, 0);
  assert.match(String((persistFailed.error as Error).message), /OUTBOX_PERSIST_FAILED/);

  memory.entries = [];
  setOutboxStorageForTests({
    async read() {
      return JSON.parse(JSON.stringify(memory.entries));
    },
    async write(entries) {
      memory.entries = JSON.parse(JSON.stringify(entries));
    },
  });
  const forbiddenTenant = await submitProtectedMutation({
    domain: "presences",
    method: "POST",
    path: "/presences",
    payload: { classId: "cls-b", items: [{ studentId: "foreign" }] },
    idempotencyKey: "pre-403",
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
    persistOutbox: true,
    knownOffline: false,
    request: async () => {
      throw Object.assign(new Error("Accès refusé : élève hors périmètre établissement."), {
        status: 403,
        code: "TENANT_MISMATCH",
      });
    },
  });
  assert.equal(forbiddenTenant.outcome, "failed");
  assert.notEqual(forbiddenTenant.outcome, "confirmed");

  memory.entries = [];
  const presentPayload = {
    classId: "cls-1",
    classCode: "CLS-1",
    items: [{ studentId: "s1", status: "Présent" }],
  };
  await enqueueOutbox({
    idempotencyKey: "pre-sending-1",
    intentionId: "presence:cls-1:24-08-2026",
    domain: "presences",
    method: "POST",
    path: "/presences",
    payload: presentPayload,
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
    replacePendingPayload: true,
  });

  let releaseSending!: () => void;
  const sendingGate = new Promise<void>((resolve) => {
    releaseSending = resolve;
  });
  const concurrentPosts: Array<{ key: string; status: string }> = [];
  let dispatchStarted = false;
  const replayWhileSending = processOutbox(sessionA, async (entry) => {
    dispatchStarted = true;
    await sendingGate;
    concurrentPosts.push({
      key: entry.idempotencyKey,
      status: String((entry.payload as { items: Array<{ status: string }> }).items[0]?.status),
    });
    return [{ id: "PRE-sending", studentId: "s1", status: "Présent" }];
  });
  const waitUntil = async (label: string, check: () => Promise<boolean>, timeoutMs = 1500) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`timeout: ${label}`);
  };
  await waitUntil("pending → sending", async () => {
    const rows = await listOutbox();
    return rows[0]?.status === "sending" && dispatchStarted;
  });

  const sendingKey = await resolveOutboxIntentionKey("presence:cls-1:24-08-2026");
  assert.equal(sendingKey, "pre-sending-1");
  const absentPayload = {
    classId: "cls-1",
    classCode: "CLS-1",
    items: [{ studentId: "s1", status: "Absent" }],
  };
  await assert.rejects(
    () =>
      enqueueOutbox({
        idempotencyKey: sendingKey,
        intentionId: "presence:cls-1:24-08-2026",
        domain: "presences",
        method: "POST",
        path: "/presences",
        payload: absentPayload,
        userId: sessionA.userId,
        schoolScope: sessionA.schoolScope,
        replacePendingPayload: true,
      }),
    (error: unknown) => {
      assert.match(String((error as Error).message), /déjà en cours de synchronisation/);
      assert.equal((error as { code?: string }).code, OUTBOX_INTENTION_SENDING);
      return true;
    },
  );

  let uiPosts = 0;
  const blockedSave = await submitProtectedMutation({
    domain: "presences",
    method: "POST",
    path: "/presences",
    payload: absentPayload,
    idempotencyKey: sendingKey,
    intentionId: "presence:cls-1:24-08-2026",
    replacePendingPayload: true,
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
    persistOutbox: true,
    knownOffline: false,
    request: async () => {
      uiPosts += 1;
      concurrentPosts.push({ key: sendingKey, status: "Absent" });
      return [{ id: "should-not-race" }];
    },
  });
  assert.equal(blockedSave.outcome, "blocked_sending");
  assert.equal(uiPosts, 0, "aucune concurrence même clé / payload différent pendant sending");
  assert.equal(concurrentPosts.length, 0, "le replay n'a pas encore ACK");

  const samePayloadInFlight = await submitProtectedMutation({
    domain: "presences",
    method: "POST",
    path: "/presences",
    payload: presentPayload,
    idempotencyKey: sendingKey,
    intentionId: "presence:cls-1:24-08-2026",
    replacePendingPayload: true,
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
    persistOutbox: true,
    knownOffline: false,
    request: async () => {
      uiPosts += 1;
      return [{ id: "second-post-forbidden" }];
    },
  });
  assert.equal(samePayloadInFlight.outcome, "in_flight");
  assert.equal(uiPosts, 0, "même payload sending : pas de second POST");

  releaseSending();
  const replayResult = await replayWhileSending;
  assert.equal(replayResult.sent, 1);
  assert.equal(concurrentPosts.length, 1);
  assert.equal(concurrentPosts[0]?.status, "Présent");
  assert.equal((await listOutbox())[0]?.status, "sent");

  const afterAckKey = await resolveOutboxIntentionKey("presence:cls-1:24-08-2026");
  assert.notEqual(afterAckKey, sendingKey, "après ACK : nouvelle intention, pas la clé sending");
  const finalSave = await submitProtectedMutation({
    domain: "presences",
    method: "POST",
    path: "/presences",
    payload: absentPayload,
    idempotencyKey: afterAckKey,
    intentionId: "presence:cls-1:24-08-2026",
    replacePendingPayload: true,
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
    persistOutbox: true,
    knownOffline: true,
    request: async () => {
      uiPosts += 1;
      return [];
    },
  });
  assert.equal(finalSave.outcome, "queued");
  assert.equal(uiPosts, 0);
  const afterAck = await listOutbox();
  const pendingFinal = afterAck.find((row) => row.status === "pending");
  assert.equal(pendingFinal?.idempotencyKey, afterAckKey);
  assert.notEqual(pendingFinal?.idempotencyKey, sendingKey);
  assert.equal(
    (pendingFinal?.payload as { items: Array<{ status: string }> }).items[0]?.status,
    "Absent",
    "modification finale conservée sur une nouvelle intention après ACK",
  );

  const unreadable: OutboxStorage = {
    async read() {
      throw new Error("EIO");
    },
    async write() {
      throw new Error("should not write");
    },
  };
  setOutboxStorageForTests(unreadable);
  const unread = await listOutbox().then(
    (entries) => ({ ok: true as const, entries }),
    (error) => ({ ok: false as const, error }),
  );
  assert.equal(unread.ok, false, "listOutbox throws : aucune fausse file vide");
  if (unread.ok) throw new Error("unreachable");
  assert.match(String((unread.error as Error).message), new RegExp(OUTBOX_READ_FAILED));
  assert.equal(Array.isArray(unread.error), false);

  const restartDir = fs.mkdtempSync(path.join(os.tmpdir(), "somafrik-outbox-restart-"));
  const restartFile = path.join(restartDir, "somafrik-mutation-outbox.json");
  const fileBacked = (): OutboxStorage => ({
    async read() {
      if (!fs.existsSync(restartFile)) return [];
      const parsed = JSON.parse(fs.readFileSync(restartFile, "utf8"));
      if (!Array.isArray(parsed)) {
        throw Object.assign(new Error(OUTBOX_READ_FAILED), { code: OUTBOX_READ_FAILED });
      }
      return parsed;
    },
    async write(entries) {
      fs.writeFileSync(restartFile, JSON.stringify(entries));
    },
  });
  setOutboxStorageForTests(fileBacked());
  await enqueueOutbox({
    idempotencyKey: "pre-fs-restart",
    intentionId: "presence:cls-1:24-08-2026",
    domain: "presences",
    method: "POST",
    path: "/presences",
    payload: absentPayload,
    userId: sessionA.userId,
    schoolScope: sessionA.schoolScope,
  });
  setOutboxStorageForTests(fileBacked());
  const afterProcessRestart = await listOutbox();
  assert.equal(afterProcessRestart.length, 1);
  assert.equal(afterProcessRestart[0]?.idempotencyKey, "pre-fs-restart");
  assert.equal(afterProcessRestart[0]?.status, "pending");

  console.log("outbox.test.ts OK");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
