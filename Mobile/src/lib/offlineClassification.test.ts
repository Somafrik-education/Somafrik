/**
 * P1 — classification hors-connexion : HTTP connu ≠ offline.
 *   npx tsx Mobile/src/lib/offlineClassification.test.ts
 */
import assert from "node:assert/strict";
import {
  getConnectivityState,
  isOfflineContext,
  isRecognizedTransportFailure,
  noteConnectivityFailure,
  noteConnectivitySuccess,
  probeConnectivity,
  resetConnectivityForTests,
  setConnectivityProbeForTests,
  setConnectivityStateForTests,
} from "./connectivity";
import { classifyLoadFailure } from "./dataTruth";
import {
  classifyMutationFailure,
  describeConnectivity,
  executeMutation,
  setMutationDelayForTests,
} from "./networkResilience";
import {
  listOutbox,
  processOutbox,
  setOutboxStorageForTests,
  submitProtectedMutation,
} from "./outbox";
import { overlayPresenceOutboxOnAttendance } from "./attendanceOffline";
import { rollCallQueuedAlertBody, ROLL_CALL_COPY, type RollCallEntry } from "./attendanceTruth";
import type { OutboxEntry } from "./outbox";

function httpError(message: string, status?: number, code?: string) {
  return Object.assign(new Error(message), { status, code, name: "ApiClientError" });
}

const session = { userId: "teacher-1", schoolScope: "CD-2026-0001" };

function memoryOutbox() {
  const memory: { entries: unknown[] } = { entries: [] };
  setOutboxStorageForTests({
    async read() {
      return JSON.parse(JSON.stringify(memory.entries));
    },
    async write(entries) {
      memory.entries = JSON.parse(JSON.stringify(entries));
    },
  });
  return memory;
}

async function submitPresences(input: {
  key: string;
  request: () => Promise<unknown>;
  knownOffline?: boolean;
}) {
  return submitProtectedMutation({
    domain: "presences",
    method: "POST",
    path: "/presences",
    payload: { classId: "cls-1", items: [{ studentId: "s1", status: "Présent" }] },
    idempotencyKey: input.key,
    userId: session.userId,
    schoolScope: session.schoolScope,
    persistOutbox: true,
    knownOffline: input.knownOffline,
    request: input.request,
  });
}

