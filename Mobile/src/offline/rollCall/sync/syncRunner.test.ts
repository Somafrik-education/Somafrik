/**
 * NFC-PRES-LOCAL-PR4 — synchronisation des appels hors connexion : envoi du corps figé, idempotence,
 * vérification de l'ACK, erreurs, backoff, interruption, déconnexion et changement de compte.
 *   NODE_OPTIONS=--experimental-sqlite npx --yes tsx --test src/offline/rollCall/sync/syncRunner.test.ts
 *
 * Serveur SIMULÉ en mémoire (transport) : chaque lot est validé par le vrai `readSyncBody` du Backend
 * (PR1c) et la règle d'idempotence est celle du journal PR1c (une écriture par session, ACK rejoué à
 * l'identique). Ce n'est PAS une preuve PostgreSQL : celle-ci est dans
 * backend/lib/rollCallOfflineSync.http.pg.test.js (section D, protocole Mobile PR4).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRollCallAccountManager, loadLastTrustedTime, type RcActiveAccount } from "../store/accountManager";
import { createTestPlatform } from "../store/rcTestPlatform.testutil";
import {
  beginSyncAttempt,
  closeSession,
  getSession,
  listSessions,
  openDraftSession,
  recordScan,
  reviseSession,
  runPurge,
  type RcContext,
} from "../store/repository";
import { createRollCallRuntime } from "../runtime/rollCallRuntime";
import { describeSyncStatus, SYNC_COPY } from "./syncStatus";
import {
  createRollCallSyncRunner,
  nextAttemptDelayMs,
  RC_MANUAL_COOLDOWN_MS,
  RC_MAX_RETRY_AFTER_MS,
  RC_RETRY_DELAYS_MS,
  RC_UNCONFIRMABLE_DELAY_MS,
  effectiveDelayMs,
  parseRetryAfter,
  type SyncTransport,
  type SyncTransportResult,
} from "./syncRunner";

const ROOT = path.resolve(__dirname, "../../../../..");
/* eslint-disable @typescript-eslint/no-require-imports */
const { readSyncBody } = require(path.join(ROOT, "backend/lib/rollCallOfflineSync.js"));
/* eslint-enable @typescript-eslint/no-require-imports */

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const TEACHER = "22222222-2222-4222-8222-222222222222";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLASS = "33333333-3333-4333-8333-333333333333";
const DATE = "2026-11-09";
const ENV = { environmentId: "production-3f2a9c1d", releaseProfile: "production" };
const IDENTITY = { environmentId: ENV.environmentId, userId: TEACHER, schoolId: SCHOOL };
const START = "2026-11-09T08:00:00Z";
/** sha256(RC_SCHEMA_V1) sur develop 76520633 (PR3 fusionnée). */
const RC_SCHEMA_V1_SHA256_PR3 = "444c7d64f2ce90d2e478b166471044ce05bd4591c430a306cc32bbc15bd20a46";
const session = (userId = TEACHER) => ({ user: { id: userId, schoolId: SCHOOL }, school: { id: SCHOOL } });

type Behavior = "ok" | "lose" | "timeout" | { status: number; body: unknown } | ((body: Record<string, unknown>) => SyncTransportResult);

/** Serveur simulé : règle d'idempotence du journal PR1c, lots validés par `readSyncBody`. */
function fakeServer(dateHeader = "Mon, 09 Nov 2026 08:00:05 GMT") {
  const journal = new Map<string, { operationId: string; payloadDigest: string; ack: Record<string, unknown> }>();
  const calls: { operationId: string; body: string }[] = [];
  const queue: Behavior[] = [];
  let writes = 0;
  const transport: SyncTransport = async ({ operationId, body }) => {
    calls.push({ operationId, body });
    const parsed = JSON.parse(body);
    readSyncBody(parsed, operationId); // le lot local est exactement celui que PR1c accepte
    const behavior = queue.shift() ?? "ok";
    if (behavior === "timeout") return { kind: "network", code: "TIMEOUT" };
    if (typeof behavior === "function") return behavior(parsed);
    const existing = journal.get(parsed.sessionId);
    if (existing) {
      if (existing.operationId === operationId && existing.payloadDigest === parsed.payloadDigest) {
        return { kind: "http", status: 200, body: { ...existing.ack, idempotentReplay: true }, dateHeader };
      }
      return { kind: "http", status: 409, body: { code: "ROLL_CALL_SESSION_CONFLICT", sessionState: "conflict" }, dateHeader };
    }
    if (typeof behavior === "object") return { kind: "http", status: behavior.status, body: behavior.body, dateHeader };
    const ack = {
      rollCallId: crypto.randomUUID(),
      sessionId: parsed.sessionId,
      operationId,
      revision: parsed.revision,
      payloadDigest: parsed.payloadDigest,
      validatedAt: new Date().toISOString(),
      created: parsed.scans.length,
      corrected: 0,
      unchanged: 0,
      protected: 0,
      protectedScanIds: [],
      protectedManualIndexes: [],
      invalidScanIds: [],
      counts: { present: parsed.scans.length, late: 0, absent: 0, excused: 0, enrolled: parsed.scans.length },
    };
    journal.set(parsed.sessionId, { operationId, payloadDigest: parsed.payloadDigest, ack });
    writes += 1;
    if (behavior === "lose") return { kind: "network", code: "TIMEOUT" }; // COMMIT serveur, réponse perdue
    return { kind: "http", status: 201, body: ack, dateHeader };
  };
  return { transport, calls, queue, journal, writes: () => writes };
}

