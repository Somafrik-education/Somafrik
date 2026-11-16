"use strict";

/**
 * GO-PROD-G6-02 / #921 — verrou plateforme du NFC carte élève non homologué.
 * En production, aucun établissement ne peut activer ni utiliser le NFC tant que
 * SOMAFRIK_STUDENT_CARD_NFC_ALLOWED=true n'est pas posé. QR et autres flags inchangés.
 * Couvre : lecture (valeur déjà true), écriture (administrateur d'établissement),
 * capacités HTTP, capacité runtime (appel hors connexion), encodage NFC refusé.
 */

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  STUDENT_CARD_NFC_NOT_HOMOLOGATED,
  isStudentCardNfcPlatformAllowed,
  applyStudentCardNfcReleaseGate,
  isStudentCardNfcActivationBlocked,
} = require("./studentCardNfcReleaseGate");
const {
  mapStudentCardFlags,
  mapSettingsRow,
  isStudentCardCapabilityEnabled,
  parseSettingsPatch,
  assertSchoolSettingsWrite,
  SCHOOL_SETTINGS_ERROR,
} = require("./schoolSettingsManagement");
const { projectStudentCardCapabilitiesHttp } = require("./studentCardCapabilities");
const { assertNfcEnabled, readNfcEnabled } = require("./studentCardsNfcEncoding");

const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  SOMAFRIK_STUDENT_CARD_NFC_ALLOWED: process.env.SOMAFRIK_STUDENT_CARD_NFC_ALLOWED,
};

function setEnv(nodeEnv, allowed) {
  process.env.NODE_ENV = nodeEnv;
  if (allowed === undefined) delete process.env.SOMAFRIK_STUDENT_CARD_NFC_ALLOWED;
  else process.env.SOMAFRIK_STUDENT_CARD_NFC_ALLOWED = allowed;
}

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const SCHOOL_ID = "11111111-1111-4111-8111-111111111111";

/** Établissement qui avait DÉJÀ activé toutes les capacités carte, NFC compris. */
const ALREADY_ACTIVE_ROW = Object.freeze({
  school_id: SCHOOL_ID,
  student_card_enabled: true,
  student_card_qr_enabled: true,
  student_card_nfc_enabled: true,
  student_card_attendance_enabled: true,
  student_card_finance_check_enabled: true,
  student_card_offline_roll_call_enabled: true,
});

function repoWithSettings(row) {
  return { getSchoolSettingsStore: () => ({ getSettings: async () => ({ ...row }) }) };
}

const SCHOOL_ADMIN = Object.freeze({
  id: "admin-ecole-test",
  role: "school_admin",
  schoolId: SCHOOL_ID,
  permissions: ["Paramètres Établissement:UPDATE"],
});

function isNfcNotHomologated(error) {
  return (error.status === 409 || error.statusCode === 409)
    && error.code === SCHOOL_SETTINGS_ERROR.STUDENT_CARD_NFC_NOT_HOMOLOGATED;
}

describe("isStudentCardNfcPlatformAllowed", () => {
  it("production sans variable : refusé (fail-closed)", () => {
    assert.equal(isStudentCardNfcPlatformAllowed({ NODE_ENV: "production" }), false);
  });
  it("production : seule la valeur true (insensible à la casse et aux espaces) autorise", () => {
    for (const [value, expected] of [["", false], ["1", false], ["yes", false], ["false", false], ["TRUE ", true], ["true", true]]) {
      assert.equal(
        isStudentCardNfcPlatformAllowed({ NODE_ENV: "production", SOMAFRIK_STUDENT_CARD_NFC_ALLOWED: value }),
        expected,
        `valeur ${JSON.stringify(value)}`,
      );
    }
  });
  it("hors production : comportement inchangé", () => {
    assert.equal(isStudentCardNfcPlatformAllowed({ NODE_ENV: "test" }), true);
    assert.equal(isStudentCardNfcPlatformAllowed({}), true);
  });
  it("helpers purs : lecture neutralisée et écriture bloquée en production", () => {
    const prod = { NODE_ENV: "production" };
    assert.equal(applyStudentCardNfcReleaseGate({ studentCardNfcEnabled: true, studentCardQrEnabled: true }, prod).studentCardNfcEnabled, false);
    assert.equal(isStudentCardNfcActivationBlocked(true, prod), true);
    assert.equal(isStudentCardNfcActivationBlocked(false, prod), false);
    assert.equal(isStudentCardNfcActivationBlocked(true, { NODE_ENV: "test" }), false);
    assert.equal(STUDENT_CARD_NFC_NOT_HOMOLOGATED, SCHOOL_SETTINGS_ERROR.STUDENT_CARD_NFC_NOT_HOMOLOGATED);
  });
});

