/**
 * NFC-STATUT-PRESENCE-01 — écran des présences et appel NFC : « Absent » provisoire au départ,
 * « Présent » dès le COMMIT SQLCipher d'une carte (sans réseau), justifiés conservés, absences
 * écrites seulement après confirmation explicite.
 *   NODE_OPTIONS=--experimental-sqlite npx --yes tsx --test src/offline/rollCall/session/nfcStatutPresence.test.ts
 *
 * Aucun serveur : la preuve que rien n'est envoyé par scan est le contrat PR3 (aucun transport
 * dans le chemin de lecture). Le lot figé est validé par le vrai `readSyncBody` du Backend.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyLocalRollCallMarks,
  emptyRollCallEntry,
  getRollCallDraftStats,
  markRosterPresent,
  provisionalStudentIds,
  rollCallEntryFromPresence,
  rollCallSourceLabel,
  ROLL_CALL_COPY,
  type AttendanceStatus,
  type RollCallEntry,
} from "../../../lib/attendanceTruth";
import { createRollCallAccountManager, type RcActiveAccount } from "../store/accountManager";
import { createTestPlatform } from "../store/rcTestPlatform.testutil";
import { getSession, openDraftSession, recordScan, setManualMark, type RcContext } from "../store/repository";
import type { PackStudent, VerifiedPack } from "../pack/verifyPack";
import { loadLocalRollCallStatuses } from "./localRollCallStatuses";
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
const PACK_ID = "44444444-4444-4444-8444-444444444444";
const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const IDS = Array.from({ length: 35 }, (_, i) => id(i + 1));
/** Lignes de l'écran : mêmes UUID que le pack (identifiant API de l'élève). */
const ROWS = IDS.map((value) => ({ id: value, matricule: `E-${value.slice(-2)}` }));
const JUSTIFIED = IDS[34]; // élève n° 35 : déjà justifié en PostgreSQL ce jour-là

