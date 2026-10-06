"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SCHOOL_SETTINGS_ERROR,
  STUDENT_CARD_FLAG_FIELDS,
  STUDENT_CARD_FLAG_API_KEYS,
  coerceFailClosedBoolean,
  mapSettingsRow,
  mapStudentCardFlags,
  parseSettingsPatch,
  resolveStudentCardFlags,
  isStudentCardMasterEnabled,
  isStudentCardCapabilityEnabled,
  assertSchoolSettingsRead,
  assertSchoolSettingsWrite,
} = require("./schoolSettingsManagement");
const { createSchoolSettingsMemoryStore } = require("../db/schoolSettingsMemoryStore");

const ROOT = path.resolve(__dirname, "../..");

function readRepo(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assertAllFlagsFalse(payload, label) {
  for (const key of STUDENT_CARD_FLAG_API_KEYS) {
    assert.equal(payload[key], false, `${label}: ${key} doit rester false`);
  }
}

test("CARTE-PR0 — les cinq flags existent et restent indépendants", () => {
  assert.equal(STUDENT_CARD_FLAG_FIELDS.length, 5);
  assert.deepEqual(STUDENT_CARD_FLAG_API_KEYS, [
    "studentCardEnabled",
    "studentCardQrEnabled",
    "studentCardNfcEnabled",
    "studentCardAttendanceEnabled",
    "studentCardFinanceCheckEnabled",
  ]);
});

test("CARTE-PR0 — mapSettingsRow : colonnes absentes = false", () => {
  const publicRow = mapSettingsRow({
    school_id: "school-1",
    period_mode: "trimestre",
    default_scale: 20,
    report_card_mode: "period",
  });
  assertAllFlagsFalse(publicRow, "row sans colonnes carte");
});

test("CARTE-PR0 — mapSettingsRow : null / invalide = fail-closed", () => {
  const publicRow = mapSettingsRow({
    school_id: "school-1",
    student_card_enabled: null,
    student_card_qr_enabled: "true",
    student_card_nfc_enabled: 1,
    student_card_attendance_enabled: "yes",
    student_card_finance_check_enabled: "t",
  });
  assertAllFlagsFalse(publicRow, "valeurs invalides");
  assert.equal(coerceFailClosedBoolean(null), false);
  assert.equal(coerceFailClosedBoolean(undefined), false);
  assert.equal(coerceFailClosedBoolean("true"), false);
  assert.equal(coerceFailClosedBoolean(1), false);
  assert.equal(coerceFailClosedBoolean(true), true);
  assert.equal(coerceFailClosedBoolean(false), false);
});

test("CARTE-PR0 — parseSettingsPatch refuse une valeur non booléenne", () => {
  assert.throws(
    () => parseSettingsPatch({ studentCardEnabled: "true" }),
    (error) =>
      error.statusCode === 400 && error.code === SCHOOL_SETTINGS_ERROR.INVALID_STUDENT_CARD_FLAG,
  );
  assert.throws(
    () => parseSettingsPatch({ studentCardQrEnabled: 1 }),
    (error) => error.code === SCHOOL_SETTINGS_ERROR.INVALID_STUDENT_CARD_FLAG,
  );
  assert.throws(
    () => parseSettingsPatch({ studentCardNfcEnabled: null }),
    (error) => error.code === SCHOOL_SETTINGS_ERROR.INVALID_STUDENT_CARD_FLAG,
  );
});

test("CARTE-PR0 — parseSettingsPatch accepte true/false sans activer les autres flags", () => {
  const patch = parseSettingsPatch({ studentCardQrEnabled: true, studentCardEnabled: false });
  assert.equal(patch.studentCardQrEnabled, true);
  assert.equal(patch.studentCardEnabled, false);
  assert.equal("studentCardNfcEnabled" in patch, false);
  assert.equal("periodMode" in patch, false);
});

test("CARTE-PR0 — master off ⇒ sous-options sans effet effectif", () => {
  const settings = {
    studentCardEnabled: false,
    studentCardQrEnabled: true,
    studentCardNfcEnabled: true,
    studentCardAttendanceEnabled: true,
    studentCardFinanceCheckEnabled: true,
  };
  assert.equal(isStudentCardMasterEnabled(settings), false);
  assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardQrEnabled"), false);
  assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardNfcEnabled"), false);
  assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardAttendanceEnabled"), false);
  assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardFinanceCheckEnabled"), false);
});

test("CARTE-PR0 — master on n'active une sous-option que si elle est true", () => {
  const settings = {
    studentCardEnabled: true,
    studentCardQrEnabled: true,
    studentCardNfcEnabled: false,
    studentCardAttendanceEnabled: true,
    studentCardFinanceCheckEnabled: false,
  };
  assert.equal(isStudentCardMasterEnabled(settings), true);
  assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardEnabled"), true);
  assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardQrEnabled"), true);
  assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardNfcEnabled"), false);
  assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardAttendanceEnabled"), true);
  assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardFinanceCheckEnabled"), false);
});

test("CARTE-PR0 — capacité inconnue / absente / null = fail-closed même si master on", () => {
  const settings = {
    studentCardEnabled: true,
    rogueCapability: true,
    studentCardQrEnabled: true,
  };
  assert.equal(
    isStudentCardCapabilityEnabled(settings, "rogueCapability"),
    false,
  );
  assert.equal(isStudentCardCapabilityEnabled(settings, "studentCardFinanceCheckEnabled"), false);
  assert.equal(isStudentCardCapabilityEnabled(settings, null), false);
  assert.equal(isStudentCardCapabilityEnabled(settings, undefined), false);
  assert.equal(isStudentCardCapabilityEnabled(settings, ""), false);
  assert.equal(isStudentCardCapabilityEnabled(settings, "student_card_enabled"), false);
  assert.equal(
    isStudentCardCapabilityEnabled(
      { studentCardEnabled: false, studentCardQrEnabled: true, rogueCapability: true },
      "studentCardQrEnabled",
    ),
    false,
  );
});

test("CARTE-PR0 — mémoire : défaut false, isolation établissement, PATCH académique inchangé", async () => {
  const store = createSchoolSettingsMemoryStore({
    schools: [
      { id: "school-a", schoolCode: "CD-2026-0001" },
      { id: "school-b", schoolCode: "BI-2026-0002" },
    ],
  });
  const rowA = await store.seedDefaultSettingsIfEmpty("school-a");
  const rowB = await store.seedDefaultSettingsIfEmpty("school-b");
  assertAllFlagsFalse(mapSettingsRow(rowA), "école A défaut");
  assertAllFlagsFalse(mapSettingsRow(rowB), "école B défaut");

  const patchedA = await store.upsertSettings("school-a", {
    studentCardEnabled: true,
    studentCardAttendanceEnabled: true,
  });
  assert.equal(mapSettingsRow(patchedA).studentCardEnabled, true);
  assert.equal(mapSettingsRow(patchedA).studentCardAttendanceEnabled, true);
  assert.equal(mapSettingsRow(patchedA).studentCardQrEnabled, false);
  assert.equal(mapSettingsRow(await store.getSettings("school-b")).studentCardEnabled, false);

  const academic = await store.upsertSettings("school-a", { periodMode: "semestre", defaultScale: 10 });
  const mapped = mapSettingsRow(academic);
  assert.equal(mapped.periodMode, "semestre");
  assert.equal(mapped.defaultScale, 10);
  assert.equal(mapped.studentCardEnabled, true);
  assert.equal(mapped.studentCardAttendanceEnabled, true);
  assert.equal(mapSettingsRow(await store.getSettings("school-b")).periodMode, "trimestre");
});

test("CARTE-PR0 — lecture/écriture school_settings inchangée pour Superadmin / Admin Pays / établissement", () => {
  assert.doesNotThrow(() => assertSchoolSettingsRead({ role: "Super Administrateur Somafrik" }));
  assert.doesNotThrow(() => assertSchoolSettingsRead({ role: "Admin Pays" }));
  assert.doesNotThrow(() =>
    assertSchoolSettingsRead({ role: "Admin School", permissions: ["Paramètres Établissement:READ"] }),
  );
  assert.doesNotThrow(() => assertSchoolSettingsWrite({ role: "Super Administrateur Somafrik" }));
  assert.throws(
    () => assertSchoolSettingsWrite({ role: "Admin Pays" }),
    (error) => error.statusCode === 403,
  );
  assert.throws(
    () => assertSchoolSettingsWrite({ role: "Admin School", permissions: ["Paramètres Établissement:READ"] }),
    (error) => error.statusCode === 403,
  );
  assert.doesNotThrow(() =>
    assertSchoolSettingsWrite({ role: "Admin School", permissions: ["Paramètres Établissement:UPDATE"] }),
  );
});

test("CARTE-PR0 — aucune permission scolaire supplémentaire, aucun QR/NFC produit", () => {
  const catalog = readRepo("backend/lib/functionalModulesCatalog.js");
  const roles = readRepo("backend/lib/establishmentRolesManagement.js");
  const schema = readRepo("backend/db/schema.sql");
  const management = readRepo("backend/lib/schoolSettingsManagement.js");
  const android = readRepo("Mobile/plugins/withSomafrikAndroidSecurity.js");
  const appConfig = readRepo("Mobile/app.config.js");
  const server = readRepo("backend/server.js");
  const presences = readRepo("backend/lib/presencesAttendanceAuthz.js");

  assert.doesNotMatch(catalog, /student_card|studentCard|carte_eleve|Carte Élève/);
  assert.doesNotMatch(roles, /Carte Élève|student_card|NFC:|QR:/);
  assert.doesNotMatch(management, /cardToken/);
  assert.match(android, /android\.permission\.NFC/);
  assert.doesNotMatch(appConfig, /expo-camera|nfc-manager|react-native-nfc/);
  assert.doesNotMatch(server, /\/api\/student-cards\/scan/);
  assert.doesNotMatch(presences, /student_card|studentCard|cardToken/);
  assert.match(schema, /student_card_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
});

test("CARTE-PR0 — resolveStudentCardFlags conserve l'existant et fail-closed sur patch absent", () => {
  const current = {
    student_card_enabled: true,
    student_card_qr_enabled: false,
  };
  const resolved = resolveStudentCardFlags({ periodMode: "semestre" }, current);
  assert.equal(resolved.studentCardEnabled, true);
  assert.equal(resolved.studentCardQrEnabled, false);
  assert.equal(resolved.studentCardNfcEnabled, false);
  const empty = resolveStudentCardFlags({}, {});
  assertAllFlagsFalse(empty, "sans row");
  assert.deepEqual(mapStudentCardFlags(null), {
    studentCardEnabled: false,
    studentCardQrEnabled: false,
    studentCardNfcEnabled: false,
    studentCardAttendanceEnabled: false,
    studentCardFinanceCheckEnabled: false,
  });
});
