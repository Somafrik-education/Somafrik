"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeNfcIdentity, readNfcEnabled, confirmStudentCardNfc, retryStudentCardNfc } = require("./studentCardsNfcEncoding");
const { generateCardSecrets, issueStudentCard, scanStudentCard } = require("./studentAccessCardsManagement");
const { RbacService } = require("../services/rbacService");
const UID = "04112233445566";
const scope = { schoolId: "school-a", loginCode: "CD-IN-26-001" };
function fixture() {
  const generated = generateCardSecrets();
  const card = { id: "card-a", school_id: scope.schoolId, student_id: "student-a", public_id: generated.publicId, token_hash: generated.tokenHash, medium: "nfc", status: "active", nfc_uid: UID, nfc_tag_type: "NTAG213", nfc_encoding_state: "pending" };
  const audits = [];
  let writes = 0;
  const settings = { student_card_enabled: true, student_card_nfc_enabled: true };
  const repo = {
    getSchoolSettingsStore: () => ({ getSettings: async () => settings }),
    getStudentAccessCardsStore: () => ({
      getById: async (school, id) => school === card.school_id && id === card.id ? { ...card } : null,
      rotatePendingNfc: async (_s, _id, _u, _t, oldHash, newHash) => { assert.equal(card.token_hash, oldHash); card.token_hash = newHash; writes++; return { ...card }; },
      confirmNfc: async (_school, _id, _uid, _type, locked) => { writes++; card.nfc_encoding_state = locked || card.nfc_encoding_state === "locked" ? "locked" : "encoded"; return { ...card }; },
      findByPublicIdInSchool: async () => card,
    }),
    recordAudit: async (audit) => audits.push(audit),
  };
  return { repo, card, generated, settings, audits, writes: () => writes };
}
function payload(f, overrides = {}) { return { uid: UID, tagType: "NTAG213", cardToken: f.generated.cardToken, locked: false, ...overrides }; }