describe("production sans autorisation : établissement ayant DÉJÀ activé le NFC", () => {
  it("lecture des flags : NFC false, toutes les autres capacités conservées", () => {
    setEnv("production", undefined);
    const flags = mapStudentCardFlags(ALREADY_ACTIVE_ROW);
    assert.equal(flags.studentCardNfcEnabled, false);
    assert.equal(flags.studentCardEnabled, true);
    assert.equal(flags.studentCardQrEnabled, true);
    assert.equal(flags.studentCardAttendanceEnabled, true);
    assert.equal(flags.studentCardFinanceCheckEnabled, true);
    assert.equal(flags.studentCardOfflineRollCallEnabled, true);
  });
  it("capacités HTTP (Web / Mobile) : NFC false, QR true", () => {
    setEnv("production", undefined);
    const http = projectStudentCardCapabilitiesHttp(ALREADY_ACTIVE_ROW);
    assert.equal(http.studentCardNfcEnabled, false);
    assert.equal(http.studentCardQrEnabled, true);
  });
  it("capacité runtime (pack et synchronisation d'appel hors connexion) : NFC false, QR et hors connexion true", () => {
    setEnv("production", undefined);
    const settings = mapSettingsRow(ALREADY_ACTIVE_ROW);
    assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardNfcEnabled"), false);
    assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardQrEnabled"), true);
    assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardOfflineRollCallEnabled"), true);
  });
  it("encodage NFC (réservation, confirmation, diagnostic) refusé : 404 STUDENT_CARD_NFC_DISABLED", async () => {
    setEnv("production", undefined);
    const repo = repoWithSettings(ALREADY_ACTIVE_ROW);
    assert.equal(await readNfcEnabled(repo, SCHOOL_ID), false);
    await assert.rejects(
      () => assertNfcEnabled(repo, SCHOOL_ID),
      (error) => (error.status === 404 || error.statusCode === 404) && error.code === "STUDENT_CARD_NFC_DISABLED",
    );
  });
  it("avec SOMAFRIK_STUDENT_CARD_NFC_ALLOWED=true : encodage de nouveau possible (clé explicite)", async () => {
    setEnv("production", "true");
    const repo = repoWithSettings(ALREADY_ACTIVE_ROW);
    assert.equal(await readNfcEnabled(repo, SCHOOL_ID), true);
    await assertNfcEnabled(repo, SCHOOL_ID);
  });
});

describe("production sans autorisation : activation par un administrateur d'établissement", () => {
  it("l'administrateur a bien le droit d'écrire les paramètres (RBAC inchangé)", () => {
    setEnv("production", undefined);
    assert.doesNotThrow(() => assertSchoolSettingsWrite(SCHOOL_ADMIN));
  });
  it("mais activer le NFC est refusé en 409 STUDENT_CARD_NFC_NOT_HOMOLOGATED", () => {
    setEnv("production", undefined);
    assert.throws(() => parseSettingsPatch({ studentCardNfcEnabled: true }), isNfcNotHomologated);
    assert.throws(
      () => parseSettingsPatch({ studentCardEnabled: true, studentCardQrEnabled: true, studentCardNfcEnabled: true }),
      isNfcNotHomologated,
    );
  });
  it("désactiver le NFC et activer le QR restent acceptés", () => {
    setEnv("production", undefined);
    const patch = parseSettingsPatch({ studentCardEnabled: true, studentCardQrEnabled: true, studentCardNfcEnabled: false });
    assert.equal(patch.studentCardNfcEnabled, false);
    assert.equal(patch.studentCardQrEnabled, true);
    assert.equal(patch.studentCardEnabled, true);
  });
});

describe("hors production ou plateforme autorisée : comportement historique", () => {
  it("NODE_ENV=test : lecture et écriture inchangées", () => {
    setEnv("test", undefined);
    assert.equal(mapStudentCardFlags(ALREADY_ACTIVE_ROW).studentCardNfcEnabled, true);
    assert.equal(parseSettingsPatch({ studentCardNfcEnabled: true }).studentCardNfcEnabled, true);
  });
  it("production + autorisation explicite : lecture et écriture inchangées", () => {
    setEnv("production", "true");
    assert.equal(mapStudentCardFlags(ALREADY_ACTIVE_ROW).studentCardNfcEnabled, true);
    assert.equal(parseSettingsPatch({ studentCardNfcEnabled: true }).studentCardNfcEnabled, true);
  });
});
