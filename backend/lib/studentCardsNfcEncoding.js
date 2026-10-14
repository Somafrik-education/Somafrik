"use strict";

const { createHttpError } = require("./classesManagement");
const { createSchoolSettingsPgStore } = require("../db/schoolSettingsPgStore");
const { mapStudentCardFlags } = require("./schoolSettingsManagement");
const { assertStudentCardMasterEnabled } = require("./studentAccessCardsManagement");

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

// The lifecycle owns transaction, expiry, replay and replacement invariants.
function confirmStudentCardNfc(...args) {
  return require("./studentCardsNfcLifecycle").confirmStudentCardNfc(...args);
}
function retryStudentCardNfc(...args) {
  return require("./studentCardsNfcLifecycle").retryStudentCardNfc(...args);
}
module.exports = { normalizeNfcIdentity, readNfcEnabled, assertNfcEnabled, confirmStudentCardNfc, retryStudentCardNfc };