async function run() {
  setMutationDelayForTests(async () => undefined);
  resetConnectivityForTests();
  memoryOutbox();

  // --- transport predicate ---
  assert.equal(isRecognizedTransportFailure(httpError("Connexion Internet indisponible.", 0, "NETWORK_UNAVAILABLE")), true);
  assert.equal(isRecognizedTransportFailure(httpError("failed to fetch")), true);
  assert.equal(isRecognizedTransportFailure(httpError("Délai de requête dépassé. Vérifiez votre réseau.", undefined, "TIMEOUT")), false);
  assert.equal(isRecognizedTransportFailure(httpError("Impossible de joindre le serveur Somafrik.", undefined, "BACKEND_UNREACHABLE")), false);
  assert.equal(isRecognizedTransportFailure(httpError("validation", 400)), false);
  assert.equal(isRecognizedTransportFailure(httpError("interdit", 403)), false);
  assert.equal(isRecognizedTransportFailure(httpError("conflit", 409)), false);
  assert.equal(isRecognizedTransportFailure(httpError("boom", 500)), false);
  assert.equal(isRecognizedTransportFailure(Object.assign(new Error("aborted"), { name: "AbortError" })), false);

  resetConnectivityForTests();
  noteConnectivityFailure(httpError("Délai de requête dépassé. Vérifiez votre réseau.", undefined, "TIMEOUT"));
  assert.equal(getConnectivityState(), "unknown", "timeout ≠ hors connexion");
  noteConnectivityFailure(httpError("Impossible de joindre le serveur Somafrik.", undefined, "BACKEND_UNREACHABLE"));
  assert.equal(getConnectivityState(), "unknown", "joindre ≠ hors connexion");
  noteConnectivityFailure(httpError("validation", 400));
  assert.equal(getConnectivityState(), "unknown");
  noteConnectivityFailure(httpError("boom", 500));
  assert.equal(getConnectivityState(), "unknown", "5xx ≠ hors connexion");
  noteConnectivityFailure(httpError("Connexion Internet indisponible.", 0, "NETWORK_UNAVAILABLE"));
  assert.equal(getConnectivityState(), "offline");
  noteConnectivitySuccess();
  assert.equal(isOfflineContext(), false);

  resetConnectivityForTests();
  setConnectivityProbeForTests(async () => {
    throw httpError("health down", 500);
  });
  assert.equal(await probeConnectivity(), false);
  assert.notEqual(getConnectivityState(), "offline", "/health 5xx ne force pas offline");

  resetConnectivityForTests();
  setConnectivityProbeForTests(async () => {
    throw httpError("Délai de requête dépassé. Vérifiez votre réseau.", undefined, "TIMEOUT");
  });
  assert.equal(await probeConnectivity(), false);
  assert.notEqual(getConnectivityState(), "offline", "/health timeout ne force pas offline");

  resetConnectivityForTests();
  setConnectivityProbeForTests(async () => {
    throw httpError("not found", 404);
  });
  assert.equal(await probeConnectivity(), false);
  assert.notEqual(getConnectivityState(), "offline", "/health 404 ne force pas offline");

  // --- GET snapshot classification ---
  assert.equal(classifyLoadFailure({ status: 0, message: "Connexion Internet indisponible." }).status, "offline");
  assert.equal(classifyLoadFailure(httpError("Délai de requête dépassé. Vérifiez votre réseau.", undefined, "TIMEOUT")).status, "error");
  assert.equal(classifyLoadFailure(httpError("validation", 400)).status, "error");
  assert.equal(classifyLoadFailure(httpError("interdit", 403)).status, "error");
  assert.equal(classifyLoadFailure(httpError("absent", 404)).status, "error");
  assert.equal(classifyLoadFailure(httpError("conflit", 409)).status, "error");
  assert.equal(classifyLoadFailure(httpError("unprocessable", 422)).status, "error");
  assert.equal(classifyLoadFailure(httpError("boom", 500)).status, "error");
  assert.equal(classifyLoadFailure(httpError("timeout", 408)).status, "error");

  assert.equal(describeConnectivity(httpError("bad gateway", 502)), "backend_5xx");
  assert.equal(describeConnectivity(httpError("Délai de requête dépassé. Vérifiez votre réseau.", undefined, "TIMEOUT")), "timeout");
  assert.equal(describeConnectivity(httpError("Connexion Internet indisponible.", 0, "NETWORK_UNAVAILABLE")), "device_offline");
  assert.equal(describeConnectivity(httpError("Impossible de joindre le serveur Somafrik.", undefined, "BACKEND_UNREACHABLE")), "backend_unreachable");
  assert.equal(describeConnectivity(httpError("validation", 400)), "ok", "4xx n'est pas une classe de connectivité");

  assert.doesNotMatch(ROLL_CALL_COPY.queuedAlertBody, /retour du réseau/);
  assert.match(ROLL_CALL_COPY.queuedAlertBodyOffline, /retour du réseau/);
  assert.doesNotMatch(rollCallQueuedAlertBody("backend_5xx"), /retour du réseau|hors connexion/i);
  assert.doesNotMatch(rollCallQueuedAlertBody("timeout"), /retour du réseau|hors connexion/i);
  assert.doesNotMatch(rollCallQueuedAlertBody("unconfirmed"), /retour du réseau/);
  assert.match(rollCallQueuedAlertBody("device_offline"), /retour du réseau/);

  // 1. réseau OK + backend OK → 2xx, pas d'outbox pending
  memoryOutbox();
  resetConnectivityForTests();
  setConnectivityStateForTests("online");
  const ok = await submitPresences({
    key: "pre-2xx",
    request: async () => [{ id: "PRE-1", studentId: "s1", status: "Présent" }],
  });
  assert.equal(ok.outcome, "confirmed");
  assert.equal((await listOutbox())[0]?.status, "sent");

  // 2. mode avion → outbox, attente réseau
  memoryOutbox();
  const airplane = await submitPresences({
    key: "pre-air",
    knownOffline: true,
    request: async () => {
      throw new Error("should not POST");
    },
  });
  assert.equal(airplane.outcome, "queued");
  if (airplane.outcome !== "queued") throw new Error("unreachable");
  assert.equal(airplane.queuedReason, "offline_skip");
  assert.equal((await listOutbox())[0]?.status, "pending");
  assert.match(rollCallQueuedAlertBody("device_offline"), /retour du réseau/);

  // 3. Wi-Fi actif, API injoignable → transport, pas « hors connexion » UI
  memoryOutbox();
  resetConnectivityForTests();
  setConnectivityStateForTests("online");
  const unreachable = await submitPresences({
    key: "pre-unreach",
    knownOffline: false,
    request: async () => {
      throw httpError("Impossible de joindre le serveur Somafrik.", undefined, "BACKEND_UNREACHABLE");
    },
  });
  assert.equal(unreachable.outcome, "queued");
  assert.equal(describeConnectivity(unreachable.outcome === "queued" ? unreachable.error : null), "backend_unreachable");
  assert.equal(getConnectivityState(), "online", "API injoignable ne bascule pas l'appareil offline");
  assert.doesNotMatch(rollCallQueuedAlertBody("backend_unreachable"), /hors connexion|retour du réseau/i);

  // 4–6. HTTP 400/403/409 → failed métier, jamais queued/offline
  for (const [status, key, message] of [
    [400, "pre-400", "validation métier"] as const,
    [403, "pre-403", "permissions"] as const,
    [409, "pre-409", "conflit métier"] as const,
  ]) {
    memoryOutbox();
    const result = await submitPresences({
      key,
      knownOffline: false,
      request: async () => {
        throw httpError(message, status);
      },
    });
    assert.equal(result.outcome, "failed", `${status} doit échouer`);
    assert.notEqual(result.outcome, "queued", `${status} n'est pas hors connexion`);
    assert.equal(classifyMutationFailure(httpError(message, status)), status === 409 ? "conflict" : "non_retryable");
    assert.equal((await listOutbox())[0]?.status, "failed");
    assert.equal(getConnectivityState(), "online");
  }

  // 5b. 401 auth → failed, pas queued
  memoryOutbox();
  const unauthorized = await submitPresences({
    key: "pre-401",
    knownOffline: false,
    request: async () => {
      throw httpError("Session expirée. Veuillez vous reconnecter.", 401);
    },
  });
  assert.equal(unauthorized.outcome, "failed");
  assert.equal(unauthorized.outcome !== "failed" ? null : unauthorized.failureKind, "auth_required");
  assert.equal((await listOutbox())[0]?.status, "failed");

  // 7. backend 500 → queued retryable, copie serveur, jamais « retour du réseau »
  memoryOutbox();
  const serverDown = await submitPresences({
    key: "pre-500",
    knownOffline: false,
    request: async () => {
      throw httpError("internal", 500);
    },
  });
  assert.equal(serverDown.outcome, "queued");
  if (serverDown.outcome !== "queued") throw new Error("unreachable");
  assert.equal(serverDown.queuedReason, "retryable");
  assert.equal(describeConnectivity(serverDown.error), "backend_5xx");
  assert.doesNotMatch(rollCallQueuedAlertBody("backend_5xx"), /retour du réseau/);
  assert.equal((await listOutbox())[0]?.status, "pending");
  assert.equal(getConnectivityState(), "online");

  // 8. timeout → même Idempotency-Key, pas de double écriture
  memoryOutbox();
  const timeoutKey = "pre-timeout-same";
  let posts = 0;
  const timeoutSubmit = await submitPresences({
    key: timeoutKey,
    knownOffline: false,
    request: async () => {
      posts += 1;
      throw httpError("Délai de requête dépassé. Vérifiez votre réseau.", undefined, "TIMEOUT");
    },
  });
  assert.equal(timeoutSubmit.outcome, "queued");
  assert.equal(describeConnectivity(timeoutSubmit.outcome === "queued" ? timeoutSubmit.error : null), "timeout");
  const pendingTimeout = await listOutbox();
  assert.equal(pendingTimeout[0]?.idempotencyKey, timeoutKey);
  assert.equal(pendingTimeout[0]?.status, "pending");
  assert.equal(posts, 3, "executeMutation retry borné sur timeout");
  const replayKeys: string[] = [];
  await processOutbox(session, async (entry) => {
    replayKeys.push(entry.idempotencyKey);
    return [{ id: "PRE-timeout", studentId: "s1" }];
  });
  assert.deepEqual(replayKeys, [timeoutKey]);
  assert.equal((await listOutbox())[0]?.status, "sent");

  // Mutation absente de l'outbox → pas d'annonce « sera envoyée plus tard »
  const persistStore = {
    async read() {
      return [];
    },
    async write() {
      throw new Error("disk full");
    },
  };
  setOutboxStorageForTests(persistStore);
  const persistFailed = await submitPresences({
    key: "pre-no-outbox",
    knownOffline: true,
    request: async () => [{ id: "nope" }],
  });
  assert.equal(persistFailed.outcome, "failed");
  assert.equal(persistFailed.outcome !== "failed" ? null : persistFailed.persistFailed, true);
  assert.doesNotMatch(ROLL_CALL_COPY.persistFailedBody, /sera envoyée plus tard|retour du réseau/);

  memoryOutbox();

  // Capture : popup queued + lignes « Erreur de synchronisation »
  // 1) enqueue pending → UI queued  2) replay 4xx → outbox failed → overlay failed
  const captureKey = "pre-capture";
  const queuedFirst = await submitPresences({
    key: captureKey,
    knownOffline: true,
    request: async () => [{ id: "nope" }],
  });
  assert.equal(queuedFirst.outcome, "queued");
  const students = [{ id: "s1", matricule: "M1", publicId: "s1" }];
  const attendance: Record<string, RollCallEntry> = {
    s1: { status: "Présent", source: "queued" },
  };
  const pendingOverlay = overlayPresenceOutboxOnAttendance({
    attendance,
    students,
    entries: await listOutbox(),
    identity: { classId: "cls-1", classCode: "CLS-1" },
    todayLabel: "25-08-2026",
  });
  // payload has classId cls-1 but overlay matches date too — payload date missing so may not overlay.
  // Force overlay with a matching entry:
  const pendingEntry = (await listOutbox())[0] as OutboxEntry;
  const matchingPending: OutboxEntry = {
    ...pendingEntry,
    payload: {
      classId: "uuid-a",
      classCode: "CLS-A",
      date: "25-08-2026",
      items: [{ studentId: "s1", status: "Présent" }],
    },
  };
  const queuedRows = overlayPresenceOutboxOnAttendance({
    attendance,
    students,
    entries: [matchingPending],
    identity: { classId: "uuid-a", classCode: "CLS-A" },
    todayLabel: "25-08-2026",
  });
  assert.equal(queuedRows.s1?.source, "queued");

  await processOutbox(session, async () => {
    throw httpError("validation métier", 400);
  });
  const failedEntry: OutboxEntry = {
    ...(await listOutbox())[0]!,
    payload: matchingPending.payload,
  };
  assert.equal(failedEntry.status, "failed");
  const failedRows = overlayPresenceOutboxOnAttendance({
    attendance: queuedRows,
    students,
    entries: [failedEntry],
    identity: { classId: "uuid-a", classCode: "CLS-A" },
    todayLabel: "25-08-2026",
  });
  assert.equal(failedRows.s1?.source, "failed");
  assert.equal(ROLL_CALL_COPY.syncError, "Erreur de synchronisation");

  // Sticky fake-offline must not skip a live POST when connectivity is online
  memoryOutbox();
  resetConnectivityForTests();
  setConnectivityStateForTests("online");
  let livePosts = 0;
  const notSkipped = await submitPresences({
    key: "pre-not-sticky",
    knownOffline: false,
    request: async () => {
      livePosts += 1;
      throw httpError("validation métier", 400);
    },
  });
  assert.equal(livePosts, 1, "POST réellement envoyé si pas de vraie coupure");
  assert.equal(notSkipped.outcome, "failed");

  // retry executeMutation conserve la même clé
  const reused = "pre-retry-uuid";
  const seen: string[] = [];
  await executeMutation({
    jitter: false,
    request: async () => {
      seen.push(reused);
      if (seen.length < 3) throw httpError("unavailable", 503);
      return { ok: true };
    },
  });
  assert.deepEqual(seen, [reused, reused, reused]);

  setMutationDelayForTests(null);
  resetConnectivityForTests();
  console.log("offlineClassification.test.ts OK");
}

run().catch((error) => {
  setMutationDelayForTests(null);
  resetConnectivityForTests();
  console.error(error);
  process.exit(1);
});