async function setup(label: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rc-pr4-${label}-`));
  const platform = createTestPlatform({ dir, now: { ms: Date.parse(START) } });
  const manager = createRollCallAccountManager(platform);
  const opened = await manager.activate(IDENTITY);
  assert.ok(opened.ok);
  const account = (opened as { account: RcActiveAccount }).account;
  return { dir, platform, manager, ctx: account.ctx as RcContext };
}

async function closedRollCall(ctx: RcContext, scans = 2, date = DATE, classId = CLASS) {
  const { session: draft } = await openDraftSession(ctx, { classId, date, packId: null, syncDeadline: null });
  for (let i = 0; i < scans; i += 1) {
    await recordScan(ctx, {
      sessionId: draft.session_id,
      scanId: crypto.randomUUID(),
      publicId: crypto.randomBytes(16).toString("base64url"),
      proof: crypto.randomBytes(32).toString("base64url"),
      medium: i % 2 ? "qr" : "nfc",
      scannedAt: "2026-11-09T07:31:00.000Z",
      match: null,
    });
  }
  const closed = await closeSession(ctx, draft.session_id);
  return { sessionId: draft.session_id, ...closed };
}

function runnerFor(manager: ReturnType<typeof createRollCallAccountManager>, transport: SyncTransport) {
  return createRollCallSyncRunner({
    currentAccount: () => {
      const account = manager.current();
      return account ? { ctx: account.ctx } : null;
    },
    transport,
    random: () => 0.5,
  });
}

const proofsOf = (ctx: RcContext, sessionId: string) =>
  ctx.connection.read((db) => db.getAllAsync<{ proof: string | null }>("SELECT proof FROM rc_scans WHERE session_id = ?", [sessionId]));

test("premier envoi : corps figé envoyé octet pour octet, Idempotency-Key = operationId, ACK conforme → synced et purge", async () => {
  const { ctx, manager, platform } = await setup("first");
  const closed = await closedRollCall(ctx, 3);
  const server = fakeServer();
  const report = await runnerFor(manager, server.transport).run({ trigger: "closed" });
  assert.equal(report.synced, 1);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].body, closed.frozenBody, "corps strictement identique au corps figé");
  assert.equal(server.calls[0].operationId, closed.operationId);
  const row = await getSession(ctx, closed.sessionId);
  assert.equal(row.state, "synced");
  assert.equal(row.frozen_body, null, "corps figé purgé après COMMIT de synced");
  assert.ok((await proofsOf(ctx, closed.sessionId)).every((scan) => scan.proof === null), "preuves purgées");
  assert.equal(row.next_attempt_at, null);
  assert.ok(row.server_roll_call_id);
  assert.equal(describeSyncStatus(row, platform.now.ms).message, SYNC_COPY.syncedSuccess);
  assert.equal(await loadLastTrustedTime(ctx), Date.parse("Mon, 09 Nov 2026 08:00:05 GMT"), "horloge de confiance alimentée par Date");
});

test("timeout avant réception : failed_retryable, backoff respecté, renvoi identique, une seule écriture", async () => {
  const { ctx, manager, platform } = await setup("timeout");
  const closed = await closedRollCall(ctx);
  const server = fakeServer();
  server.queue.push("timeout");
  const runner = runnerFor(manager, server.transport);
  assert.equal((await runner.run({ trigger: "online" })).retryable, 1);
  const failed = await getSession(ctx, closed.sessionId);
  assert.equal(failed.state, "failed_retryable");
  assert.equal(failed.frozen_body, closed.frozenBody, "corps conservé");
  assert.equal(Date.parse(String(failed.next_attempt_at)) - platform.now.ms, RC_RETRY_DELAYS_MS[0]);
  assert.equal(describeSyncStatus(failed, platform.now.ms).canCorrect, false, "timeout : révision interdite");
  await assert.rejects(reviseSession(ctx, closed.sessionId), /RC_REVISION_FORBIDDEN|Révision interdite/);
  assert.equal((await runner.run({ trigger: "timer" })).attempted, 0, "avant l'échéance du backoff : rien n'est envoyé");
  platform.now.ms += RC_RETRY_DELAYS_MS[0];
  assert.equal((await runner.run({ trigger: "timer" })).synced, 1);
  assert.deepEqual(server.calls.map((call) => call.body), [closed.frozenBody, closed.frozenBody]);
  assert.equal(server.writes(), 1);
});

test("timeout après COMMIT serveur (réponse perdue) : même opération renvoyée, ACK rejoué, aucun doublon", async () => {
  const { ctx, manager, platform } = await setup("lost");
  const closed = await closedRollCall(ctx);
  const server = fakeServer();
  server.queue.push("lose");
  const runner = runnerFor(manager, server.transport);
  await runner.run({ trigger: "closed" });
  assert.equal((await getSession(ctx, closed.sessionId)).state, "failed_retryable");
  assert.equal(server.writes(), 1, "le serveur a déjà écrit");
  platform.now.ms += RC_RETRY_DELAYS_MS[0];
  await runner.run({ trigger: "timer" });
  assert.equal((await getSession(ctx, closed.sessionId)).state, "synced");
  assert.equal(server.writes(), 1, "aucune seconde écriture");
  assert.ok(server.calls.every((call) => call.body === closed.frozenBody && call.operationId === closed.operationId));
});

test("renvoi plus de 24 h après la première tentative : corps et opération inchangés", async () => {
  const { ctx, manager, platform } = await setup("day");
  const closed = await closedRollCall(ctx);
  const server = fakeServer();
  server.queue.push("lose");
  const runner = runnerFor(manager, server.transport);
  await runner.run({ trigger: "closed" });
  platform.now.ms += 25 * 3600 * 1000;
  await runner.run({ trigger: "resume" });
  assert.equal((await getSession(ctx, closed.sessionId)).state, "synced");
  assert.deepEqual(server.calls.map((call) => [call.operationId, call.body]), [[closed.operationId, closed.frozenBody], [closed.operationId, closed.frozenBody]]);
  assert.equal(server.writes(), 1);
});

test("application arrêtée pendant la transmission : reprise INTERRUPTED, renvoi identique", async () => {
  const { ctx, manager, platform } = await setup("killed");
  const closed = await closedRollCall(ctx);
  await beginSyncAttempt(ctx, closed.sessionId); // état `syncing` validé, puis l'application est tuée
  await manager.close();
  const restarted = createRollCallAccountManager(platform);
  const reopened = await restarted.activate(IDENTITY);
  assert.ok(reopened.ok);
  const ctx2 = (reopened as { account: RcActiveAccount }).account.ctx;
  const recovered = await getSession(ctx2, closed.sessionId);
  assert.equal(recovered.state, "failed_retryable");
  assert.equal(recovered.last_error_code, "INTERRUPTED");
  assert.equal(describeSyncStatus(recovered, platform.now.ms).canCorrect, false);
  const server = fakeServer();
  await runnerFor(restarted, server.transport).run({ trigger: "resume" });
  assert.equal((await getSession(ctx2, closed.sessionId)).state, "synced");
  assert.equal(server.calls[0].body, closed.frozenBody);
});

test("déclencheurs simultanés (deux reconnexions, clôture, minuterie) : un seul envoi en vol, aucun doublon", async () => {
  const { ctx, manager } = await setup("concurrent");
  const closed = await closedRollCall(ctx);
  const server = fakeServer();
  let inFlight = 0;
  let maxInFlight = 0;
  const slow: SyncTransport = async (input) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      return await server.transport(input);
    } finally {
      inFlight -= 1;
    }
  };
  const runner = runnerFor(manager, slow);
  await Promise.all([
    runner.run({ trigger: "online" }),
    runner.run({ trigger: "online" }),
    runner.run({ trigger: "closed" }),
    runner.run({ trigger: "timer" }),
  ]);
  assert.equal(maxInFlight, 1);
  assert.equal(server.calls.length, 1, "un seul envoi : les autres passages ne trouvent plus rien à envoyer");
  assert.equal((await getSession(ctx, closed.sessionId)).state, "synced");
});

test("ACK absent, malformé ou contradictoire : jamais synced, corps conservé, intervention, révision interdite", async () => {
  const { ctx, manager, platform } = await setup("ack");
  const cases: [string, (body: Record<string, unknown>) => SyncTransportResult][] = [
    ["ACK absent", () => ({ kind: "http", status: 201, body: null, dateHeader: null })],
    ["ACK non objet", () => ({ kind: "http", status: 201, body: ["x"], dateHeader: null })],
    ["autre opération", (b) => ({ kind: "http", status: 201, body: { sessionId: b.sessionId, operationId: crypto.randomUUID(), revision: b.revision, payloadDigest: b.payloadDigest }, dateHeader: null })],
    ["autre révision", (b) => ({ kind: "http", status: 201, body: { sessionId: b.sessionId, operationId: b.operationId, revision: 2, payloadDigest: b.payloadDigest }, dateHeader: null })],
    ["autre digest", (b) => ({ kind: "http", status: 201, body: { sessionId: b.sessionId, operationId: b.operationId, revision: b.revision, payloadDigest: "0".repeat(64) }, dateHeader: null })],
    ["autre session", (b) => ({ kind: "http", status: 200, body: { sessionId: crypto.randomUUID(), operationId: b.operationId, revision: b.revision, payloadDigest: b.payloadDigest }, dateHeader: null })],
    ["session absente", (b) => ({ kind: "http", status: 201, body: { operationId: b.operationId, revision: b.revision, payloadDigest: b.payloadDigest }, dateHeader: null })],
  ];
  for (const [label, behavior] of cases) {
    const closed = await closedRollCall(ctx, 1, DATE, crypto.randomUUID());
    const server = fakeServer();
    server.queue.push(behavior);
    await runnerFor(manager, server.transport).run({ trigger: "manual" });
    const row = await getSession(ctx, closed.sessionId);
    assert.equal(row.state, "failed_action_required", label);
    assert.equal(row.last_error_code, "ACK_MISMATCH", label);
    assert.equal(row.frozen_body, closed.frozenBody, `${label} : corps conservé`);
    assert.ok((await proofsOf(ctx, closed.sessionId)).every((scan) => scan.proof !== null), `${label} : preuves conservées`);
    const view = describeSyncStatus(row, platform.now.ms);
    assert.equal(view.canCorrect, false, `${label} : pas de correction sans not_recorded`);
    assert.equal(view.canSyncNow, false, label);
    await assert.rejects(reviseSession(ctx, closed.sessionId), /RC_REVISION_FORBIDDEN|Révision interdite/, `${label} : révision refusée par le stockage`);
  }
});

test("erreurs HTTP et réseau : classification PR0, backoff, unconfirmable conservé et renvoyé à l'identique", async () => {
  const expectations: [Behavior, string, string | null][] = [
    [{ status: 408, body: null }, "failed_retryable", null],
    [{ status: 429, body: { code: "RATE_LIMITED" } }, "failed_retryable", null],
    [{ status: 500, body: null }, "failed_retryable", null],
    [{ status: 503, body: { code: "OFFLINE_SYNC_TRANSACTION_UNAVAILABLE" } }, "failed_retryable", null],
    ["timeout", "failed_retryable", null],
    [{ status: 401, body: null }, "unconfirmable", null],
    [{ status: 403, body: { code: "ROLL_CALL_REPLAY_FORBIDDEN" } }, "unconfirmable", null],
    [{ status: 404, body: { code: "NOT_FOUND" } }, "unconfirmable", null],
    [{ status: 409, body: { code: "ROLL_CALL_ROSTER_CHANGED", sessionState: "not_recorded" } }, "failed_action_required", "not_recorded"],
    [{ status: 404, body: { code: "ROLL_CALL_OFFLINE_DISABLED", sessionState: "not_recorded" } }, "failed_action_required", "not_recorded"],
    [{ status: 409, body: { code: "ROLL_CALL_SESSION_CONFLICT", sessionState: "conflict" } }, "failed_action_required", "conflict"],
  ];
  for (const [behavior, state, lastSessionState] of expectations) {
    const label = typeof behavior === "string" ? behavior : `HTTP ${(behavior as { status: number }).status} ${JSON.stringify((behavior as { body: unknown }).body)}`;
    const { ctx, manager, platform } = await setup(`http-${expectations.indexOf(expectations.find((e) => e[0] === behavior)!)}`);
    const closed = await closedRollCall(ctx, 1);
    const server = fakeServer();
    server.queue.push(behavior);
    await runnerFor(manager, server.transport).run({ trigger: "manual" });
    const row = await getSession(ctx, closed.sessionId);
    assert.equal(row.state, state, label);
    assert.equal(row.last_session_state, lastSessionState, label);
    assert.equal(row.frozen_body, closed.frozenBody, `${label} : corps figé conservé`);
    assert.equal(row.operation_id, closed.operationId, `${label} : opération inchangée`);
    const view = describeSyncStatus(row, platform.now.ms);
    assert.equal(view.canCorrect, lastSessionState === "not_recorded", `${label} : correction seulement après not_recorded`);
    if (state === "failed_retryable") assert.ok(row.next_attempt_at, `${label} : tentative différée`);
    if (state === "unconfirmable") {
      assert.equal(view.label, "État serveur non confirmable actuellement.", label);
      assert.doesNotMatch(String(view.message), /non enregistré/i, `${label} : jamais « non enregistré »`);
      assert.equal(row.ever_unconfirmable, 1);
      assert.equal(Date.parse(String(row.next_attempt_at)) - platform.now.ms, RC_UNCONFIRMABLE_DELAY_MS);
      await assert.rejects(reviseSession(ctx, closed.sessionId), /RC_REVISION_FORBIDDEN|Révision interdite/, `${label} : aucune nouvelle révision`);
      // Droits rétablis : même opération, même corps.
      // Refus HTTP : échéance serveur, non avançable même manuellement.
      platform.now.ms += RC_MANUAL_COOLDOWN_MS;
      const early = fakeServer();
      await runnerFor(manager, early.transport).run({ trigger: "manual" });
      assert.equal(early.calls.length, 0, `${label} : refus serveur, pas de contournement manuel`);
      assert.equal(describeSyncStatus(await getSession(ctx, closed.sessionId), platform.now.ms).canSyncNow, false, `${label} : bouton masqué`);
      // Droits rétablis, échéance atteinte, reconnexion du compte : même opération, même corps.
      platform.now.ms = Date.parse(String(row.next_attempt_at));
      const again = fakeServer();
      await runnerFor(manager, again.transport).run({ trigger: "login" });
      assert.equal(again.calls[0].body, closed.frozenBody, `${label} : renvoi identique`);
      assert.equal((await getSession(ctx, closed.sessionId)).state, "synced");
    }
    if (lastSessionState === "conflict") await assert.rejects(reviseSession(ctx, closed.sessionId), /RC_REVISION_FORBIDDEN|Révision interdite/, "conflit : pas de révision");
  }
});

test("not_recorded : « Corriger l'appel » → même sessionId, révision + 1, brouillon ; nouvelle opération à la clôture suivante", async () => {
  const { ctx, manager } = await setup("revise");
  const closed = await closedRollCall(ctx, 2);
  const server = fakeServer();
  server.queue.push({ status: 409, body: { code: "ROLL_CALL_ROSTER_CHANGED", sessionState: "not_recorded" } });
  const runner = runnerFor(manager, server.transport);
  await runner.run({ trigger: "closed" });
  const revised = await reviseSession(ctx, closed.sessionId);
  assert.equal(revised.session_id, closed.sessionId);
  assert.equal(revised.revision, 2);
  assert.equal(revised.state, "draft");
  assert.equal(revised.operation_id, null);
  const reclosed = await closeSession(ctx, closed.sessionId);
  assert.notEqual(reclosed.operationId, closed.operationId, "nouvel operationId");
  assert.notEqual(reclosed.payloadDigest, closed.payloadDigest, "nouveau digest (révision 2)");
  await runner.run({ trigger: "closed" });
  const row = await getSession(ctx, closed.sessionId);
  assert.equal(row.state, "synced");
  assert.equal(JSON.parse(server.calls[1].body).revision, 2);
});

test("backoff borné : délais croissants plafonnés à 1 h ; intervention et succès sans nouvelle tentative", () => {
  const retry = { state: "failed_retryable" as const, lastSessionState: null, errorCode: "NETWORK_ERROR" };
  const delays = [1, 2, 3, 4, 5, 6, 7, 20].map((attempt) => nextAttemptDelayMs(retry, attempt, () => 0.5));
  assert.deepEqual(delays, [...RC_RETRY_DELAYS_MS, 3_600_000, 3_600_000]);
  assert.ok(nextAttemptDelayMs(retry, 1, () => 1)! <= RC_RETRY_DELAYS_MS[0] * 1.1);
  assert.ok(nextAttemptDelayMs(retry, 1, () => 0)! >= RC_RETRY_DELAYS_MS[0] * 0.9);
  assert.equal(nextAttemptDelayMs({ state: "unconfirmable", lastSessionState: null, errorCode: "HTTP_403" }, 1), RC_UNCONFIRMABLE_DELAY_MS);
  assert.equal(nextAttemptDelayMs({ state: "failed_action_required", lastSessionState: "not_recorded", errorCode: "X" }, 1), null);
  assert.equal(nextAttemptDelayMs({ state: "synced", lastSessionState: null, errorCode: null }, 1), null);
});

test("échéance J+3 dépassée : plus aucun envoi, jamais prolongée ; non confirmable : corps conservé à l'expiration", async () => {
  const { ctx, manager, platform } = await setup("deadline");
  const plain = await closedRollCall(ctx, 1, "2026-11-08");
  const unconf = await closedRollCall(ctx, 1, "2026-11-07");
  const server = fakeServer();
  // Le 07 reçoit un refus d'accès ; le 08 une erreur 503 (qui n'interrompt pas le passage).
  const byDate: SyncTransport = (input) =>
    JSON.parse(input.body).date === "2026-11-07"
      ? Promise.resolve({ kind: "http", status: 403, body: null, dateHeader: null })
      : Promise.resolve({ kind: "http", status: 503, body: null, dateHeader: null });
  await runnerFor(manager, byDate).run({ trigger: "manual" });
  await runnerFor(manager, byDate).run({ trigger: "manual" });
  void server;
  assert.equal((await getSession(ctx, unconf.sessionId)).state, "unconfirmable");
  platform.now.ms = Date.parse("2026-11-13T00:00:00Z"); // après D+4 12:00 UTC des deux appels
  const late = fakeServer();
  assert.equal((await runnerFor(manager, late.transport).run({ trigger: "manual" })).attempted, 0);
  assert.equal(late.calls.length, 0, "aucun envoi après l'échéance");
  await runPurge(ctx);
  const expiredPlain = await getSession(ctx, plain.sessionId);
  const expiredUnconf = await getSession(ctx, unconf.sessionId);
  assert.equal(expiredPlain.state, "expired");
  assert.equal(expiredPlain.frozen_body, null);
  assert.equal(expiredUnconf.state, "expired");
  assert.equal(expiredUnconf.frozen_body, unconf.frozenBody, "exception PR2 : corps conservé après un état non confirmable");
  assert.equal(describeSyncStatus(expiredPlain, platform.now.ms).label, "Appel expiré");
});

test("horloge de confiance : un en-tête Date ancien ne la fait jamais reculer", async () => {
  const { ctx, manager } = await setup("clock");
  const one = await closedRollCall(ctx, 1, "2026-11-09");
  const first = fakeServer("Mon, 09 Nov 2026 09:00:00 GMT");
  await runnerFor(manager, first.transport).run({ trigger: "manual" });
  assert.equal(await loadLastTrustedTime(ctx), Date.parse("Mon, 09 Nov 2026 09:00:00 GMT"));
  const two = await closedRollCall(ctx, 1, "2026-11-08");
  const older = fakeServer("Mon, 09 Nov 2026 06:00:00 GMT");
  await runnerFor(manager, older.transport).run({ trigger: "manual" });
  assert.equal(older.calls.length, 1);
  assert.equal(await loadLastTrustedTime(ctx), Date.parse("Mon, 09 Nov 2026 09:00:00 GMT"), "jamais de recul");
  assert.equal((await getSession(ctx, one.sessionId)).state, "synced");
  assert.equal((await getSession(ctx, two.sessionId)).state, "synced");
});

test("appel de 35 élèves hors connexion : lot figé conservé, puis transmis une fois au retour du réseau", async () => {
  const { ctx, manager, platform } = await setup("thirty-five");
  const closed = await closedRollCall(ctx, 35);
  const server = fakeServer();
  for (let i = 0; i < 3; i += 1) server.queue.push("timeout"); // téléphone hors connexion
  const runner = runnerFor(manager, server.transport);
  for (let i = 0; i < 3; i += 1) {
    await runner.run({ trigger: "timer" });
    const row = await getSession(ctx, closed.sessionId);
    assert.equal(row.state, "failed_retryable");
    assert.equal(row.frozen_body, closed.frozenBody, "aucun appel perdu");
    platform.now.ms = Date.parse(String(row.next_attempt_at));
  }
  server.queue.push("lose"); // réseau revenu, réponse perdue
  await runner.run({ trigger: "online" });
  platform.now.ms = Date.parse(String((await getSession(ctx, closed.sessionId)).next_attempt_at));
  await runner.run({ trigger: "timer" });
  const row = await getSession(ctx, closed.sessionId);
  assert.equal(row.state, "synced");
  assert.equal(JSON.parse(server.calls.at(-1)!.body).scans.length, 35);
  assert.ok(server.calls.every((call) => call.body === closed.frozenBody));
  assert.equal(server.writes(), 1, "une seule écriture serveur");
  assert.equal(describeSyncStatus(row, platform.now.ms).message, "Appel synchronisé avec succès.");
});

// ------------------------------- Runtime : comptes et cycle de vie -------------------------------

function deferredTransport() {
  const pending: { input: { operationId: string; body: string }; resolve: (r: SyncTransportResult) => void }[] = [];
  const transport: SyncTransport = (input) => new Promise((resolve) => pending.push({ input, resolve }));
  return { transport, pending };
}

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check(), "condition non atteinte");
}

function runtimeSetup(label: string, transport: SyncTransport) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rc-pr4-rt-${label}-`));
  const platform = createTestPlatform({ dir, now: { ms: Date.parse(START) } });
  const runtime = createRollCallRuntime({ platform, environment: () => ENV, transport, random: () => 0.5 });
  return { dir, platform, runtime };
}

