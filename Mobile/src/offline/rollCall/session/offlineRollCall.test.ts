/**
 * NFC-PRES-LOCAL-PR3 — appel hors connexion : acquisition, doublons, corrections, clôture.
 *   NODE_OPTIONS=--experimental-sqlite npx --yes tsx --test src/offline/rollCall/session/offlineRollCall.test.ts
 *
 * Oracle Backend : packs signés par le signataire PR1b, preuves vérifiées par `verifyProof` (PR1a)
 * et lot clôturé validé par `readSyncBody` (PR1c) — le lot local est exactement celui que le
 * serveur acceptera en PR4.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRollCallAccountManager, type RcActiveAccount } from "../store/accountManager";
import { createTestPlatform } from "../store/rcTestPlatform.testutil";
import { getSession, listSessions, type RcContext } from "../store/repository";
import { validatePackKeyring } from "../pack/keyring";
import {
  OFFLINE_ROLL_CALL_COPY,
  packLoader,
  closeOfflineRollCall,
  openOfflineRollCall,
  parseCardCapability,
  prepareOfflinePack,
  processCard,
  setOfflineMark,
  summarizeOfflineRollCall,
  type OfflinePackState,
} from "./offlineRollCall";

const ROOT = path.resolve(__dirname, "../../../../..");
/* eslint-disable @typescript-eslint/no-require-imports */
const { createPackSigner } = require(path.join(ROOT, "backend/lib/rollCallOfflinePackSigner.js"));
const { buildPack, computePackWindow } = require(path.join(ROOT, "backend/lib/rollCallOfflinePack.js"));
const { verifyProof, cardKeyFromTokenHash } = require(path.join(ROOT, "backend/lib/rollCallOfflineProof.js"));
const { readSyncBody } = require(path.join(ROOT, "backend/lib/rollCallOfflineSync.js"));
/* eslint-enable @typescript-eslint/no-require-imports */

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const TEACHER = "22222222-2222-4222-8222-222222222222";
const CLASS = "33333333-3333-4333-8333-333333333333";
const DATE = "2026-11-09";
const IDENTITY = { environmentId: "production-3f2a9c1d", userId: TEACHER, schoolId: SCHOOL };
const STUDENTS = {
  A: "55555555-5555-4555-8555-555555555555",
  B: "66666666-6666-4666-8666-666666666666",
  C: "77777777-7777-4777-8777-777777777777",
  D: "88888888-8888-4888-8888-888888888888",
};

type Card = { publicId: string; secret: string; tokenHash: string; studentId: string };
function card(studentId: string): Card {
  const publicId = crypto.randomBytes(16).toString("base64url");
  const secret = crypto.randomBytes(32).toString("base64url");
  return { publicId, secret, tokenHash: crypto.createHash("sha256").update(secret).digest("hex"), studentId };
}
const CARDS = { A1: card(STUDENTS.A), A2: card(STUDENTS.A), B: card(STUDENTS.B), D: card(STUDENTS.D), STRANGER: card("99999999-9999-4999-8999-999999999999") };
const token = (c: Card, prefixed = false) => `${prefixed ? "somafrik:card:" : ""}${c.publicId}.${c.secret}`;

const key = (() => {
  const pair = crypto.generateKeyPairSync("ed25519");
  return {
    keyId: "rc-pack-production-1",
    publicKey: pair.publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64url"),
    privateKey: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  };
})();
const keyring = validatePackKeyring("production", [{ keyId: key.keyId, publicKey: key.publicKey, status: "active" }]);
const signer = createPackSigner({
  ROLL_CALL_PACK_SIGNING_KEY: key.privateKey,
  ROLL_CALL_PACK_KEYRING: JSON.stringify({ revocationSequence: 0, keys: [{ keyId: key.keyId, publicKey: key.publicKey, status: "active" }] }),
});

