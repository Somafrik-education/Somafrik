"use strict";

/**
 * CARTE-CYCLE-01 — titulaire de la carte scolaire : « élève » ou « étudiant ».
 *
 * Règles validées CTO (AUDIT-CARTE-UI-01) :
 *  1. surcharge explicite du niveau d'enseignement de la classe courante de l'élève ;
 *  2. sinon, réglage explicite de l'établissement (school_settings) ;
 *  3. sinon, type d'établissement EXACT : École primaire, Collège, Lycée → élève ; Université → étudiant ;
 *  4. sinon (Institut, Centre de formation, valeur libre, type absent) : NON DÉTERMINÉ.
 * Aucune recherche approximative dans un nom : égalité exacte après normalisation Unicode NFC et trim.
 * Un titulaire non déterminé interdit toute émission imprimable, avant toute génération de jeton.
 *
 * Établissement mixte (au moins une surcharge par niveau enregistrée) — fail-closed :
 *  - le niveau de l'élève doit être CERTAIN : une seule classe courante, un level_id, et ce niveau
 *    toujours ACTIF dans school_levels de l'établissement (levelActive === true) ;
 *  - sinon (inscription absente ou ambiguë, classe sans niveau, niveau désactivé depuis la
 *    configuration) : NON DÉTERMINÉ — ni le réglage global ni le type ne s'appliquent ;
 *  - une surcharge visant un niveau désactivé n'a plus d'effet (l'élève de ce niveau est bloqué) ;
 *  - un niveau certain sans surcharge reprend le réglage global, puis le type exact.
 */

const STUDENT_CARD_HOLDER_KINDS = Object.freeze(["eleve", "etudiant"]);

const SCHOOL_TYPE_HOLDER = new Map([
  ["École primaire", "eleve"],
  ["Collège", "eleve"],
  ["Lycée", "eleve"],
  ["Université", "etudiant"],
]);

const STUDENT_CARD_HOLDER_SOURCE = Object.freeze({
  LEVEL: "level_setting",
  SCHOOL: "school_setting",
  SCHOOL_TYPE: "school_type",
});

/** Limite défensive : un établissement n'active pas des dizaines de niveaux. */
const MAX_HOLDER_LEVEL_OVERRIDES = 64;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function canonicalText(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

function normalizeHolderKind(value) {
  return typeof value === "string" && STUDENT_CARD_HOLDER_KINDS.includes(value) ? value : null;
}

function isHolderLevelId(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function holderFromSchoolType(schoolType) {
  return SCHOOL_TYPE_HOLDER.get(canonicalText(schoolType)) ?? null;
}

/** Lecture fail-closed : toute entrée invalide est ignorée (jamais de titulaire deviné). */
function normalizeHolderLevels(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [levelId, kind] of Object.entries(value)) {
    const normalized = normalizeHolderKind(kind);
    if (isHolderLevelId(levelId) && normalized) out[levelId.toLowerCase()] = normalized;
  }
  return out;
}

const UNDETERMINED = Object.freeze({ kind: null, source: null });

function resolveStudentCardHolder({ schoolType, holderKind, holderLevels, levelId, levelActive } = {}) {
  const levels = normalizeHolderLevels(holderLevels);
  if (Object.keys(levels).length) {
    const level = isHolderLevelId(levelId) ? levelId.toLowerCase() : "";
    // Mixte : sans niveau certain et actif, aucun libellé (jamais celui d'une autre section).
    if (!level || levelActive !== true) return { ...UNDETERMINED };
    if (Object.prototype.hasOwnProperty.call(levels, level)) {
      return { kind: levels[level], source: STUDENT_CARD_HOLDER_SOURCE.LEVEL };
    }
  }
  const explicit = normalizeHolderKind(holderKind);
  if (explicit) return { kind: explicit, source: STUDENT_CARD_HOLDER_SOURCE.SCHOOL };
  const fromType = holderFromSchoolType(schoolType);
  if (fromType) return { kind: fromType, source: STUDENT_CARD_HOLDER_SOURCE.SCHOOL_TYPE };
  return { ...UNDETERMINED };
}

/** Contexte lu en base (studentAccessCardsPgStore.findCardHolderContext) → titulaire résolu. */
function resolveStudentCardHolderFromContext(row) {
  return resolveStudentCardHolder({
    schoolType: row?.school_type,
    holderKind: row?.student_card_holder_kind,
    holderLevels: row?.student_card_holder_levels,
    levelId: row?.level_id,
    levelActive: row?.level_active === true,
  });
}

module.exports = {
  STUDENT_CARD_HOLDER_KINDS,
  STUDENT_CARD_HOLDER_SOURCE,
  MAX_HOLDER_LEVEL_OVERRIDES,
  canonicalText,
  normalizeHolderKind,
  normalizeHolderLevels,
  isHolderLevelId,
  holderFromSchoolType,
  resolveStudentCardHolder,
  resolveStudentCardHolderFromContext,
};