const ackFor = (input: { operationId: string; body: string }): SyncTransportResult => {
  const parsed = JSON.parse(input.body);
  return { kind: "http", status: 201, body: { sessionId: parsed.sessionId, operationId: input.operationId, revision: parsed.revision, payloadDigest: parsed.payloadDigest }, dateHeader: null };
};

test("déconnexion pendant une requête : ACK tardif jamais appliqué, appel conservé, renvoi identique au retour du compte", async () => {
  const deferred = deferredTransport();
  const { runtime } = runtimeSetup("logout", deferred.transport);
  const opened = await runtime.activate(session());
  assert.ok(opened.ok);
  const closed = await closedRollCall((opened as { account: RcActiveAccount }).account.ctx);
  const sync = runtime.requestSync(session(), "closed");
  await waitFor(() => deferred.pending.length === 1);
  await runtime.refreshLogoutGuard(session());
  const plan = runtime.planLogout(session());
  assert.equal(plan.kind, "confirm", "appel en cours d'envoi : en attente");
  assert.equal(await runtime.finishLogout(plan, { confirmed: true }), "blocked_logout");
  deferred.pending[0].resolve(ackFor(deferred.pending[0].input)); // réponse tardive
  const report = await sync;
  assert.equal(report?.isolated, 1);
  // Retour du même compte : brouillon restauré en failed_retryable (INTERRUPTED), renvoi identique.
  const back = await runtime.activate(session());
  const ctx = (back as { account: RcActiveAccount }).account.ctx;
  const restored = await getSession(ctx, closed.sessionId);
  assert.equal(restored.state, "failed_retryable");
  assert.equal(restored.frozen_body, closed.frozenBody);
  const again = runtime.requestSync(session(), "login");
  await waitFor(() => deferred.pending.length === 2);
  assert.equal(deferred.pending[1].input.body, closed.frozenBody);
  deferred.pending[1].resolve(ackFor(deferred.pending[1].input));
  await again;
  assert.equal((await getSession(ctx, closed.sessionId)).state, "synced");
});

