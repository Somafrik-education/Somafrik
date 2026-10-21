"use strict";

// CARTE-CYCLE-01 — règle de détermination du titulaire (élève / étudiant), sans base de données.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  STUDENT_CARD_HOLDER_SOURCE,
  holderFromSchoolType,
  normalizeHolderLevels,
  resolveStudentCardHolder,
  resolveStudentCardHolderFromContext,
} = require("./studentCardHolder");
const {
  parseSettingsPatch,
  mapSettingsRow,
  resolveStudentCardHolderSettings,
  SCHOOL_SETTINGS_ERROR,
} = require("./schoolSettingsManagement");

const LEVEL_SEC = "11111111-1111-4111-8111-111111111111";
const LEVEL_SUP = "22222222-2222-4222-8222-222222222222";

test("matrice validée : seuls les quatre types exacts déterminent le titulaire", () => {
  assert.equal(holderFromSchoolType("École primaire"), "eleve");
  assert.equal(holderFromSchoolType("Collège"), "eleve");
  assert.equal(holderFromSchoolType("Lycée"), "eleve");
  assert.equal(holderFromSchoolType("Université"), "etudiant");
  for (const ambiguous of ["Institut", "Centre de formation"]) assert.equal(holderFromSchoolType(ambiguous), null, ambiguous);
});

test("valeurs libres, absentes ou approchantes : jamais de déduction", () => {
  for (const value of [
    "Établissement", "Établissement secondaire", "Démonstration", "Institut supérieur de gestion",
    "lycée", "LYCÉE", "Lycee", "Universite", "Université libre", "Collège Saint-Joseph", "", "   ",
    null, undefined, 42, {}, [], "__proto__", "constructor", "toString",
  ]) {
    assert.equal(holderFromSchoolType(value), null, JSON.stringify(value));
  }
});

test("égalité exacte après normalisation Unicode NFC et suppression des espaces", () => {
  assert.equal(holderFromSchoolType("  Lycée  "), "eleve");
  assert.equal(holderFromSchoolType("Lycée"), "eleve", "é décomposé (NFD) = même texte canonique");
  assert.equal(holderFromSchoolType("Université"), "etudiant");
});

test("priorité : niveau de la classe > réglage établissement > type exact > non déterminé", () => {
  const levels = { [LEVEL_SUP]: "etudiant", [LEVEL_SEC]: "eleve" };
  assert.deepEqual(
    resolveStudentCardHolder({ schoolType: "Lycée", holderKind: "eleve", holderLevels: levels, levelId: LEVEL_SUP }),
    { kind: "etudiant", source: STUDENT_CARD_HOLDER_SOURCE.LEVEL },
  );
  assert.deepEqual(
    resolveStudentCardHolder({ schoolType: "Institut", holderKind: "etudiant", holderLevels: levels, levelId: null }),
    { kind: "etudiant", source: STUDENT_CARD_HOLDER_SOURCE.SCHOOL },
  );
  assert.deepEqual(
    resolveStudentCardHolder({ schoolType: "Université", holderKind: null, holderLevels: {} }),
    { kind: "etudiant", source: STUDENT_CARD_HOLDER_SOURCE.SCHOOL_TYPE },
  );
  assert.deepEqual(resolveStudentCardHolder({ schoolType: "Institut" }), { kind: null, source: null });
  assert.deepEqual(resolveStudentCardHolder(), { kind: null, source: null });
});

test("établissement mixte : un niveau non configuré ne reçoit pas le libellé d'une autre section", () => {
  const mixed = { schoolType: "Institut", holderKind: null, holderLevels: { [LEVEL_SUP]: "etudiant" } };
  assert.equal(resolveStudentCardHolder({ ...mixed, levelId: LEVEL_SUP }).kind, "etudiant");
  assert.equal(resolveStudentCardHolder({ ...mixed, levelId: LEVEL_SEC }).kind, null, "section secondaire non configurée");
  assert.equal(resolveStudentCardHolder({ ...mixed, levelId: null }).kind, null, "élève sans classe");
  assert.equal(resolveStudentCardHolder({ ...mixed, levelId: LEVEL_SUP.toUpperCase() }).kind, "etudiant");
});

