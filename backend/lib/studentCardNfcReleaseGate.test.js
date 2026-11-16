"use strict";

/**
 * GO-PROD-G6-02 / #921 — verrou plateforme du NFC carte élève non homologué.
 * En production, aucun établissement ne peut activer ni utiliser le NFC tant que
 * SOMAFRIK_STUDENT_CARD_NFC_ALLOWED=true n'est pas posé. QR et autres flags inchangés.
 */

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  isStudentCardNfcPlatformAllowed,
  mapStudentCardFlags,
  mapSettingsRow,
  isStudentCardCapabilityEnabled,
  parseSettingsPatch,
  SCHOOL_SETTINGS_ERROR,
} = require("./schoolSettingsManagement");
const { projectStudentCardCapabilitiesHttp } = require("./studentCardCapabilities");

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

const ALL_ON_ROW = {
  school_id: "11111111-1111-4111-8111-111111111111",
  student_card_enabled: true,
  student_card_qr_enabled: true,
  student_card_nfc_enabled: true,
  student_card_attendance_enabled: true,
  student_card_finance_check_enabled: true,
  student_card_offline_roll_call_enabled: true,
};

describe("isStudentCardNfcPlatformAllowed", () => {
  it("production sans variable : NFC refusé (fail-closed)", () => {
    assert.equal(isStudentCardNfcPlatformAllowed({ NODE_ENV: "production" }), false);
  });
  it("production avec une valeur autre que true : refusé", () => {
    for (const value of ["", "1", "yes", "TRUE ", "false"]) {
      const expected = value.trim().toLowerCase() === "true";
      assert.equal(
        isStudentCardNfcPlatformAllowed({ NODE_ENV: "production", SOMAFRIK_STUDENT_CARD_NFC_ALLOWED: value }),
        expected,
        `valeur ${JSON.stringify(value)}`,
      );
    }
  });
  it("production avec SOMAFRIK_STUDENT_CARD_NFC_ALLOWED=true : autorisé", () => {
    assert.equal(
      isStudentCardNfcPlatformAllowed({ NODE_ENV: "production", SOMAFRIK_STUDENT_CARD_NFC_ALLOWED: "true" }),
      true,
    );
  });
  it("hors production : comportement inchangé", () => {
    assert.equal(isStudentCardNfcPlatformAllowed({ NODE_ENV: "test" }), true);
    assert.equal(isStudentCardNfcPlatformAllowed({}), true);
  });
});

describe("lecture des flags en production sans autorisation plateforme", () => {
  it("une ligne déjà à true en base est lue false pour le NFC uniquement", () => {
    setEnv("production", undefined);
    const flags = mapStudentCardFlags(ALL_ON_ROW);
    assert.equal(flags.studentCardNfcEnabled, false);
    assert.equal(flags.studentCardEnabled, true);
    assert.equal(flags.studentCardQrEnabled, true);
    assert.equal(flags.studentCardAttendanceEnabled, true);
    assert.equal(flags.studentCardFinanceCheckEnabled, true);
    assert.equal(flags.studentCardOfflineRollCallEnabled, true);
  });
  it("capacités HTTP et capacité runtime : NFC false, QR conservé", () => {
    setEnv("production", undefined);
    const http = projectStudentCardCapabilitiesHttp(ALL_ON_ROW);
    assert.equal(http.studentCardNfcEnabled, false);
    assert.equal(http.studentCardQrEnabled, true);
    const settings = mapSettingsRow(ALL_ON_ROW);
    assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardNfcEnabled"), false);
    assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardQrEnabled"), true);
  });
  it("avec autorisation plateforme : la ligne est lue telle quelle", () => {
    setEnv("production", "true");
    assert.equal(mapStudentCardFlags(ALL_ON_ROW).studentCardNfcEnabled, true);
  });
});

describe("écriture des flags en production sans autorisation plateforme", () => {
  it("activer le NFC est refusé en 409 STUDENT_CARD_NFC_NOT_HOMOLOGATED", () => {
    setEnv("production", undefined);
    assert.throws(
      () => parseSettingsPatch({ studentCardNfcEnabled: true }),
      (error) => error.status === 409 || error.statusCode === 409
        ? error.code === SCHOOL_SETTINGS_ERROR.STUDENT_CARD_NFC_NOT_HOMOLOGATED
        : false,
    );
  });
  it("désactiver le NFC et les autres flags restent acceptés", () => {
    setEnv("production", undefined);
    const patch = parseSettingsPatch({
      studentCardEnabled: true,
      studentCardQrEnabled: true,
      studentCardNfcEnabled: false,
    });
    assert.equal(patch.studentCardNfcEnabled, false);
    assert.equal(patch.studentCardQrEnabled, true);
  });
  it("avec autorisation plateforme ou hors production : activation acceptée", () => {
    setEnv("production", "true");
    assert.equal(parseSettingsPatch({ studentCardNfcEnabled: true }).studentCardNfcEnabled, true);
    setEnv("test", undefined);
    assert.equal(parseSettingsPatch({ studentCardNfcEnabled: true }).studentCardNfcEnabled, true);
  });
});