function packResponse(overrides: { students?: unknown[]; packId?: string } = {}) {
  const pack = buildPack({
    packId: overrides.packId ?? "44444444-4444-4444-8444-444444444444",
    keyId: signer.keyId,
    schoolId: SCHOOL,
    actorUserId: TEACHER,
    classId: CLASS,
    date: DATE,
    timeZone: "Africa/Kinshasa",
    window: computePackWindow("Africa/Kinshasa", DATE),
    nowMs: Date.parse("2026-11-08T16:02:00Z"),
    students: overrides.students ?? [
      { studentId: STUDENTS.A, studentCode: "E-A", firstName: "Ngalula", lastName: "Kabasélé", existingStatus: null },
      { studentId: STUDENTS.B, studentCode: "E-B", firstName: "Ilunga", lastName: "Mbuyi", existingStatus: null },
      { studentId: STUDENTS.C, studentCode: "E-C", firstName: "Kanku", lastName: "Tshibola", existingStatus: null },
      { studentId: STUDENTS.D, studentCode: "E-D", firstName: "Mwamba", lastName: "Kasongo", existingStatus: "excused" },
    ],
    cards: [CARDS.A1, CARDS.A2, CARDS.B, CARDS.D].map((c) => ({ studentId: c.studentId, publicId: c.publicId, tokenHash: c.tokenHash })),
    matchSecret: Buffer.alloc(32, 4),
  });
  return { text: JSON.stringify({ pack, signature: signer.signPack(pack), revocations: signer.signedRevocations(pack.issuedAt) }), dateHeader: "Sun, 08 Nov 2026 17:00:00 GMT" };
}

async function setup(label: string, nowIso = "2026-11-09T07:30:00Z") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rc-pr3-${label}-`));
  const platform = createTestPlatform({ dir, now: { ms: Date.parse(nowIso) } });
  const manager = createRollCallAccountManager(platform);
  const opened = await manager.activate(IDENTITY);
  assert.ok(opened.ok, JSON.stringify(opened));
  return { platform, manager, ctx: (opened as { account: RcActiveAccount }).account.ctx as RcContext };
}

const prepareInput = { keyring, classId: CLASS, date: DATE, schoolId: SCHOOL, actorUserId: TEACHER };

test("capability : format strict publicId.secret, préfixe NDEF admis, tout le reste refusé", () => {
  const c = CARDS.A1;
  assert.deepEqual(parseCardCapability(token(c)), { publicId: c.publicId, secret: c.secret });
  assert.deepEqual(parseCardCapability(token(c, true)), { publicId: c.publicId, secret: c.secret });
  for (const bad of ["", "x", `${c.publicId}`, `${c.publicId}.${c.secret}.x`, `${c.publicId} .${c.secret}`, `${c.publicId}.${c.secret}=`, `https://x/${c.publicId}.${c.secret}`, `${c.publicId.slice(1)}.${c.secret}`, 42, null]) {
    assert.equal(parseCardCapability(bad as never), null, String(bad));
  }
});