test("changement de compte pendant une requête : l'ACK n'est jamais appliqué à la base de l'autre compte", async () => {
  const deferred = deferredTransport();
  const { runtime } = runtimeSetup("switch", deferred.transport);
  const first = await runtime.activate(session(TEACHER));
  const closed = await closedRollCall((first as { account: RcActiveAccount }).account.ctx);
  const sync = runtime.requestSync(session(TEACHER), "closed");
  await waitFor(() => deferred.pending.length === 1);
  await runtime.onSessionChanged(session(OTHER)); // base du premier compte fermée, runner arrêté
  const other = await runtime.activate(session(OTHER));
  assert.ok(other.ok);
  deferred.pending[0].resolve(ackFor(deferred.pending[0].input));
  assert.equal((await sync)?.isolated, 1);
  assert.deepEqual(await listSessions((other as { account: RcActiveAccount }).account.ctx), [], "rien dans la base de l'autre compte");
  assert.equal(await runtime.requestSync(session(TEACHER), "manual"), null, "jamais d'envoi pour un compte dont la base n'est pas ouverte");
  await runtime.onSessionChanged(session(TEACHER));
  const back = runtime.current();
  assert.ok(back);
  const row = await getSession(back!.ctx, closed.sessionId);
  assert.notEqual(row.state, "synced", "la réponse tardive n'a rien validé");
  assert.equal(row.frozen_body, closed.frozenBody);
});