test("lecture fail-closed : réglages corrompus ignorés, jamais transformés en titulaire", () => {
  assert.deepEqual(normalizeHolderLevels({ "pas-un-uuid": "eleve", [LEVEL_SEC]: "Eleve", [LEVEL_SUP]: "etudiant" }), { [LEVEL_SUP]: "etudiant" });
  for (const bad of [null, [], "x", 3, [[LEVEL_SEC, "eleve"]]]) assert.deepEqual(normalizeHolderLevels(bad), {});
  assert.equal(resolveStudentCardHolder({ schoolType: "Institut", holderKind: "ELEVE" }).kind, null);
  assert.equal(resolveStudentCardHolder({ schoolType: "Institut", holderLevels: { ["__proto__"]: "eleve" }, levelId: "__proto__" }).kind, null);
  assert.deepEqual(
    resolveStudentCardHolderFromContext({ school_type: "Lycée", student_card_holder_kind: null, student_card_holder_levels: null, level_id: null }),
    { kind: "eleve", source: STUDENT_CARD_HOLDER_SOURCE.SCHOOL_TYPE },
  );
  assert.deepEqual(resolveStudentCardHolderFromContext(null), { kind: null, source: null });
});

test("paramètres : titulaire eleve | etudiant | null, toute autre valeur refusée", () => {
  assert.deepEqual(parseSettingsPatch({ studentCardHolderKind: "eleve" }), { studentCardHolderKind: "eleve" });
  assert.deepEqual(parseSettingsPatch({ studentCardHolderKind: null }), { studentCardHolderKind: null });
  for (const bad of ["Eleve", "élève", "student", "", true, 1, {}]) {
    assert.throws(() => parseSettingsPatch({ studentCardHolderKind: bad }), { code: SCHOOL_SETTINGS_ERROR.INVALID_STUDENT_CARD_HOLDER }, JSON.stringify(bad));
  }
});

test("paramètres : surcharges par niveau validées strictement (remplacement complet)", () => {
  assert.deepEqual(
    parseSettingsPatch({ studentCardHolderLevels: { [LEVEL_SUP.toUpperCase()]: "etudiant" } }),
    { studentCardHolderLevels: { [LEVEL_SUP]: "etudiant" } },
  );
  assert.deepEqual(parseSettingsPatch({ studentCardHolderLevels: {} }), { studentCardHolderLevels: {} });
  const tooMany = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`, "eleve"]));
  for (const bad of [null, [], "x", { "pas-un-uuid": "eleve" }, { [LEVEL_SEC]: "Eleve" }, { [LEVEL_SEC]: null }, tooMany]) {
    assert.throws(() => parseSettingsPatch({ studentCardHolderLevels: bad }), { code: SCHOOL_SETTINGS_ERROR.INVALID_STUDENT_CARD_HOLDER_LEVEL });
  }
});

test("paramètres : lecture et fusion conservent l'existant si le champ est absent du patch", () => {
  const row = { student_card_holder_kind: "etudiant", student_card_holder_levels: { [LEVEL_SEC]: "eleve", bad: "x" } };
  const mapped = mapSettingsRow(row, "CD-X", { school_type: "Institut" });
  assert.equal(mapped.studentCardHolderKind, "etudiant");
  assert.deepEqual(mapped.studentCardHolderLevels, { [LEVEL_SEC]: "eleve" });
  assert.equal(mapped.studentCardHolderFromSchoolType, null);
  assert.equal(mapSettingsRow({}, "CD-X", { school_type: "Lycée" }).studentCardHolderFromSchoolType, "eleve");
  assert.equal(mapSettingsRow({ student_card_holder_kind: "invalide" }).studentCardHolderKind, null);
  assert.deepEqual(resolveStudentCardHolderSettings({}, row), { studentCardHolderKind: "etudiant", studentCardHolderLevels: { [LEVEL_SEC]: "eleve" } });
  assert.deepEqual(resolveStudentCardHolderSettings({ studentCardHolderKind: null }, row).studentCardHolderKind, null);
});