test("appel complet avec pack : compteurs par élève, doublons, cartes multiples, carte inconnue, statut protégé", async () => {
  const { ctx } = await setup("full");
  const pack = await prepareOfflinePack(ctx, { ...prepareInput, download: async () => packResponse() });
  assert.equal(pack.status, "verified");
  const verified = (pack as Extract<OfflinePackState, { status: "verified" }>).verified;
  const rollCall = await openOfflineRollCall(ctx, { classId: CLASS, date: DATE, pack: verified });
  assert.equal(rollCall.resumed, false);
  assert.ok(rollCall.pack);

  const scan = (c: Card, medium: "nfc" | "qr" = "nfc") => processCard(ctx, rollCall, { token: token(c, medium === "nfc"), medium, actorUserId: TEACHER });
  assert.equal((await scan(CARDS.A1)).kind, "recorded");
  const dup = await scan(CARDS.A1, "qr");
  assert.equal(dup.kind, "duplicate");
  assert.equal(dup.kind === "duplicate" && dup.message, OFFLINE_ROLL_CALL_COPY.duplicate);
  const second = await scan(CARDS.A2);
  assert.equal(second.kind, "already_counted", "deuxième carte du même élève");
  assert.equal((await scan(CARDS.B, "qr")).kind, "recorded");
  const stranger = await scan(CARDS.STRANGER);
  assert.equal(stranger.kind, "unknown");
  const protectedScan = await scan(CARDS.D);
  assert.equal(protectedScan.kind, "protected");
  assert.match(protectedScan.kind === "protected" ? protectedScan.message : "", /Justifié/);
  assert.equal((await processCard(ctx, rollCall, { token: "pas-une-carte", medium: "nfc", actorUserId: TEACHER })).kind, "invalid_card");

  let summary = await summarizeOfflineRollCall(ctx, rollCall);
  assert.deepEqual(
    { total: summary.total, present: summary.present, late: summary.late, absent: summary.absent, excused: summary.excused, notRecorded: summary.notRecorded, unknownScans: summary.unknownScans, scans: summary.scans },
    { total: 4, present: 2, late: 0, absent: 0, excused: 1, notRecorded: 1, unknownScans: 1, scans: 5 },
    "5 lectures acceptées, 2 élèves présents : le compteur suit les élèves, pas les scans",
  );

  // Corrections : C en retard ; justification protégée intouchable.
  const C = verified.pack.students.find((s) => s.studentId === STUDENTS.C)!;
  const D = verified.pack.students.find((s) => s.studentId === STUDENTS.D)!;
  assert.equal((await setOfflineMark(ctx, rollCall, { matchKey: C.matchKey, status: "late" })).ok, true);
  const refused = await setOfflineMark(ctx, rollCall, { matchKey: D.matchKey, status: "present" });
  assert.deepEqual(refused, { ok: false, message: OFFLINE_ROLL_CALL_COPY.protectedEdit });
  assert.equal((await setOfflineMark(ctx, rollCall, { matchKey: C.matchKey, status: "excused" as never })).ok, false, "« Justifié » jamais saisissable");
  summary = await summarizeOfflineRollCall(ctx, rollCall);
  assert.equal(summary.late, 1);
  assert.equal(summary.notRecorded, 0);
  assert.equal(summary.rows.find((r) => r.student.studentId === STUDENTS.D)?.status, "excused");

  // Clôture explicite : lot conforme au contrat serveur (readSyncBody du Backend).
  const closed = await closeOfflineRollCall(ctx, rollCall);
  assert.ok(closed.ok);
  if (!closed.ok) return;
  assert.equal(closed.message, "Appel enregistré localement — à synchroniser.");
  const session = await getSession(ctx, rollCall.session.session_id);
  assert.equal(session.state, "closed");
  const body = JSON.parse(String(session.frozen_body));
  const validated = readSyncBody(body, body.operationId);
  assert.equal(validated.payloadDigest ?? body.payloadDigest, body.payloadDigest);
  assert.equal(body.packId, verified.pack.packId);
  assert.equal(body.scans.length, 5);
  // Aucune absence fabriquée pour un élève présent ; C pointé en retard ; D (justifié) omis.
  assert.deepEqual(body.manual, [{ studentId: STUDENTS.C, status: "late" }]);
  // Chaque preuve est vérifiée par le Backend avec le token_hash ; le support est authentifié.
  const byPublicId = new Map(Object.values(CARDS).map((c) => [c.publicId, c]));
  for (const scanEntry of body.scans) {
    const c = byPublicId.get(scanEntry.publicId)!;
    const input = { contractVersion: "rc-offline-1", schoolId: SCHOOL, actorUserId: TEACHER, classId: CLASS, date: DATE, mode: "teacher", sessionId: body.sessionId, packId: body.packId, scanId: scanEntry.scanId, publicId: scanEntry.publicId };
    assert.equal(verifyProof(cardKeyFromTokenHash(c.tokenHash), { ...input, medium: scanEntry.medium }, scanEntry.proof), true);
    const other = scanEntry.medium === "nfc" ? "qr" : "nfc";
    assert.equal(verifyProof(cardKeyFromTokenHash(c.tokenHash), { ...input, medium: other }, scanEntry.proof), false, "preuve NFC non transformable en QR (et inversement)");
  }
  // Rien ne transite en clair : ni secret, ni K dans la base ni dans le corps figé.
  const raw = JSON.stringify(body);
  for (const c of Object.values(CARDS)) assert.equal(raw.includes(c.secret) || raw.includes(c.tokenHash), false);
  // Après clôture : plus aucune lecture acceptée.
  assert.equal((await scan(CARDS.B)).kind, "refused");
});

