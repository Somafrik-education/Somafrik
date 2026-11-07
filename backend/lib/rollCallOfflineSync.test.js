"use strict";

/**
 * NFC-PRES-LOCAL-PR1c — validation stricte du lot, marques voulues, support et fenêtre de
 * synchronisation (fonctions pures). Décisions transactionnelles : rollCallOfflineSync.http.pg.test.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  OFFLINE_SYNC_ERROR,
  MAX_SCANS,
  readSyncBody,
  assertSyncWindow,
  cardSupportsMedium,
  buildWanted,
} = require("./rollCallOfflineSync");
const { computePayloadDigest } = require("./rollCallOfflineProof");

const vectors = require(path.join(__dirname, "fixtures", "rollCallOfflineVectors.json"));
const base = vectors.testSyncBodyWithoutDigest;
const withDigest = (body) => ({ ...body, payloadDigest: computePayloadDigest(body) });
const valid = () => withDigest(structuredClone(base));
const uuid = (n, block = "8000") => `00000000-0000-4000-${block}-${String(n).padStart(12, "0")}`;
const at = (iso) => Date.parse(iso);

function rejects(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code, error.message);
    assert.equal(error.statusCode, 400);
    return true;
  });
}

test("lot de test V-11 accepté ; digest recalculé par le serveur", () => {
  const body = { ...structuredClone(base), payloadDigest: vectors.expected["V-11_payloadDigest"] };
  const batch = readSyncBody(body, body.operationId);
  assert.equal(batch.payloadDigest, vectors.expected["V-11_payloadDigest"]);
  assert.ok(Object.isFrozen(batch));
});

test("digest falsifié, support modifié après coup ou corps altéré : ROLL_CALL_DIGEST_MISMATCH", () => {
  const body = valid();
  rejects(() => readSyncBody({ ...body, payloadDigest: "0".repeat(64) }, body.operationId), OFFLINE_SYNC_ERROR.DIGEST_MISMATCH);
  rejects(() => readSyncBody({ ...body, scans: body.scans.map((s) => ({ ...s, medium: "qr" })) }, body.operationId), OFFLINE_SYNC_ERROR.DIGEST_MISMATCH);
  rejects(() => readSyncBody({ ...body, revision: 2 }, body.operationId), OFFLINE_SYNC_ERROR.DIGEST_MISMATCH);
  // V-12 : même lot, support qr, digest de V-11 → refus.
  assert.notEqual(vectors.expected["V-11_payloadDigest"], vectors.expected["V-12_payloadDigest_medium_qr"]);
});

test("Idempotency-Key obligatoire et égale à operationId", () => {
  const body = valid();
  for (const key of [undefined, "", body.sessionId, body.operationId.replace(/8$/, "9"), ` ${body.operationId}`]) {
    rejects(() => readSyncBody(body, key), OFFLINE_SYNC_ERROR.OPERATION_KEY_REQUIRED);
  }
});

test("validation stricte : champs exacts, valeurs du contrat, aucune normalisation", () => {
  const body = () => structuredClone(base);
  const cases = {
    "champ supplémentaire": { ...body(), extra: 1 },
    "champ manquant": (({ packId, ...rest }) => rest)(body()),
    "version": { ...body(), contractVersion: "rc-offline-2" },
    "mode direction": { ...body(), mode: "direction" },
    "complete false": { ...body(), complete: false },
    "complete absent → chaîne": { ...body(), complete: "true" },
    "révision 0": { ...body(), revision: 0 },
    "révision flottante": { ...body(), revision: 1.5 },
    "UUID majuscule": { ...body(), classId: "0000000A-0000-4000-8000-000000000003" },
    "packId vide": { ...body(), packId: "" },
    "date impossible": { ...body(), date: "2026-02-30" },
    "scan champ en plus": { ...body(), scans: [{ ...base.scans[0], recognized: true }] },
    "support NFC majuscule": { ...body(), scans: [{ ...base.scans[0], medium: "NFC" }] },
    "preuve courte": { ...body(), scans: [{ ...base.scans[0], proof: "abc" }] },
    "publicId invalide": { ...body(), scans: [{ ...base.scans[0], publicId: "x" }] },
    "scannedAt non ISO": { ...body(), scans: [{ ...base.scans[0], scannedAt: "hier" }] },
    "excused manuel": { ...body(), manual: [{ studentId: uuid(1, "9000"), status: "excused" }] },
    "statut inconnu": { ...body(), manual: [{ studentId: uuid(1, "9000"), status: "absent " }] },
    "manuel champ en plus": { ...body(), manual: [{ studentId: uuid(1, "9000"), status: "present", note: "x" }] },
    "scans non triés": { ...body(), scans: [{ ...base.scans[0], scanId: uuid(9) }, { ...base.scans[0], scanId: uuid(1) }] },
    "scanId en double": { ...body(), scans: [base.scans[0], base.scans[0]] },
    "manuel non trié": { ...body(), manual: [{ studentId: uuid(2, "9000"), status: "present" }, { studentId: uuid(1, "9000"), status: "late" }] },
    "élève en double": { ...body(), manual: [{ studentId: uuid(1, "9000"), status: "present" }, { studentId: uuid(1, "9000"), status: "late" }] },
    "trop de scans": { ...body(), scans: Array.from({ length: MAX_SCANS + 1 }, (_, i) => ({ ...base.scans[0], scanId: uuid(i + 1) })) },
    "corps tableau": [],
  };
  for (const [name, value] of Object.entries(cases)) {
    // Les types hors contrat (révision flottante…) n'ont pas de digest calculable : empreinte factice.
    let payload = value;
    if (!Array.isArray(value)) {
      try { payload = withDigest(value); } catch { payload = { ...value, payloadDigest: "0".repeat(64) }; }
    }
    rejects(() => readSyncBody(payload, payload.operationId ?? base.operationId), OFFLINE_SYNC_ERROR.INPUT_INVALID, name);
  }
  // packId null (mode dégradé) accepté.
  const degraded = withDigest({ ...body(), packId: null });
  assert.equal(readSyncBody(degraded, degraded.operationId).packId, null);
  // 300 scans exactement acceptés.
  const full = withDigest({ ...body(), scans: Array.from({ length: MAX_SCANS }, (_, i) => ({ ...base.scans[0], scanId: uuid(i + 1) })) });
  assert.equal(readSyncBody(full, full.operationId).scans.length, MAX_SCANS);
});

test("marques voulues : une par élève, scans multiples regroupés, pointage manuel prioritaire", () => {
  const scans = new Map([[uuid(2, "9000"), [uuid(20), uuid(21)]], [uuid(1, "9000"), [uuid(10)]]]);
  const manual = [{ studentId: uuid(1, "9000"), status: "late" }, { studentId: uuid(3, "9000"), status: "absent" }];
  const wanted = buildWanted(scans, manual);
  assert.deepEqual(wanted.map((w) => w.studentId), [uuid(1, "9000"), uuid(2, "9000"), uuid(3, "9000")], "trié par élève");
  assert.deepEqual(wanted[0], { studentId: uuid(1, "9000"), status: "late", source: "manual", index: 0, scanIds: [uuid(10)] });
  assert.deepEqual(wanted[1], { studentId: uuid(2, "9000"), status: "present", source: "card", scanIds: [uuid(20), uuid(21)] });
  assert.deepEqual(wanted[2], { studentId: uuid(3, "9000"), status: "absent", source: "manual", index: 1, scanIds: [] });
});

test("support déclaré cohérent avec la carte", () => {
  const card = (medium, state) => ({ medium, nfc_encoding_state: state });
  assert.equal(cardSupportsMedium(card("nfc_qr", "encoded"), "nfc"), true);
  assert.equal(cardSupportsMedium(card("nfc", "locked"), "nfc"), true);
  assert.equal(cardSupportsMedium(card("nfc_qr", null), "nfc"), false, "NFC non encodée");
  assert.equal(cardSupportsMedium(card("qr", null), "nfc"), false, "carte QR déclarée NFC");
  assert.equal(cardSupportsMedium(card("nfc", "encoded"), "qr"), false, "carte NFC seule déclarée QR");
  assert.equal(cardSupportsMedium(card("nfc_qr", null), "qr"), true);
  assert.equal(cardSupportsMedium(card("qr", null), "qr"), true);
});

test("fenêtre de synchronisation : [D 00:00 ; D+4 00:00[ dans le fuseau, journées de 23 h et 25 h", () => {
  const expired = (tz, date, iso) => assert.throws(() => assertSyncWindow(tz, date, at(iso)), (error) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, OFFLINE_SYNC_ERROR.OFFLINE_EXPIRED);
    return true;
  }, `${tz} ${date} ${iso}`);
  // Kinshasa (UTC+1) : D = 2026-11-09.
  expired("Africa/Kinshasa", "2026-11-09", "2026-11-08T22:59:59Z"); // veille 23:59:59
  assertSyncWindow("Africa/Kinshasa", "2026-11-09", at("2026-11-08T23:00:00Z")); // D 00:00
  assertSyncWindow("Africa/Kinshasa", "2026-11-09", at("2026-11-12T22:59:59Z")); // fin de J+3
  expired("Africa/Kinshasa", "2026-11-09", "2026-11-12T23:00:00Z"); // J+4 00:00
  // Paris, passage à l'heure d'été (D = 2026-03-29, journée de 23 h).
  assertSyncWindow("Europe/Paris", "2026-03-29", at("2026-03-28T23:00:00Z"));
  assertSyncWindow("Europe/Paris", "2026-03-29", at("2026-04-01T21:59:59Z"));
  expired("Europe/Paris", "2026-03-29", "2026-04-01T22:00:00Z");
  // Paris, passage à l'heure d'hiver (D = 2026-10-25, journée de 25 h).
  expired("Europe/Paris", "2026-10-25", "2026-10-24T21:59:59Z");
  assertSyncWindow("Europe/Paris", "2026-10-25", at("2026-10-24T22:00:00Z"));
  assertSyncWindow("Europe/Paris", "2026-10-25", at("2026-10-28T22:59:59Z"));
  expired("Europe/Paris", "2026-10-25", "2026-10-28T23:00:00Z");
});

test("garde R : établissement relu en base, compte actif, rôle TEACHER, jamais de rôle plateforme", async () => {
  const { guardReplayAccess } = require("./rollCallOfflineSync");
  const SCHOOL = "00000000-0000-4000-8000-000000000001";
  const OTHER = "00000000-0000-4000-8000-0000000000bb";
  const USER = "00000000-0000-4000-8000-000000000002";
  const fakeRepo = ({ roles = ["TEACHER"], userSchool = SCHOOL, status = "active", canonical = USER } = {}) => ({
    async resolveCanonicalUserIdForSchool() { return canonical; },
    async listActiveUserRoleKeysForSchool() { return roles; },
    async one(sql, params) {
      assert.match(sql, /FROM users WHERE id = \$1::uuid/);
      assert.equal(params[0], canonical);
      return userSchool === null ? null : { school_id: userSchool, status };
    },
  });
  const principal = { sub: USER, roleKeys: ["TEACHER"] };
  const scope = { schoolId: SCHOOL };
  const batch = { schoolId: SCHOOL };
  const actor = await guardReplayAccess(fakeRepo(), principal, scope, batch);
  assert.equal(actor.canonicalUserId, USER);
  const forbidden = async (repo, p = principal, s = scope, b = batch, label) => {
    await assert.rejects(() => guardReplayAccess(repo, p, s, b), (error) => {
      assert.equal(error.statusCode, 403, label);
      assert.equal(error.code, OFFLINE_SYNC_ERROR.REPLAY_FORBIDDEN, label);
      assert.equal(error.sessionState, undefined, label);
      return true;
    }, label);
  };
  await forbidden(fakeRepo(), principal, scope, { schoolId: OTHER }, "schoolId du lot ≠ établissement résolu");
  await forbidden(fakeRepo({ userSchool: OTHER }), principal, scope, batch, "rattachement relu en base différent (transfert)");
  await forbidden(fakeRepo({ userSchool: null }), principal, scope, batch, "utilisateur introuvable");
  await forbidden(fakeRepo({ status: "inactive" }), principal, scope, batch, "compte inactif");
  await forbidden(fakeRepo({ roles: [] }), principal, scope, batch, "aucun rôle actif");
  await forbidden(fakeRepo({ roles: ["PRINCIPAL"] }), principal, scope, batch, "direction sans TEACHER");
  await forbidden(fakeRepo({ roles: ["TEACHER", "SUPER_ADMIN"] }), principal, scope, batch, "rôle plateforme");
  await forbidden(fakeRepo(), { roleKeys: ["TEACHER"] }, scope, batch, "sans identité");
  // Le rôle du JWT ne compte jamais : seuls les rôles relus en base sont retenus.
  await forbidden(fakeRepo({ roles: ["PARENT"] }), { sub: USER, roleKeys: ["TEACHER"], roleKey: "TEACHER" }, scope, batch, "JWT TEACHER, base PARENT");
});
