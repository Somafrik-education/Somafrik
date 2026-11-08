/**
 * NFC-APPEL-PARTIEL-01 — appel NFC partiel côté Mobile : clôture sans couvrir toute la classe,
 * compteurs exacts, aucune absence par défaut, conservation après fermeture forcée, synchronisation
 * après reconnexion, révision seulement après `not_recorded`, bandeau cohérent avec l'état stocké.
 *   NODE_OPTIONS=--experimental-sqlite npx --yes tsx --test src/offline/rollCall/session/partialRollCall.test.ts
 *
 * Serveur SIMULÉ (transport) : chaque lot passe par le vrai `readSyncBody` du Backend. La preuve
 * PostgreSQL est dans backend/lib/rollCallOfflinePartial.http.pg.test.js.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRollCallAccountManager, type RcActiveAccount } from "../store/accountManager";
import { createTestPlatform } from "../store/rcTestPlatform.testutil";
import { getSession, listMarks, openDraftSession, recordScan, reviseSession, type RcContext } from "../store/repository";
import type { RcSessionState } from "../store/schema";
import { createRollCallSyncRunner, type SyncTransport } from "../sync/syncRunner";
import { describeSyncStatus, SYNC_BANNER, syncBanner } from "../sync/syncStatus";
import type { PackStudent, VerifiedPack } from "../pack/verifyPack";
import { OFFLINE_ROLL_CALL_COPY, closeOfflineRollCall, summarizeOfflineRollCall, type OfflineRollCall } from "./offlineRollCall";

const ROOT = path.resolve(__dirname, "../../../../..");
/* eslint-disable @typescript-eslint/no-require-imports */
const { readSyncBody } = require(path.join(ROOT, "backend/lib/rollCallOfflineSync.js"));
/* eslint-enable @typescript-eslint/no-require-imports */

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const TEACHER = "22222222-2222-4222-8222-222222222222";
const CLASS = "33333333-3333-4333-8333-333333333333";
const DATE = "2026-11-09";
const IDENTITY = { environmentId: "production-3f2a9c1d", userId: TEACHER, schoolId: SCHOOL };
const START = "2026-11-09T08:00:00Z";
const PACK_ID = "44444444-4444-4444-8444-444444444444";

const studentId = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const STUDENTS: PackStudent[] = Array.from({ length: 35 }, (_, i) => ({
  matchKey: `MK-${String(i + 1).padStart(2, "0")}`,
  studentId: studentId(i + 1),
  studentCode: `E-${i + 1}`,
  firstName: "Élève",
  lastName: String(i + 1),
  existingStatus: null,
}));