test("retour du même compte : la reconnexion évalue les envois dus, sans contourner le backoff", async () => {
  const server = fakeServer();
  const { runtime, platform } = runtimeSetup("relogin", server.transport);
  const opened = await runtime.activate(session());
  const closed = await closedRollCall((opened as { account: RcActiveAccount }).account.ctx);
  server.queue.push("timeout");
  await runtime.requestSync(session(), "closed");
  const plan = (await runtime.refreshLogoutGuard(session()), runtime.planLogout(session()));
  assert.equal(await runtime.finishLogout(plan, { confirmed: true }), "blocked_logout");
  await runtime.onSessionChanged(session()); // reconnexion : base rouverte, évaluation lancée
  await waitFor(() => !runtime.syncBusy());
  assert.equal(server.calls.length, 1, "tentative différée : la reconnexion ne la force pas");
  const restored = await getSession(runtime.current()!.ctx, closed.sessionId);
  assert.equal(restored.state, "failed_retryable");
  platform.now.ms = Date.parse(String(restored.next_attempt_at));
  await runtime.requestSync(session(), "login");
  assert.equal((await getSession(runtime.current()!.ctx, closed.sessionId)).state, "synced");
  assert.equal(server.calls[1].body, closed.frozenBody);
});

test("profil sans appel (Parent) : aucune base ouverte ni créée par la synchronisation ; MP-011 inchangé", async () => {
  const server = fakeServer();
  const { dir, runtime } = runtimeSetup("parent", server.transport);
  await runtime.onSessionChanged(session(OTHER));
  assert.equal(await runtime.requestSync(session(OTHER), "online"), null);
  assert.equal(runtime.planLogout(session(OTHER)).kind, "immediate");
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.equal(server.calls.length, 0);
});