async function account(label: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rc-statut-${label}-`));
  const manager = createRollCallAccountManager(createTestPlatform({ dir, now: { ms: Date.parse("2026-11-09T08:00:00Z") } }));
  const opened = await manager.activate(IDENTITY);
  assert.ok(opened.ok);
  return { manager, ctx: (opened as { account: RcActiveAccount }).account.ctx as RcContext };
}

function packStudents(withJustified = true): PackStudent[] {
  return IDS.map((studentId, i) => ({
    matchKey: `MK-${String(i + 1).padStart(2, "0")}`,
    studentId,
    studentCode: `E-${i + 1}`,
    firstName: "Élève",
    lastName: String(i + 1),
    existingStatus: withJustified && studentId === JUSTIFIED ? "excused" : null,
  }));
}

async function openRollCall(ctx: RcContext, withJustified = true): Promise<OfflineRollCall> {
  const { session } = await openDraftSession(ctx, { classId: CLASS, date: DATE, packId: PACK_ID, syncDeadline: "2026-11-12T23:00:00Z" });
  const pack = { pack: { packId: PACK_ID, students: packStudents(withJustified) } } as unknown as VerifiedPack;
  return { session, pack, resumed: false };
}

async function scan(ctx: RcContext, rollCall: OfflineRollCall, index: number) {
  const student = rollCall.pack!.pack.students[index];
  await recordScan(ctx, {
    sessionId: rollCall.session.session_id,
    scanId: crypto.randomUUID(),
    publicId: crypto.randomBytes(16).toString("base64url"),
    proof: crypto.randomBytes(32).toString("base64url"),
    medium: "nfc",
    scannedAt: "2026-11-09T07:31:00.000Z",
    match: { matchKey: student.matchKey, studentId: student.studentId },
    markPresent: student.existingStatus === null,
  });
}

/** État de l'écran : serveur (justifié n° 35) + superposition des statuts NFC locaux. */
function screenState(local: Record<string, AttendanceStatus>, withJustified = true): Record<string, RollCallEntry> {
  const server: Record<string, RollCallEntry> = Object.fromEntries(IDS.map((value) => [value, emptyRollCallEntry()]));
  if (withJustified) server[JUSTIFIED] = rollCallEntryFromPresence({ present: false, status: "Justifié" });
  return applyLocalRollCallMarks(server, local);
}

test("tableau CTO : 35 élèves, 0/35 → 10/25 → 22/13 → 35/0, mis à jour à chaque COMMIT, sans réseau", async () => {
  const { ctx } = await account("table");
  const rollCall = await openRollCall(ctx, false);
  let scanned = 0;
  for (const [count, absentShown] of [[0, 35], [10, 25], [22, 13], [35, 0]] as const) {
    while (scanned < count) {
      await scan(ctx, rollCall, scanned++);
      // Après CHAQUE carte : l'élève scanné est déjà « Présent » à l'écran.
      const live = screenState(await loadLocalRollCallStatuses(ctx, { classId: CLASS, date: DATE, students: ROWS }), false);
      assert.equal(live[IDS[scanned - 1]].status, "Présent", `carte ${scanned}`);
    }
    const state = screenState(await loadLocalRollCallStatuses(ctx, { classId: CLASS, date: DATE, students: ROWS }), false);
    const stats = getRollCallDraftStats(IDS, state);
    assert.deepEqual([stats.present, stats.absent], [count, absentShown], `${count} cartes`);
    assert.equal(provisionalStudentIds(IDS, state).length, absentShown, "toutes les absences affichées sont provisoires");
  }
});

test("35 élèves dont 1 justifié : Absent provisoire à l'ouverture, Présent à chaque carte, justifié conservé", async () => {
  const { ctx } = await account("progress");
  const rollCall = await openRollCall(ctx);
  const expected = [
    [0, 0, 34],
    [10, 10, 24],
    [22, 22, 12],
    [34, 34, 0],
  ] as const;
  let scanned = 0;
  for (const [count, present, provisional] of expected) {
    while (scanned < count) await scan(ctx, rollCall, scanned++);
    const local = await loadLocalRollCallStatuses(ctx, { classId: CLASS, date: DATE, students: ROWS });
    const state = screenState(local);
    const stats = getRollCallDraftStats(IDS, state);
    assert.equal(stats.present, present, `${count} cartes : présents`);
    assert.equal(stats.absent, provisional, `${count} cartes : absents affichés`);
    assert.equal(stats.justified, 1, "justifié conservé");
    assert.equal(provisionalStudentIds(IDS, state).length, provisional, "absences seulement provisoires");
    for (const value of IDS.slice(0, count)) {
      assert.equal(state[value].status, "Présent");
      assert.equal(state[value].source, "nfc_local");
      assert.equal(rollCallSourceLabel(state[value].source), ROLL_CALL_COPY.nfcLocal);
    }
  }
  // Carte de l'élève justifié : lue, mais le statut serveur « Justifié » n'est jamais écrasé.
  await scan(ctx, rollCall, 34);
  const state = screenState(await loadLocalRollCallStatuses(ctx, { classId: CLASS, date: DATE, students: ROWS }));
  assert.equal(state[JUSTIFIED].status, "Justifié");
  assert.equal(state[JUSTIFIED].source, "postgres");
});

test("exemple CTO : 22 cartes sur 35 → 22 présents, 13 absents affichés (12 provisoires + aucun écrit) et le justifié", async () => {
  const { ctx } = await account("22");
  const rollCall = await openRollCall(ctx);
  for (let i = 0; i < 22; i += 1) await scan(ctx, rollCall, i);
  const summary = await summarizeOfflineRollCall(ctx, rollCall);
  assert.deepEqual([summary.present, summary.absent, summary.excused, summary.notRecorded], [22, 0, 1, 12]);
  const rows = summary.rows.filter((row) => row.status === null);
  assert.equal(rows.length, 12);
  assert.equal(OFFLINE_ROLL_CALL_COPY.provisionalAbsent, "Absent (provisoire)");
});

test("clôture sans confirmation : aucune absence écrite ; avec confirmation : absences explicites, justifié exclu", async () => {
  const first = await account("noconfirm");
  const a = await openRollCall(first.ctx);
  for (let i = 0; i < 22; i += 1) await scan(first.ctx, a, i);
  assert.ok((await closeOfflineRollCall(first.ctx, a)).ok);
  const bodyA = JSON.parse(String((await getSession(first.ctx, a.session.session_id)).frozen_body));
  assert.deepEqual(bodyA.manual, [], "clôture sans confirmation : aucune absence");
  readSyncBody(bodyA, bodyA.operationId);

  const second = await account("confirm");
  const b = await openRollCall(second.ctx);
  for (let i = 0; i < 22; i += 1) await scan(second.ctx, b, i);
  // Une correction manuelle (retard) n'est jamais transformée en absence.
  const late = packStudents()[22];
  await setManualMark(second.ctx, { sessionId: b.session.session_id, matchKey: late.matchKey, studentId: late.studentId, status: "late" });
  assert.ok((await closeOfflineRollCall(second.ctx, b, { confirmAbsences: true })).ok);
  const bodyB = JSON.parse(String((await getSession(second.ctx, b.session.session_id)).frozen_body));
  const absent = bodyB.manual.filter((mark: { status: string }) => mark.status === "absent").map((mark: { studentId: string }) => mark.studentId);
  assert.deepEqual(absent.sort(), IDS.slice(23, 34).sort(), "11 absences confirmées : ni les scannés, ni le retard, ni le justifié");
  assert.ok(!absent.includes(JUSTIFIED), "justifié jamais converti en absence");
  assert.deepEqual(bodyB.manual.filter((mark: { status: string }) => mark.status === "late").map((mark: { studentId: string }) => mark.studentId), [late.studentId]);
  assert.equal(bodyB.complete, false);
  readSyncBody(bodyB, bodyB.operationId);
});

test("« Tout présent » : déclaration explicite, statuts confirmés (Justifié, Retard) et présences NFC conservés", () => {
  const state = screenState({ [IDS[0]]: "Présent" });
  state[IDS[1]] = rollCallEntryFromPresence({ present: true, status: "Retard" });
  state[IDS[2]] = rollCallEntryFromPresence({ present: false, status: "Absent" });
  const marked = markRosterPresent(IDS, state, "Enseignant", new Date("2026-11-09T08:30:00"));
  assert.equal(marked[JUSTIFIED].status, "Justifié");
  assert.equal(marked[IDS[1]].status, "Retard");
  assert.equal(marked[IDS[0]].source, "nfc_local", "présence NFC locale laissée à l'appel NFC");
  assert.equal(marked[IDS[2]].status, "Présent", "absence confirmée corrigeable");
  assert.equal(marked[IDS[3]].source, "draft", "absence provisoire → présent explicite");
  assert.equal(provisionalStudentIds(IDS, marked).length, 0);
});

test("écran des présences : superposition NFC, confirmation des absences, aucune présence NFC renvoyée par l'appel manuel", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../../screens/TeacherAttendanceScreen.tsx"), "utf8");
  assert.match(source, /applyLocalRollCallMarks\(attendance, localRollCallStatuses\)/);
  assert.match(source, /loadLocalRollCallStatuses\(/);
  assert.match(source, /subscribeSync\(/, "synchronisation : relecture puis données serveur");
  assert.match(source, /onLocalChange=\{/, "mise à jour à chaque COMMIT pendant l'appel NFC");
  assert.match(source, /provisionalStudentIds\(/);
  assert.match(source, /ROLL_CALL_COPY\.confirmAbsencesTitle/);
  assert.match(source, /source === "nfc_local"\) return false/, "présences NFC exclues du lot manuel");
  assert.match(source, /presencePayload = sentRows\.map/);
  const modal = fs.readFileSync(path.join(__dirname, "../../../components/OfflineRollCallModal.tsx"), "utf8");
  assert.match(modal, /onLocalChangeRef\.current\?\.\(\)/);
  assert.match(modal, /closeConfirmAbsences/);
  assert.match(modal, /OFFLINE_ROLL_CALL_COPY\.provisionalAbsent/);
  assert.doesNotMatch(modal, /"Non pointé"/);
});