test("NFC UID normalization, only NTAG213/216", () => {
  assert.deepEqual(normalizeNfcIdentity({ uid: "04:11:22:33:44:55:66", tagType: "NTAG216" }), { uid: UID, tagType: "NTAG216" });
  for (const value of [null, {}, { uid: "11223344", tagType: "NTAG213" }, { uid: UID, tagType: "NTAG215" }, { uid: UID, tagType: "Navigo" }]) assert.throws(() => normalizeNfcIdentity(value), { code: "STUDENT_CARD_NFC_INVALID" });
});
test("NFC flags fail closed", async () => {
  const f = fixture();
  assert.equal(await readNfcEnabled(f.repo, scope.schoolId), true);
  for (const value of [false, "true", null, undefined]) {
    f.settings.student_card_nfc_enabled = value;
    assert.equal(await readNfcEnabled(f.repo, scope.schoolId), false);
    await assert.rejects(confirmStudentCardNfc(f.repo, f.card.id, payload(f), {}, {}, scope), { code: "STUDENT_CARD_NFC_DISABLED" });
  }
});
test("Confirm pending then lock; capability/UID not leaked in audit/list", async () => {
  const f = fixture();
  const encoded = await confirmStudentCardNfc(f.repo, f.card.id, payload(f), {}, {}, scope);
  assert.equal(encoded.nfc.state, "encoded");
  assert.equal(encoded.cardToken, undefined);
  assert.equal(encoded.token_hash, undefined);
  await confirmStudentCardNfc(f.repo, f.card.id, payload(f, { locked: true }), {}, {}, scope);
  await confirmStudentCardNfc(f.repo, f.card.id, payload(f), {}, {}, scope);
  assert.equal(f.card.nfc_encoding_state, "locked");
  const audit = JSON.stringify(f.audits);
  assert.ok(!audit.includes(f.generated.secret)); assert.ok(!audit.includes(UID));
});
test("Confirmation rejects cross-tenant, mismatched UID/type/secret and inactive cards without writes", async () => {
  for (const mutate of [
    (f) => [{ ...scope, schoolId: "school-b" }, payload(f)],
    (f) => [scope, payload(f, { uid: "04778899001122" })],
    (f) => [scope, payload(f, { tagType: "NTAG216" })],
    (f) => [scope, payload(f, { cardToken: generateCardSecrets().cardToken })],
    (f) => { f.card.status = "revoked"; return [scope, payload(f)]; },
  ]) {
    const f = fixture(); const [target, body] = mutate(f);
    await assert.rejects(confirmStudentCardNfc(f.repo, f.card.id, body, {}, {}, target));
    assert.equal(f.writes(), 0);
  }
});
test("Pending encoding cannot resolve or write attendance", async () => {
  const f = fixture();
  await assert.rejects(scanStudentCard(f.repo, { cardToken: f.generated.cardToken, attendance: { status: "present" } }, scope), { code: "STUDENT_CARD_INVALID_STATE" });
});
test("Emission reserves UID and preserves pending; duplicate UID is a controlled conflict", async () => {
  const f = fixture(); let inserted;
  f.repo.getStudentAccessCardsStore = () => ({
    findStudentInSchool: async () => ({ id: "student-a" }), findActive: async () => null,
    insert: async (row) => { inserted = row; return { ...row, id: "card-a" }; },
  });
  const response = await issueStudentCard(f.repo, { studentId: "student-a", medium: "nfc", nfc: { uid: UID, tagType: "NTAG216" } }, {}, {}, scope);
  assert.equal(inserted.nfc_encoding_state, "pending"); assert.equal(response.nfc.tagType, "NTAG216");
  f.repo.getStudentAccessCardsStore = () => ({ findStudentInSchool: async () => ({ id: "student-a" }), findActive: async () => null, insert: async () => { throw Object.assign(new Error("duplicate"), { code: "23505", constraint: "student_access_cards_nfc_uid_unique" }); } });
  await assert.rejects(issueStudentCard(f.repo, { studentId: "student-a", medium: "nfc", nfc: { uid: UID, tagType: "NTAG213" } }, {}, {}, scope), { statusCode: 409, code: "STUDENT_CARD_NFC_UID_EXISTS" });
});
test("Confirmation RBAC: school staff UPDATE only; platform denied", () => {
  const rbac = new RbacService(); const route = "POST /api/student-cards/:id/nfc-confirm";
  assert.equal(rbac.canAccess({ role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], permissions: ["Élèves:UPDATE"], schoolCode: "CD-IN-26-001" }, route), true);
  for (const role of ["SUPER_ADMIN", "COUNTRY_ADMIN"]) assert.equal(rbac.canAccess({ roleKeys: [role], permissions: ["ALL_PRIVILEGES", "Élèves:UPDATE"] }, route), false);
  assert.equal(rbac.canAccess({ role: "Enseignant", permissions: ["Élèves:READ"] }, route), false);
});

test("Retry a pending reservation rotates the secret, keeps UID/publicId, and denies encoded/locked/revoked", async () => {
  const f = fixture();
  const next = await retryStudentCardNfc(f.repo, f.card.id, { uid: UID, tagType: "NTAG213" }, {}, {}, scope);
  assert.equal(next.publicId, f.generated.publicId); assert.equal(next.nfc.uid, UID);
  assert.notEqual(next.cardToken, f.generated.cardToken); assert.equal(next.reissued, true);
  await assert.rejects(confirmStudentCardNfc(f.repo, f.card.id, payload(f), {}, {}, scope), { code: "STUDENT_CARD_NOT_FOUND" });
  await confirmStudentCardNfc(f.repo, f.card.id, payload(f, { cardToken: next.cardToken }), {}, {}, scope);
  await assert.rejects(retryStudentCardNfc(f.repo, f.card.id, { uid: UID, tagType: "NTAG213" }, {}, {}, scope));
  assert.ok(!JSON.stringify(f.audits).includes(next.cardToken));
});