// ------------------------- Backoff : reconnexions, Retry-After, borne -------------------------

test("bascules répétées du réseau et reconnexions : aucune tentative avant next_attempt_at (503)", async () => {
  const { ctx, manager, platform } = await setup("flap");
  const closed = await closedRollCall(ctx);
  const server = fakeServer();
  server.queue.push({ status: 503, body: null });
  const runner = runnerFor(manager, server.transport);
  await runner.run({ trigger: "closed" });
  const due = Date.parse(String((await getSession(ctx, closed.sessionId)).next_attempt_at));
  // Vingt alternances hors ligne / en ligne, reconnexions du compte, reprises, minuterie.
  for (let i = 0; i < 20; i += 1) {
    platform.now.ms += 1000;
    await runner.run({ trigger: (["online", "login", "resume", "timer"] as const)[i % 4] });
  }
  assert.ok(platform.now.ms < due);
  assert.equal(server.calls.length, 1, "le backoff enregistré est respecté");
  platform.now.ms = due;
  await runner.run({ trigger: "online" });
  assert.equal(server.calls.length, 2, "tentative due : envoyée au retour du réseau");
  assert.equal((await getSession(ctx, closed.sessionId)).state, "synced");
});

test("429 et 503 avec Retry-After : délai serveur respecté (borné), jamais raccourci", async () => {
  assert.equal(parseRetryAfter("120", 0), 120_000);
  assert.equal(parseRetryAfter("Mon, 09 Nov 2026 08:10:00 GMT", Date.parse(START)), 600_000);
  assert.equal(parseRetryAfter("bientôt", 0), null);
  assert.equal(parseRetryAfter(null, 0), null);
  assert.equal(effectiveDelayMs(30_000, 120_000), 120_000);
  assert.equal(effectiveDelayMs(300_000, 10_000), 300_000, "jamais plus court que le backoff");
  assert.equal(effectiveDelayMs(30_000, 10 * 24 * 3_600_000), RC_MAX_RETRY_AFTER_MS, "borné");
  assert.equal(effectiveDelayMs(null, 120_000), null, "intervention : aucune tentative automatique");
  for (const status of [429, 503]) {
    const { ctx, manager, platform } = await setup(`retry-after-${status}`);
    const closed = await closedRollCall(ctx);
    const transport: SyncTransport = async () => ({ kind: "http", status, body: null, dateHeader: null, retryAfterMs: 600_000 });
    const runner = runnerFor(manager, transport);
    await runner.run({ trigger: "closed" });
    const row = await getSession(ctx, closed.sessionId);
    assert.equal(row.state, "failed_retryable");
    assert.equal(Date.parse(String(row.next_attempt_at)) - platform.now.ms, 600_000, `${status} : Retry-After appliqué`);
    platform.now.ms += 599_000;
    assert.equal((await runner.run({ trigger: "online" })).attempted, 0, `${status} : pas avant Retry-After`);
  }
});