test("NFC-APPEL-PARTIEL-01 : appel partiel, élèves non scannés laissés non pointés (jamais absents)", async () => {
  const { ctx } = await setup("partial");
  const pack = await prepareOfflinePack(ctx, { ...prepareInput, download: async () => packResponse() });
  const rollCall = await openOfflineRollCall(ctx, { classId: CLASS, date: DATE, pack: (pack as Extract<OfflinePackState, { status: "verified" }>).verified });
  await processCard(ctx, rollCall, { token: token(CARDS.A1), medium: "nfc", actorUserId: TEACHER });
  const summary = await summarizeOfflineRollCall(ctx, rollCall);
  assert.deepEqual(
    { total: summary.total, present: summary.present, late: summary.late, absent: summary.absent, excused: summary.excused, notRecorded: summary.notRecorded },
    { total: 4, present: 1, late: 0, absent: 0, excused: 1, notRecorded: 2 },
    "B et C non pointés ; D déjà justifié",
  );
  // NFC-STATUT-PRESENCE-01 : affichés « Absent » provisoire, jamais écrits sans confirmation.
  assert.match(OFFLINE_ROLL_CALL_COPY.closeBody(summary), /2 élève\(s\) affiché\(s\) « Absent » de façon provisoire/);
  assert.doesNotMatch(OFFLINE_ROLL_CALL_COPY.closeBody(summary), /[1-9]\d* absent\(s\) saisi/, "aucun absent annoncé sans saisie");
  assert.ok((await closeOfflineRollCall(ctx, rollCall)).ok);
  const body = JSON.parse(String((await getSession(ctx, rollCall.session.session_id)).frozen_body));
  assert.equal(body.complete, false);
  assert.deepEqual(body.manual, [], "aucune absence par défaut dans le lot");
  assert.equal(body.scans.length, 1);
  readSyncBody(body, body.operationId);
});

test("NFC-APPEL-PARTIEL-01 : absence explicite conservée ; appel vide refusé sans rien inventer", async () => {
  const { ctx } = await setup("explicit");
  const pack = await prepareOfflinePack(ctx, { ...prepareInput, download: async () => packResponse() });
  const verified = (pack as Extract<OfflinePackState, { status: "verified" }>).verified;
  const rollCall = await openOfflineRollCall(ctx, { classId: CLASS, date: DATE, pack: verified });
  const empty = await closeOfflineRollCall(ctx, rollCall);
  assert.deepEqual(empty, { ok: false, message: OFFLINE_ROLL_CALL_COPY.emptyRollCall }, "zéro carte, zéro statut : clôture refusée");
  assert.equal((await getSession(ctx, rollCall.session.session_id)).state, "draft", "le brouillon reste ouvert");
  const B = verified.pack.students.find((s) => s.studentId === STUDENTS.B)!;
  assert.equal((await setOfflineMark(ctx, rollCall, { matchKey: B.matchKey, status: "absent" })).ok, true);
  const summary = await summarizeOfflineRollCall(ctx, rollCall);
  assert.deepEqual([summary.present, summary.absent, summary.notRecorded], [0, 1, 2]);
  assert.ok((await closeOfflineRollCall(ctx, rollCall)).ok, "une absence explicite suffit à clôturer");
  const body = JSON.parse(String((await getSession(ctx, rollCall.session.session_id)).frozen_body));
  assert.deepEqual(body.manual, [{ studentId: STUDENTS.B, status: "absent" }], "seule l'absence saisie est transmise");
  assert.equal(body.complete, false);
  readSyncBody(body, body.operationId);
});

