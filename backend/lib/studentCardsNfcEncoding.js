"use strict";

const { createHttpError } = require("./classesManagement");
const { createSchoolSettingsPgStore } = require("../db/schoolSettingsPgStore");
const { mapStudentCardFlags } = require("./schoolSettingsManagement");
const { createStudentAccessCardsPgStore } = require("../db/studentAccessCardsPgStore");
const { parseCardToken, hashCardSecret, tokenHashesMatch } = require("./studentCardCapability");
const { assertStudentCardMasterEnabled, mapCardListItem, mapIssuedCard, generateCardSecrets } = require("./studentAccessCardsManagement");

function invalid() {
  return createHttpError(400, "UID ou modèle de carte NFC invalide.", "STUDENT_CARD_NFC_INVALID");
}
function normalizeNfcIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const uid = typeof value.uid === "string" ? value.uid.replace(/[: -]/g, "").toUpperCase() : "";
  const tagType = value.tagType;
  if (!/^04[0-9A-F]{12}$/.test(uid) || !["NTAG213", "NTAG216"].includes(tagType)) throw invalid();
  return { uid, tagType };
}
async function readNfcEnabled(repo, schoolId) {
  const settings = typeof repo.getSchoolSettingsStore === "function" ? repo.getSchoolSettingsStore() : createSchoolSettingsPgStore(repo);
  const flags = mapStudentCardFlags(await settings.getSettings(schoolId));
  return flags.studentCardEnabled === true && flags.studentCardNfcEnabled === true;
}
async function assertNfcEnabled(repo, schoolId) {
  await assertStudentCardMasterEnabled(repo, schoolId);
  if (!(await readNfcEnabled(repo, schoolId))) {
    throw createHttpError(404, "L’encodage NFC est désactivé pour cet établissement.", "STUDENT_CARD_NFC_DISABLED");
  }
}

// Client observations, not a cryptographic attestation of the physical chip.
// The UID never replaces the revocable server capability.
async function confirmStudentCardNfc(repo, cardId, payload, principal, auditMeta, schoolScope) {
  const schoolId = String(schoolScope?.schoolId || "").trim();
  if (!schoolId) throw createHttpError(403, "Établissement hors périmètre.", "STUDENT_CARD_TENANT_DENIED");
  await assertNfcEnabled(repo, schoolId);
  const identity = normalizeNfcIdentity(payload);
  if (typeof payload.locked !== "boolean") throw invalid();
  const parsed = parseCardToken(payload.cardToken);
  const store = typeof repo.getStudentAccessCardsStore === "function" ? repo.getStudentAccessCardsStore() : createStudentAccessCardsPgStore(repo);
  const card = await store.getById(schoolId, cardId);
  if (!card || card.public_id !== parsed.publicId || !tokenHashesMatch(hashCardSecret(parsed.secret), card.token_hash)) {
    throw createHttpError(404, "Carte introuvable.", "STUDENT_CARD_NOT_FOUND");
  }
  if (card.status !== "active" || card.nfc_uid !== identity.uid || card.nfc_tag_type !== identity.tagType) {
    throw createHttpError(409, "La carte ne correspond pas à cette affectation.", "STUDENT_CARD_NFC_MISMATCH");
  }
  const updated = await store.confirmNfc(schoolId, cardId, identity.uid, identity.tagType, payload.locked, card.token_hash);
  if (!updated) throw createHttpError(409, "Affectation modifiée. Relisez la liste des cartes.", "STUDENT_CARD_INVALID_STATE");
  if (typeof repo.recordAudit === "function") {
    await repo.recordAudit({
      schoolCode: schoolScope.loginCode,
      userId: principal?.sub || principal?.id,
      action: payload.locked ? "student_card_nfc_locked" : "student_card_nfc_encoded",
      entityType: "student_access_card", entityId: updated.id,
      oldValue: { state: card.nfc_encoding_state },
      newValue: { state: updated.nfc_encoding_state, tagType: identity.tagType },
      ipAddress: auditMeta?.ipAddress, userAgent: auditMeta?.userAgent,
    }, typeof repo.query === "function" ? repo : null);
  }
  return mapCardListItem(updated);
}
async function retryStudentCardNfc(repo, cardId, payload, principal, auditMeta, schoolScope) {
  const schoolId = String(schoolScope?.schoolId || "").trim();
  if (!schoolId) throw createHttpError(403, "Établissement hors périmètre.", "STUDENT_CARD_TENANT_DENIED");
  await assertNfcEnabled(repo, schoolId);
  const identity = normalizeNfcIdentity(payload);
  const store = typeof repo.getStudentAccessCardsStore === "function" ? repo.getStudentAccessCardsStore() : createStudentAccessCardsPgStore(repo);
  const card = await store.getById(schoolId, cardId);
  if (!card) throw createHttpError(404, "Carte introuvable.", "STUDENT_CARD_NOT_FOUND");
  if (card.status !== "active" || card.nfc_encoding_state !== "pending" || card.nfc_uid !== identity.uid || card.nfc_tag_type !== identity.tagType) {
    throw createHttpError(409, "Seule une affectation NFC en attente peut être réencodée.", "STUDENT_CARD_NFC_MISMATCH");
  }
  const generated = generateCardSecrets();
  const updated = await store.rotatePendingNfc(schoolId, card.id, identity.uid, identity.tagType, card.token_hash, generated.tokenHash);
  if (!updated) throw createHttpError(409, "Affectation modifiée. Relisez la carte.", "STUDENT_CARD_INVALID_STATE");
  if (typeof repo.recordAudit === "function") await repo.recordAudit({
    schoolCode: schoolScope.loginCode, userId: principal?.sub || principal?.id,
    action: "student_card_nfc_encoding_retried", entityType: "student_access_card", entityId: card.id,
    newValue: { state: "pending", tagType: identity.tagType },
    ipAddress: auditMeta?.ipAddress, userAgent: auditMeta?.userAgent,
  }, typeof repo.query === "function" ? repo : null);
  return { ...mapIssuedCard(updated, `${card.public_id}.${generated.secret}`), reissued: true };
}
module.exports = { normalizeNfcIdentity, readNfcEnabled, assertNfcEnabled, confirmStudentCardNfc, retryStudentCardNfc };