test("« Synchroniser maintenant » : avance le backoff client (réseau), au plus une fois toutes les 30 s par appel", async () => {
  const { ctx, manager, platform } = await setup("manual");
  const closed = await closedRollCall(ctx);
  const server = fakeServer();
  for (let i = 0; i < 5; i += 1) server.queue.push("timeout");
  const runner = runnerFor(manager, server.transport);
  await runner.run({ trigger: "closed" });
  for (let i = 0; i < 10; i += 1) await runner.run({ trigger: "manual" }); // appuis répétés
  assert.equal(server.calls.length, 1, "cooldown : appuis répétés sans effet");
  platform.now.ms += RC_MANUAL_COOLDOWN_MS + 1;
  await runner.run({ trigger: "manual" });
  assert.equal(server.calls.length, 2, "après le délai minimal : tentative avancée");
  assert.ok(server.calls.every((call) => call.body === closed.frozenBody));
});

test("borne de tentatives : 503 permanent sur toute la fenêtre J+3 avec minuterie chaque minute", async () => {
  const { ctx, manager, platform } = await setup("bound");
  const closed = await closedRollCall(ctx);
  const starts: number[] = [];
  const transport: SyncTransport = async () => {
    starts.push(platform.now.ms);
    return { kind: "http", status: 503, body: null, dateHeader: null };
  };
  const runner = runnerFor(manager, transport);
  await runner.run({ trigger: "closed" });
  const deadline = Date.parse((await getSession(ctx, closed.sessionId)).sync_deadline);
  while (platform.now.ms < deadline + 3_600_000) {
    platform.now.ms += 60_000;
    await runner.run({ trigger: (platform.now.ms / 60_000) % 2 ? "timer" : "online" });
  }
  const hours = (deadline - Date.parse(START)) / 3_600_000;
  assert.ok(starts.length <= Math.ceil(hours) + RC_RETRY_DELAYS_MS.length, `${starts.length} tentatives pour ${hours} h`);
  for (let i = 1; i < starts.length; i += 1) {
    const planned = RC_RETRY_DELAYS_MS[Math.min(i, RC_RETRY_DELAYS_MS.length) - 1];
    assert.ok(starts[i] - starts[i - 1] >= planned * 0.9, `intervalle ${i} respecté`);
  }
  assert.ok(starts.every((at) => at < deadline), "aucune tentative après l'échéance");
  const row = await getSession(ctx, closed.sessionId);
  assert.equal(row.frozen_body, closed.frozenBody, "lot conservé jusqu'à l'échéance");
});

// ------------------- Réponses tardives : fermeture SQLCipher et changement de compte -------------------

/**
 * Course réelle : la vérification d'appartenance est passée (le runner « croit » encore que la base
 * est la sienne) puis la base est fermée — voire un autre compte ouvert — AVANT les écritures.
 * `currentAccount` renvoie volontairement l'ancien contexte pour placer la fermeture dans cet
 * intervalle. La connexion fermée refuse toute écriture : ni fausse confirmation, ni écriture
 * dans la base d'un autre compte ; l'opération figée reste rejouable à l'identique.
 */
for (const variant of ["date-header", "no-date-header", "account-switch"] as const) {
  test(`réponse tardive après fermeture de la base (${variant}) : rien d'écrit, rejeu idempotent`, async () => {
    const { ctx, manager, platform } = await setup(`late-${variant}`);
    const closed = await closedRollCall(ctx);
    const server = fakeServer(variant === "no-date-header" ? "" : "Mon, 09 Nov 2026 08:00:05 GMT");
    const trustedBefore = await loadLastTrustedTime(ctx);
    let otherCtx: RcContext | null = null;
    const racing: SyncTransport = async (input) => {
      const result = await server.transport(input); // le serveur a enregistré (COMMIT)
      await manager.close(); // fermeture SQLCipher pendant que la réponse est en vol
      if (variant === "account-switch") {
        const other = await manager.activate({ ...IDENTITY, userId: OTHER });
        assert.ok(other.ok);
        otherCtx = (other as { account: RcActiveAccount }).account.ctx;
      }
      return variant === "no-date-header" && result.kind === "http" ? { ...result, dateHeader: null } : result;
    };
    const stale = createRollCallSyncRunner({ currentAccount: () => ({ ctx }), transport: racing, random: () => 0.5 });
    const report = await stale.run({ trigger: "closed" });
    assert.equal(report.synced, 0, "aucune fausse confirmation");
    assert.equal(report.isolated, 1);
    if (otherCtx) {
      assert.deepEqual(await listSessions(otherCtx), [], "rien dans la base de l'autre compte");
      assert.ok(!(await loadLastTrustedTime(otherCtx)), "horloge de l'autre compte intacte (jamais écrite)");
      await manager.close();
    }
    // Retour du compte : `syncing` repris en failed_retryable (INTERRUPTED), lot intact, rejeu identique.
    const reopened = await manager.activate(IDENTITY);
    const ctx2 = (reopened as { account: RcActiveAccount }).account.ctx;
    const row = await getSession(ctx2, closed.sessionId);
    assert.equal(row.state, "failed_retryable");
    assert.equal(row.last_error_code, "INTERRUPTED");
    assert.equal(row.frozen_body, closed.frozenBody);
    assert.equal(row.operation_id, closed.operationId);
    assert.equal(await loadLastTrustedTime(ctx2), trustedBefore, "aucune écriture d'horloge après fermeture");
    platform.now.ms += 1000;
    await runnerFor(manager, server.transport).run({ trigger: "resume" });
    assert.equal((await getSession(ctx2, closed.sessionId)).state, "synced");
    assert.equal(server.writes(), 1, "aucun doublon serveur");
    assert.ok(server.calls.every((call) => call.body === closed.frozenBody && call.operationId === closed.operationId));
  });
}