test("mode avion : pack préchargé utilisé ; sans pack, mode dégradé sans aucune carte « reconnue »", async () => {
  const { ctx, platform } = await setup("airplane", "2026-11-08T17:00:00Z");
  // Préchargement la veille (réseau disponible), puis matin sans réseau.
  const preload = await prepareOfflinePack(ctx, { ...prepareInput, download: async () => packResponse() });
  assert.equal(preload.status, "degraded", "pas encore valide la veille : stocké mais pas utilisable");
  platform.now.ms = Date.parse("2026-11-09T07:30:00Z");
  const offline = await prepareOfflinePack(ctx, { ...prepareInput, download: async () => { throw new Error("Network request failed"); } });
  assert.equal(offline.status, "verified", "pack préchargé utilisé hors connexion");

  const { ctx: emptyCtx } = await setup("nopack");
  const none = await prepareOfflinePack(emptyCtx, { ...prepareInput });
  assert.deepEqual(none, { status: "degraded", reason: "RC_PACK_NONE", downloadFailed: false });
  const rollCall = await openOfflineRollCall(emptyCtx, { classId: CLASS, date: DATE, pack: null });
  const outcome = await processCard(emptyCtx, rollCall, { token: token(CARDS.A1), medium: "qr", actorUserId: TEACHER });
  assert.equal(outcome.kind, "unknown");
  const summary = await summarizeOfflineRollCall(emptyCtx, rollCall);
  assert.equal(summary.total, null);
  assert.equal(summary.degraded, true);
  assert.equal(summary.unknownScans, 1);
  assert.ok((await closeOfflineRollCall(emptyCtx, rollCall)).ok);
  const body = JSON.parse(String((await getSession(emptyCtx, rollCall.session.session_id)).frozen_body));
  assert.equal(body.packId, null);
  assert.deepEqual(body.manual, [], "aucune absence inventée sans liste");
  readSyncBody(body, body.operationId);
});

test("pack falsifié ou expiré : refusé, mode dégradé ; jamais de pack fictif", async () => {
  const { ctx } = await setup("forged");
  const good = packResponse();
  const forged = JSON.parse(good.text);
  forged.pack.students[0].lastName = "Autre";
  const out = await prepareOfflinePack(ctx, { ...prepareInput, download: async () => ({ text: JSON.stringify(forged), dateHeader: null }) });
  assert.deepEqual(out, { status: "degraded", reason: "RC_PACK_SIGNATURE_INVALID", downloadFailed: false });
  const { ctx: lateCtx } = await setup("expired", "2026-11-10T07:30:00Z");
  const expired = await prepareOfflinePack(lateCtx, { ...prepareInput, download: async () => packResponse() });
  assert.equal(expired.status, "degraded");
  // Trousseau de production vide (état réel de cette version) : aucun pack accepté.
  const { ctx: prodCtx } = await setup("emptyring");
  const empty = await prepareOfflinePack(prodCtx, { ...prepareInput, keyring: validatePackKeyring("production", []), download: async () => packResponse() });
  // La liste de révocation, signée par la même clé inconnue, est refusée la première.
  assert.deepEqual(empty, { status: "degraded", reason: "RC_PACK_REVOCATIONS_INVALID", downloadFailed: false });
});

test("fermeture puis réouverture : le brouillon et ses lectures sont repris, aucune perte après COMMIT", async () => {
  const { platform, manager, ctx } = await setup("resume");
  const pack = await prepareOfflinePack(ctx, { ...prepareInput, download: async () => packResponse() });
  const verified = (pack as Extract<OfflinePackState, { status: "verified" }>).verified;
  const first = await openOfflineRollCall(ctx, { classId: CLASS, date: DATE, pack: verified });
  await processCard(ctx, first, { token: token(CARDS.A1), medium: "nfc", actorUserId: TEACHER });
  await processCard(ctx, first, { token: token(CARDS.STRANGER), medium: "qr", actorUserId: TEACHER });
  await manager.close();
  // Nouveau processus : réseau absent, pack relu depuis SQLCipher.
  const again = createRollCallAccountManager(platform);
  const reopened = await again.activate(IDENTITY);
  const ctx2 = (reopened as { account: RcActiveAccount }).account.ctx;
  const offline = await prepareOfflinePack(ctx2, { ...prepareInput });
  assert.equal(offline.status, "verified");
  const resumed = await openOfflineRollCall(ctx2, { classId: CLASS, date: DATE, pack: (offline as Extract<OfflinePackState, { status: "verified" }>).verified });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.session.session_id, first.session.session_id);
  assert.ok(resumed.pack, "même pack que le brouillon");
  const summary = await summarizeOfflineRollCall(ctx2, resumed);
  assert.equal(summary.present, 1);
  assert.equal(summary.unknownScans, 1);
  assert.equal((await processCard(ctx2, resumed, { token: token(CARDS.A1), medium: "nfc", actorUserId: TEACHER })).kind, "duplicate");
  assert.equal((await listSessions(ctx2)).length, 1, "aucune seconde session pour la même classe et le même jour");
});

