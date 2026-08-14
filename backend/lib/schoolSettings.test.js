"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PERIOD_MODES,
  REPORT_CARD_MODES,
  ALL_LEGACY_SCHOOL_SETTINGS_KEYS,
  SCHOOL_SETTINGS_ERROR,
  assertNoLegacySchoolSettingsWrite,
  classifyLegacySchoolSettings,
  mapSettingsRow,
  stripLegacySchoolSettings,
} = require("./schoolSettingsManagement");

test("assertNoLegacySchoolSettingsWrite refuse chaque clé LOT 4 même à null", () => {
  const cases = [
    [{ periods: null }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_PERIODS_WRITE_FORBIDDEN],
    [{ periods: [] }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_PERIODS_WRITE_FORBIDDEN],
    [{ periodMode: null }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_PERIODS_WRITE_FORBIDDEN],
    [{ classNames: null }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_CLASS_NAMES_WRITE_FORBIDDEN],
    [{ subjects: [] }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SUBJECTS_WRITE_FORBIDDEN],
    [{ subjectsByClass: {} }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SUBJECTS_WRITE_FORBIDDEN],
    [{ defaultScale: 20 }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_WRITE_FORBIDDEN],
    [{ reportCardMode: "period" }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_WRITE_FORBIDDEN],
    [{ schoolYear: "2024-2025" }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_WRITE_FORBIDDEN],
    [{ academicYear: "2024-2025" }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_WRITE_FORBIDDEN],
    [{ allowCustomClasses: true }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_WRITE_FORBIDDEN],
    [{ bulletinDesignByClass: {} }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_WRITE_FORBIDDEN],
    [{ defaultGradeScale: 20 }, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_WRITE_FORBIDDEN],
  ];
  for (const [payload, code] of cases) {
    assert.throws(() => assertNoLegacySchoolSettingsWrite(payload), (error) => error.code === code);
  }
});

test("assertNoLegacySchoolSettingsWrite autorise un objet vide", () => {
  assert.doesNotThrow(() => assertNoLegacySchoolSettingsWrite({}));
});

test("clés d'écriture interdites LOT 4 n'incluent pas LOT 1/2/3", () => {
  assert.equal(ALL_LEGACY_SCHOOL_SETTINGS_KEYS.includes("levels"), false);
  assert.equal(ALL_LEGACY_SCHOOL_SETTINGS_KEYS.includes("tracks"), false);
  assert.equal(ALL_LEGACY_SCHOOL_SETTINGS_KEYS.includes("userRoles"), false);
  assert.equal(ALL_LEGACY_SCHOOL_SETTINGS_KEYS.includes("evaluationTypes"), false);
});

test("classifyLegacySchoolSettings accepte JSON vide", () => {
  const result = classifyLegacySchoolSettings({}, { classNames: [], subjectNames: [], termNames: [] });
  assert.equal(result.ambiguous, false);
});

test("classifyLegacySchoolSettings refuse des périodes custom", () => {
  const result = classifyLegacySchoolSettings(
    { periods: [{ name: "Période Alpha", start: "01-09-2024", end: "31-12-2024" }] },
    { classNames: [], subjectNames: [], termNames: [] },
  );
  assert.equal(result.ambiguous, true);
  assert.equal(result.issues[0].code, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_PERIODS_AMBIGUOUS);
});

test("classifyLegacySchoolSettings refuse des classNames custom", () => {
  const result = classifyLegacySchoolSettings(
    { classNames: ["Classe inventée"] },
    { classNames: [], subjectNames: [], termNames: [] },
  );
  assert.equal(result.ambiguous, true);
  assert.equal(result.issues[0].code, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_CLASS_NAMES_AMBIGUOUS);
});

test("classifyLegacySchoolSettings refuse des subjects custom", () => {
  const result = classifyLegacySchoolSettings(
    { subjects: ["Matière inventée"] },
    { classNames: [], subjectNames: [], termNames: [] },
  );
  assert.equal(result.ambiguous, true);
  assert.equal(result.issues[0].code, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SUBJECTS_AMBIGUOUS);
});

test("classifyLegacySchoolSettings refuse subjectsByClass non vide", () => {
  const result = classifyLegacySchoolSettings(
    { subjectsByClass: { "6ème A": ["Maths"] } },
    { classNames: ["6ème A"], subjectNames: ["Maths"], termNames: [] },
  );
  assert.equal(result.ambiguous, true);
  assert.equal(result.issues[0].code, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SUBJECTS_AMBIGUOUS);
});

test("classifyLegacySchoolSettings refuse defaultScale invalide", () => {
  const result = classifyLegacySchoolSettings(
    { defaultScale: 0 },
    { classNames: [], subjectNames: [], termNames: [] },
  );
  assert.equal(result.ambiguous, true);
  assert.equal(result.issues[0].code, SCHOOL_SETTINGS_ERROR.LEGACY_SCHOOL_SETTINGS_AMBIGUOUS);
});

test("stripLegacySchoolSettings retire les clés LOT 4 sans toucher LOT 1/2/3", () => {
  const next = stripLegacySchoolSettings({
    periods: [],
    periodMode: "trimestre",
    classNames: ["6ème A"],
    subjects: ["Maths"],
    levels: ["6ème"],
    tracks: ["Générale"],
    userRoles: ["Enseignant"],
    evaluationTypes: ["Devoir"],
  });
  assert.equal("periods" in next, false);
  assert.equal("classNames" in next, false);
  assert.deepEqual(next.levels, ["6ème"]);
  assert.deepEqual(next.evaluationTypes, ["Devoir"]);
});

test("mapSettingsRow expose les scalaires canoniques", () => {
  const publicRow = mapSettingsRow({
    school_id: "school-1",
    period_mode: "trimestre",
    default_scale: 20,
    report_card_mode: "period",
  });
  assert.equal(publicRow.periodMode, "trimestre");
  assert.equal(publicRow.defaultScale, 20);
  assert.equal(publicRow.reportCardMode, "period");
  assert.ok(PERIOD_MODES.includes(publicRow.periodMode));
  assert.ok(REPORT_CARD_MODES.includes(publicRow.reportCardMode));
});