// ------------------------ Échéance serveur : jamais contournée, même manuellement ------------------------

for (const status of [429, 503] as const) {
  test(`Retry-After ${status} (6 h) : appuis manuels à +30 s, bascules réseau, reconnexion, reprise → aucun envoi avant la borne serveur`, async () => {
    const { ctx, manager, platform } = await setup(`server-floor-${status}`);
    const closed = await closedRollCall(ctx);
    const server = fakeServer();
    server.queue.push((() => ({ kind: "http", status, body: { code: "RATE_LIMITED" }, dateHeader: null, retryAfterMs: 21_600_000 })) as Behavior);
    const runner = runnerFor(manager, server.transport);
    await runner.run({ trigger: "closed" });
    const row = await getSession(ctx, closed.sessionId);
    const floor = Date.parse(String(row.next_attempt_at));
    assert.equal(floor - platform.now.ms, 21_600_000, "Retry-After 6 h enregistré");
    assert.equal(row.last_http_status, status);
    const view = describeSyncStatus(row, platform.now.ms + 31_000);
    assert.equal(view.canSyncNow, false, "bouton « Synchroniser maintenant » masqué pendant le délai serveur");
    assert.match(String(view.message), /délai demandé par le serveur/);
    // Pendant 6 h : appuis manuels répétés (dès +30 s), bascules réseau, reconnexions, reprises, minuterie.
    const triggers = ["manual", "online", "login", "resume", "timer", "manual", "closed"] as const;
    for (let elapsed = 31_000, i = 0; platform.now.ms + 31_000 < floor; elapsed += 31_000, i += 1) {
      platform.now.ms += 31_000;
      await runner.run({ trigger: triggers[i % triggers.length] });
    }
    assert.equal(server.calls.length, 1, "aucun envoi avant la borne serveur, quel que soit le déclencheur");
    platform.now.ms = floor;
    await runner.run({ trigger: "manual" });
    assert.equal(server.calls.length, 2, "envoi seulement à la borne serveur");
    assert.equal((await getSession(ctx, closed.sessionId)).state, "synced");
    assert.ok(server.calls.every((call) => call.body === closed.frozenBody));
  });
}

test("toute réponse HTTP fixe une échéance serveur non avançable ; seul un échec sans réponse est avançable", async () => {
  const cases: [Behavior, boolean][] = [
    [{ status: 503, body: null }, false],
    [{ status: 500, body: null }, false],
    [{ status: 408, body: null }, false],
    [{ status: 429, body: null }, false],
    [{ status: 403, body: null }, false],
    ["timeout", true],
  ];
  for (const [behavior, advanceable] of cases) {
    const name = typeof behavior === "string" ? behavior : typeof behavior === "object" ? String(behavior.status) : "fn";
    const { ctx, manager, platform } = await setup(`floor-${name}`);
    const closed = await closedRollCall(ctx);
    const server = fakeServer();
    server.queue.push(behavior, behavior);
    const runner = runnerFor(manager, server.transport);
    await runner.run({ trigger: "closed" });
    // Deuxième échec à l'échéance : le délai suivant (≥ 2 min) dépasse largement le cooldown manuel.
    platform.now.ms = Date.parse(String((await getSession(ctx, closed.sessionId)).next_attempt_at));
    await runner.run({ trigger: "timer" });
    assert.equal(server.calls.length, 2, name);
    platform.now.ms += RC_MANUAL_COOLDOWN_MS + 1;
    assert.ok(Date.parse(String((await getSession(ctx, closed.sessionId)).next_attempt_at)) > platform.now.ms, `${name} : tentative non due`);
    await runner.run({ trigger: "manual" });
    assert.equal(server.calls.length, advanceable ? 3 : 2, `${name} : ${advanceable ? "backoff client avancé" : "échéance serveur respectée"}`);
    if (!advanceable) assert.notEqual((await getSession(ctx, closed.sessionId)).state, "synced");
  }
});

test("compatibilité des bases SQLCipher existantes : schéma v1 inchangé, appel clôturé avant PR4 synchronisé", async () => {
  // Empreinte du schéma local PR2/PR3 (develop 76520633) : PR4 n'ajoute ni colonne ni migration.
  const { RC_SCHEMA_V1, RC_LOCAL_SCHEMA_VERSION } = await import("../store/schema");
  assert.equal(RC_LOCAL_SCHEMA_VERSION, 1);
  assert.equal(crypto.createHash("sha256").update(RC_SCHEMA_V1).digest("hex"), RC_SCHEMA_V1_SHA256_PR3);
  // Base créée et appel clôturé « avant PR4 » (aucune tentative, next_attempt_at NULL), base fermée,
  // puis rouverte par l'application mise à jour : lecture, envoi, synced.
  const { ctx, manager, platform } = await setup("legacy");
  const closed = await closedRollCall(ctx);
  await manager.close();
  const updated = createRollCallAccountManager(platform);
  const reopened = await updated.activate(IDENTITY);
  assert.ok(reopened.ok, "base existante rouverte sans quarantaine");
  const ctx2 = (reopened as { account: RcActiveAccount }).account.ctx;
  const legacy = await getSession(ctx2, closed.sessionId);
  assert.equal(legacy.next_attempt_at, null);
  assert.equal(legacy.last_http_status, null);
  const server = fakeServer();
  await runnerFor(updated, server.transport).run({ trigger: "resume" });
  assert.equal((await getSession(ctx2, closed.sessionId)).state, "synced");
  assert.equal(server.calls[0].body, closed.frozenBody);
});