test("brouillon repris : toujours SON pack d'origine, jamais celui d'une autre émission", async () => {
  const { ctx, platform } = await setup("otherpack");
  const v1 = await prepareOfflinePack(ctx, { ...prepareInput, download: async () => packResponse() });
  const v1Pack = (v1 as Extract<OfflinePackState, { status: "verified" }>).verified;
  const first = await openOfflineRollCall(ctx, { classId: CLASS, date: DATE, pack: v1Pack });
  await processCard(ctx, first, { token: token(CARDS.A1), medium: "nfc", actorUserId: TEACHER });
  platform.now.ms += 60_000; // nouvelle émission plus récente
  const v2 = await prepareOfflinePack(ctx, { ...prepareInput, download: async () => packResponse({ packId: "99999999-9999-4999-8999-999999999990" }) });
  const v2Pack = (v2 as Extract<OfflinePackState, { status: "verified" }>).verified;
  assert.equal(v2Pack.pack.packId, "99999999-9999-4999-8999-999999999990", "le pack le plus récent est proposé");
  const loadPack = packLoader(ctx, prepareInput);
  const resumed = await openOfflineRollCall(ctx, { classId: CLASS, date: DATE, pack: v2Pack, loadPack });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.pack?.pack.packId, v1Pack.pack.packId, "le brouillon garde son pack d'origine");
  assert.equal((await processCard(ctx, resumed, { token: token(CARDS.B), medium: "nfc", actorUserId: TEACHER })).kind, "recorded");
  // Sans rechargement possible : mode dégradé, jamais le pack d'une autre émission.
  const withoutLoader = await openOfflineRollCall(ctx, { classId: CLASS, date: DATE, pack: v2Pack });
  assert.equal(withoutLoader.pack, null);
});

test("pack préchargé la veille : conservé, jamais supprimé ni utilisé avant notBefore", async () => {
  const { ctx, platform } = await setup("preload", "2026-11-08T17:00:00Z");
  const evening = await prepareOfflinePack(ctx, { ...prepareInput, download: async () => packResponse() });
  assert.deepEqual(evening, { status: "degraded", reason: "RC_PACK_NOT_YET_VALID", downloadFailed: false });
  platform.now.ms = Date.parse("2026-11-08T22:59:59Z");
  assert.equal((await prepareOfflinePack(ctx, { ...prepareInput })).status, "degraded", "toujours pas utilisable");
  platform.now.ms = Date.parse("2026-11-08T23:00:00Z");
  assert.equal((await prepareOfflinePack(ctx, { ...prepareInput })).status, "verified", "utilisable dès notBefore, sans réseau");
});

test("échec d'écriture (COMMIT refusé) : la carte n'est PAS comptée, message explicite", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-pr3-commit-"));
  const base = createTestPlatform({ dir, now: { ms: Date.parse("2026-11-09T07:30:00Z") } });
  let fail = false;
  const flaky = {
    ...base,
    openDatabase: async (name: string, options?: { useNewConnection?: boolean }) => {
      const db = await base.openDatabase(name, options);
      return { ...db, async execAsync(sql: string) { if (fail && /^\s*COMMIT\s*$/i.test(sql)) { fail = false; throw new Error("SQLITE_FULL: database or disk is full"); } return db.execAsync(sql); } };
    },
  };
  const manager = createRollCallAccountManager(flaky);
  const ctx = ((await manager.activate(IDENTITY)) as { account: RcActiveAccount }).account.ctx;
  const pack = await prepareOfflinePack(ctx, { ...prepareInput, download: async () => packResponse() });
  const rollCall = await openOfflineRollCall(ctx, { classId: CLASS, date: DATE, pack: (pack as Extract<OfflinePackState, { status: "verified" }>).verified });
  fail = true;
  const outcome = await processCard(ctx, rollCall, { token: token(CARDS.A1), medium: "nfc", actorUserId: TEACHER });
  assert.deepEqual({ kind: outcome.kind, message: "message" in outcome ? outcome.message : "" }, { kind: "refused", message: OFFLINE_ROLL_CALL_COPY.storageFull });
  assert.equal((await summarizeOfflineRollCall(ctx, rollCall)).scans, 0);
  assert.equal((await processCard(ctx, rollCall, { token: token(CARDS.A1), medium: "nfc", actorUserId: TEACHER })).kind, "recorded", "relecture suivante enregistrée");
});