async function setup(label: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rc-partial-${label}-`));
  const platform = createTestPlatform({ dir, now: { ms: Date.parse(START) } });
  const manager = createRollCallAccountManager(platform);
  const opened = await manager.activate(IDENTITY);
  assert.ok(opened.ok);
  const account = (opened as { account: RcActiveAccount }).account;
  return { dir, platform, manager, ctx: account.ctx as RcContext };
}

/** Appel de 35 élèves (pack simulé : seul `pack.students` est lu par le résumé), n cartes lues. */
async function rollCallWithScans(ctx: RcContext, scanned: number): Promise<OfflineRollCall> {
  const { session } = await openDraftSession(ctx, { classId: CLASS, date: DATE, packId: PACK_ID, syncDeadline: "2026-11-12T23:00:00Z" });
  for (const student of STUDENTS.slice(0, scanned)) {
    await recordScan(ctx, {
      sessionId: session.session_id,
      scanId: crypto.randomUUID(),
      publicId: crypto.randomBytes(16).toString("base64url"),
      proof: crypto.randomBytes(32).toString("base64url"),
      medium: "nfc",
      scannedAt: "2026-11-09T07:31:00.000Z",
      match: { matchKey: student.matchKey, studentId: student.studentId },
    });
  }
  const pack = { pack: { packId: PACK_ID, students: STUDENTS } } as unknown as VerifiedPack;
  return { session, pack, resumed: false };
}

function conformingServer() {
  const calls: string[] = [];
  const transport: SyncTransport = async ({ operationId, body }) => {
    calls.push(body);
    const parsed = JSON.parse(body);
    readSyncBody(parsed, operationId); // contrat serveur réel
    return {
      kind: "http",
      status: 201,
      dateHeader: "Mon, 09 Nov 2026 08:00:05 GMT",
      body: {
        rollCallId: crypto.randomUUID(), sessionId: parsed.sessionId, operationId, revision: parsed.revision, payloadDigest: parsed.payloadDigest,
        validatedAt: new Date().toISOString(), created: parsed.scans.length, corrected: 0, unchanged: 0, protected: 0,
        protectedScanIds: [], protectedManualIndexes: [], invalidScanIds: [],
        counts: { present: parsed.scans.length, late: 0, absent: 0, excused: 0, enrolled: 35 },
      },
    };
  };
  return { transport, calls };
}

const runnerFor = (manager: ReturnType<typeof createRollCallAccountManager>, transport: SyncTransport) =>
  createRollCallSyncRunner({
    currentAccount: () => {
      const account = manager.current();
      return account ? { ctx: account.ctx } : null;
    },
    transport,
    random: () => 0.5,
  });

for (const scanned of [1, 10, 22, 35]) {
  test(`clôture partielle : ${scanned} carte(s) sur 35, compteurs exacts, aucune absence par défaut`, async () => {
    const { ctx } = await setup(`n${scanned}`);
    const rollCall = await rollCallWithScans(ctx, scanned);
    const summary = await summarizeOfflineRollCall(ctx, rollCall);
    assert.deepEqual(
      { total: summary.total, present: summary.present, late: summary.late, absent: summary.absent, excused: summary.excused, notRecorded: summary.notRecorded },
      { total: 35, present: scanned, late: 0, absent: 0, excused: 0, notRecorded: 35 - scanned },
    );
    const closed = await closeOfflineRollCall(ctx, rollCall);
    assert.ok(closed.ok, "clôture acceptée sans couvrir toute la classe");
    const body = JSON.parse(String((await getSession(ctx, rollCall.session.session_id)).frozen_body));
    assert.equal(body.complete, false);
    assert.equal(body.scans.length, scanned);
    assert.deepEqual(body.manual, [], "aucune marque absent de source default");
    const marks = await listMarks(ctx, rollCall.session.session_id);
    assert.equal(marks.filter((mark) => mark.source === "default").length, 0);
    assert.equal(marks.filter((mark) => mark.status === "absent").length, 0);
    readSyncBody(body, body.operationId);
  });
}

test("22 / 35 : fermeture forcée, réouverture, synchronisation après reconnexion, bandeau « synchronisé » après ACK", async () => {
  const { manager, platform, ctx } = await setup("restart");
  const rollCall = await rollCallWithScans(ctx, 22);
  const closed = await closeOfflineRollCall(ctx, rollCall);
  assert.ok(closed.ok);
  const frozen = String((await getSession(ctx, rollCall.session.session_id)).frozen_body);
  assert.equal(syncBanner("closed")?.message, "Appel enregistré localement — à synchroniser");

  await manager.close(); // fermeture forcée de l'application
  const reopenedManager = createRollCallAccountManager(platform);
  const reopened = await reopenedManager.activate(IDENTITY);
  assert.ok(reopened.ok);
  const ctx2 = (reopened as { account: RcActiveAccount }).account.ctx as RcContext;
  const kept = await getSession(ctx2, rollCall.session.session_id);
  assert.equal(kept.state, "closed");
  assert.equal(kept.frozen_body, frozen, "corps figé conservé à l'identique");

  const server = conformingServer();
  const report = await runnerFor(reopenedManager, server.transport).run({ trigger: "online" });
  assert.equal(report.synced, 1);
  assert.equal(server.calls[0], frozen, "renvoyé octet pour octet");
  const synced = await getSession(ctx2, rollCall.session.session_id);
  assert.equal(synced.state, "synced");
  assert.equal(syncBanner(synced.state)?.message, "Appel synchronisé avec succès");
  assert.equal(describeSyncStatus(synced, platform.now.ms).label, "Synchronisé");
});

test("ACK non conforme (2xx) : jamais « synchronisé »", async () => {
  const { manager, ctx } = await setup("badack");
  const rollCall = await rollCallWithScans(ctx, 5);
  assert.ok((await closeOfflineRollCall(ctx, rollCall)).ok);
  const transport: SyncTransport = async ({ operationId, body }) => {
    const parsed = JSON.parse(body);
    return { kind: "http", status: 201, dateHeader: null, body: { sessionId: parsed.sessionId, operationId, revision: parsed.revision, payloadDigest: "0".repeat(64) } };
  };
  await runnerFor(manager, transport).run({ trigger: "online" });
  const row = await getSession(ctx, rollCall.session.session_id);
  assert.notEqual(row.state, "synced");
  assert.notEqual(syncBanner(row.state)?.message, SYNC_BANNER.synced);
});

test("révision seulement après not_recorded ; la révision ne réintroduit aucune absence", async () => {
  const { manager, ctx, platform } = await setup("revise");
  const rollCall = await rollCallWithScans(ctx, 3);
  assert.ok((await closeOfflineRollCall(ctx, rollCall)).ok);
  const serverError: SyncTransport = async () => ({ kind: "http", status: 500, dateHeader: null, body: { code: "INTERNAL" } });
  await runnerFor(manager, serverError).run({ trigger: "online" });
  await assert.rejects(reviseSession(ctx, rollCall.session.session_id), /RC_REVISION_FORBIDDEN|Révision interdite/);
  platform.now.ms += 10 * 60_000;
  const notRecorded: SyncTransport = async () => ({
    kind: "http", status: 409, dateHeader: null, body: { code: "ROLL_CALL_CARD_INVALID", sessionState: "not_recorded", details: { invalidScanIds: [] } },
  });
  await runnerFor(manager, notRecorded).run({ trigger: "manual" });
  const failed = await getSession(ctx, rollCall.session.session_id);
  assert.equal(failed.state, "failed_action_required");
  assert.equal(describeSyncStatus(failed, platform.now.ms).canCorrect, true);
  const revised = await reviseSession(ctx, rollCall.session.session_id);
  assert.equal(revised.state, "draft");
  assert.equal(revised.revision, 2);
  const reclosed = await closeOfflineRollCall(ctx, { ...rollCall, session: revised });
  assert.ok(reclosed.ok);
  const body = JSON.parse(String((await getSession(ctx, rollCall.session.session_id)).frozen_body));
  assert.equal(body.revision, 2);
  assert.equal(body.complete, false);
  assert.deepEqual(body.manual, []);
});

test("bandeau : un libellé par état, jamais « à synchroniser » et « synchronisé » ensemble", () => {
  const expected: Partial<Record<RcSessionState, string>> = {
    closed: "Appel enregistré localement — à synchroniser",
    syncing: "Synchronisation en cours",
    failed_retryable: "Enregistré localement — nouvelle tentative prévue",
    unconfirmable: "État serveur non confirmable",
    failed_action_required: "Échec à résoudre",
    synced: "Appel synchronisé avec succès",
    expired: "Appel expiré — intervention nécessaire",
  };
  for (const [state, message] of Object.entries(expected)) {
    assert.equal(syncBanner(state as RcSessionState)?.message, message, state);
    if (state !== "synced") assert.doesNotMatch(String(message), /synchronisé avec succès/i, state);
  }
  assert.doesNotMatch(SYNC_BANNER.synced, /attente|à synchroniser/i);
  assert.equal(syncBanner("draft"), null, "aucun bandeau de synchronisation pour un brouillon");
  assert.doesNotMatch(OFFLINE_ROLL_CALL_COPY.closed, /attente de synchronisation/);
});

test("écran d'appel : bandeau dérivé de l'état stocké et relu à chaque synchronisation ; compteurs explicites", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../../components/OfflineRollCallModal.tsx"), "utf8");
  assert.match(source, /syncBanner\(storedState\)/);
  assert.match(source, /subscribeSync\(/, "mise à jour sans fermer l'écran");
  assert.doesNotMatch(source, /\{OFFLINE_ROLL_CALL_COPY\.closed\}/, "aucun message figé de clôture affiché");
  for (const label of ["Inscrits", "Présents", "En retard", "Absents saisis", "Justifiés", "Non pointés", "À vérifier"]) {
    assert.ok(source.includes(`["${label}"`), label);
  }
  assert.doesNotMatch(source, /"Restants"/);
});
