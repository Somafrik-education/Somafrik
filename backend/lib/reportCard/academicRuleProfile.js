"use strict";

/**
 * LOT 1 — AcademicRuleProfile (règles de calcul), versionné, tenant-safe.
 * Pas de ReportCardSchema, pas de moteur de notes, pas de PDF /verify.
 */

const crypto = require("node:crypto");
const { canonicalize } = require("../../contracts/reportCard/jcs");
const { ENGINE_ID, LAYERS } = require("../../contracts/reportCard/contract");

const PROFILE_STATUSES = Object.freeze(["DRAFT", "ACTIVE", "SUPERSEDED", "ARCHIVED"]);
const APPLICABILITY = Object.freeze(["always", "per_subject", "never"]);
const SUBJECT_APPLICABILITY_MODES = Object.freeze(["always", "never", "per_subject", "include", "exclude"]);
const PERIOD_APPLICABILITY_MODES = Object.freeze(["always", "never", "include", "exclude"]);
const SELECTOR_ID_RE = /^[A-Z][A-Z0-9_]{0,31}$/;
const TIE_STRATEGIES = Object.freeze(["competition", "dense", "min"]);
const ROUNDING_MODES = Object.freeze(["half_up", "half_even", "down"]);
const MISSING_SCORE_POLICY = "NOT_APPLICABLE_not_zero";

const GENERIC_COMPONENT_IDS = Object.freeze([
  "TJ",
  "EX",
  "ORAL",
  "WRITTEN",
  "PRACTICAL",
  "COMPONENT_PERIOD",
]);

class AcademicRuleProfileError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "AcademicRuleProfileError";
    this.code = code;
  }
}

function requireSchoolId(schoolId) {
  if (schoolId == null || schoolId === "") {
    throw new AcademicRuleProfileError("TENANT_REQUIRED");
  }
  return schoolId;
}

function assertSameTenant(schoolId, actorSchoolId) {
  requireSchoolId(schoolId);
  requireSchoolId(actorSchoolId);
  if (actorSchoolId !== schoolId) {
    throw new AcademicRuleProfileError("TENANT_MISMATCH");
  }
}

function rejectCountrySchoolKeys(value, path = "") {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      rejectCountrySchoolKeys(value[i], `${path}[${i}]`);
    }
    return;
  }
  for (const key of Object.keys(value)) {
    if (/^(country|country_id|countryCode|country_code|iso_code|school|school_id|school_name|schoolName)$/i.test(key)) {
      throw new AcademicRuleProfileError("COUNTRY_SCHOOL_BRANCH_FORBIDDEN", `forbidden key ${key}`);
    }
    rejectCountrySchoolKeys(value[key], path ? `${path}.${key}` : key);
  }
}

function normalizeSelectorIds(rawIds) {
  if (!Array.isArray(rawIds) || rawIds.length < 1) {
    throw new AcademicRuleProfileError("INVALID_APPLICABILITY");
  }
  const ids = [];
  const seen = new Set();
  for (const raw of rawIds) {
    const id = String(raw || "").trim();
    if (!SELECTOR_ID_RE.test(id)) throw new AcademicRuleProfileError("INVALID_APPLICABILITY");
    if (seen.has(id)) throw new AcademicRuleProfileError("INVALID_APPLICABILITY");
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function parseApplicabilityDimension(raw, allowedModes) {
  if (raw == null || raw === "") {
    return { mode: "always" };
  }
  if (typeof raw === "string") {
    if (!allowedModes.includes(raw)) throw new AcademicRuleProfileError("INVALID_APPLICABILITY");
    return { mode: raw };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new AcademicRuleProfileError("INVALID_APPLICABILITY");
  }
  rejectCountrySchoolKeys(raw);
  const include = raw.include;
  const exclude = raw.exclude;
  if (include && exclude) throw new AcademicRuleProfileError("INVALID_APPLICABILITY");
  if (include) return { mode: "include", ids: normalizeSelectorIds(include) };
  if (exclude) return { mode: "exclude", ids: normalizeSelectorIds(exclude) };
  const mode = raw.mode || "always";
  if (!allowedModes.includes(mode)) throw new AcademicRuleProfileError("INVALID_APPLICABILITY");
  if (mode === "include" || mode === "exclude") {
    return { mode, ids: normalizeSelectorIds(raw.ids) };
  }
  return { mode };
}

function normalizeApplicability(raw, periodIds) {
  if (raw == null || raw === "always") {
    return Object.freeze({
      subjects: Object.freeze({ mode: "always" }),
      periods: Object.freeze({ mode: "always" }),
    });
  }
  if (raw === "never") {
    return Object.freeze({
      subjects: Object.freeze({ mode: "never" }),
      periods: Object.freeze({ mode: "never" }),
    });
  }
  if (raw === "per_subject") {
    return Object.freeze({
      subjects: Object.freeze({ mode: "per_subject" }),
      periods: Object.freeze({ mode: "always" }),
    });
  }
  if (typeof raw === "string") {
    if (!APPLICABILITY.includes(raw)) throw new AcademicRuleProfileError("INVALID_APPLICABILITY");
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new AcademicRuleProfileError("INVALID_APPLICABILITY");
  }
  rejectCountrySchoolKeys(raw);
  const subjects = parseApplicabilityDimension(raw.subjects ?? "always", SUBJECT_APPLICABILITY_MODES);
  const periods = parseApplicabilityDimension(raw.periods ?? "always", PERIOD_APPLICABILITY_MODES);
  if (periods.mode === "include" || periods.mode === "exclude") {
    for (const id of periods.ids) {
      if (!periodIds.has(id)) throw new AcademicRuleProfileError("INVALID_APPLICABILITY");
    }
  }
  return Object.freeze({
    subjects: Object.freeze(subjects),
    periods: Object.freeze(periods),
  });
}

function validateScoreComponent(component, seen, periodIds) {
  if (!component || typeof component !== "object") {
    throw new AcademicRuleProfileError("INVALID_COMPONENT");
  }
  const id = String(component.id || "").trim();
  if (!id) throw new AcademicRuleProfileError("INVALID_COMPONENT");
  if (seen.has(id)) throw new AcademicRuleProfileError("DUPLICATE_COMPONENT");
  seen.add(id);
  if (!GENERIC_COMPONENT_IDS.includes(id) && !SELECTOR_ID_RE.test(id)) {
    throw new AcademicRuleProfileError("INVALID_COMPONENT_ID");
  }
  const applicability = normalizeApplicability(component.applicability, periodIds);
  if (component.max != null) {
    const max = Number(component.max);
    if (!Number.isFinite(max) || max <= 0) throw new AcademicRuleProfileError("INVALID_MAX");
  }
  if (component.coefficient != null) {
    const coef = Number(component.coefficient);
    if (!Number.isFinite(coef) || coef < 0) throw new AcademicRuleProfileError("INVALID_COEFFICIENT");
  }
  if (component.missing_as_zero === true || component.na_equals_zero === true) {
    throw new AcademicRuleProfileError("NA_MUST_NOT_BE_ZERO");
  }
  return {
    id,
    applicability,
    ...(component.max != null ? { max: Number(component.max) } : {}),
    ...(component.coefficient != null ? { coefficient: Number(component.coefficient) } : {}),
  };
}

function validateSpec(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AcademicRuleProfileError("INVALID_SPEC");
  }
  rejectCountrySchoolKeys(raw);
  const periods = Array.isArray(raw.periods) ? raw.periods : null;
  if (!periods || periods.length < 1) {
    throw new AcademicRuleProfileError("INVALID_PERIODS");
  }
  const normalizedPeriods = periods.map((period, index) => {
    if (typeof period === "string") {
      return { id: period, order: index + 1 };
    }
    if (!period?.id) throw new AcademicRuleProfileError("INVALID_PERIODS");
    const order = period.order == null ? index + 1 : Number(period.order);
    if (!Number.isInteger(order) || order < 1) throw new AcademicRuleProfileError("INVALID_PERIODS");
    return { id: String(period.id), order };
  });
  const orders = normalizedPeriods.map((p) => p.order);
  if (new Set(orders).size !== orders.length) {
    throw new AcademicRuleProfileError("INVALID_PERIODS");
  }

  const componentsIn = Array.isArray(raw.score_components) ? raw.score_components : null;
  if (!componentsIn || componentsIn.length < 1) {
    throw new AcademicRuleProfileError("INVALID_COMPONENTS");
  }
  const periodIdSet = new Set(normalizedPeriods.map((period) => period.id));
  const seen = new Set();
  const score_components = componentsIn.map((c) => validateScoreComponent(c, seen, periodIdSet));

  const missing = raw.missing_score || raw.missing_score_policy;
  if (missing && missing !== MISSING_SCORE_POLICY && missing !== "NOT_APPLICABLE") {
    throw new AcademicRuleProfileError("NA_MUST_NOT_BE_ZERO");
  }

  const rounding = raw.rounding && typeof raw.rounding === "object" ? raw.rounding : { decimals: 2, mode: "half_up" };
  const decimals = rounding.decimals == null ? 2 : Number(rounding.decimals);
  const mode = rounding.mode || "half_up";
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new AcademicRuleProfileError("INVALID_ROUNDING");
  }
  if (!ROUNDING_MODES.includes(mode)) {
    throw new AcademicRuleProfileError("INVALID_ROUNDING");
  }

  const ranking = raw.ranking && typeof raw.ranking === "object" ? raw.ranking : { enabled: false, ties: "competition" };
  const ties = ranking.ties || "competition";
  if (!TIE_STRATEGIES.includes(ties)) {
    throw new AcademicRuleProfileError("INVALID_RANKING");
  }

  let pass_rule = null;
  if (raw.pass_rule != null) {
    const minAverage = Number(raw.pass_rule.min_average ?? raw.pass_rule.threshold);
    if (!Number.isFinite(minAverage) || minAverage < 0) {
      throw new AcademicRuleProfileError("INVALID_PASS_RULE");
    }
    pass_rule = { min_average: minAverage };
  }

  const spec = {
    engine_id: ENGINE_ID,
    layer: LAYERS[0],
    period_mode: raw.period_mode || "term",
    periods: normalizedPeriods,
    annual: raw.annual !== false,
    score_components,
    missing_score: MISSING_SCORE_POLICY,
    rounding: { decimals, mode },
    ranking: { enabled: ranking.enabled !== false, ties },
    ...(pass_rule ? { pass_rule } : {}),
  };
  return spec;
}

function specSha256(spec) {
  return crypto.createHash("sha256").update(canonicalize(spec), "utf8").digest("hex");
}

/** N/A n'est jamais 0 : cellule non applicable n'a pas de valeur numérique. */
function resolveScoreCell({ applicable, rawScore }) {
  if (applicable === false) {
    return Object.freeze({ kind: "NOT_APPLICABLE", numericValue: null });
  }
  if (rawScore == null || rawScore === "") {
    return Object.freeze({ kind: "NOT_APPLICABLE", numericValue: null });
  }
  const numericValue = Number(rawScore);
  if (!Number.isFinite(numericValue)) {
    throw new AcademicRuleProfileError("INVALID_SCORE");
  }
  return Object.freeze({ kind: "NUMERIC", numericValue });
}

function assertNaIsNotZero(cell) {
  if (cell.kind === "NOT_APPLICABLE" && cell.numericValue === 0) {
    throw new AcademicRuleProfileError("NA_MUST_NOT_BE_ZERO");
  }
}

function dimensionApplies(dimension, { id, runtimeFlag } = {}) {
  if (!dimension || dimension.mode === "always") return true;
  if (dimension.mode === "never") return false;
  if (dimension.mode === "per_subject") return runtimeFlag === true;
  if (id == null || id === "") return false;
  if (dimension.mode === "include") return dimension.ids.includes(id);
  if (dimension.mode === "exclude") return !dimension.ids.includes(id);
  return false;
}

function componentApplies(component, { subjectId, periodId, subjectApplicable } = {}) {
  const applicability = component?.applicability;
  const canonical =
    applicability && typeof applicability === "object" && !Array.isArray(applicability)
      ? applicability
      : normalizeApplicability(applicability, new Set(periodId ? [periodId] : []));
  return (
    dimensionApplies(canonical.subjects, { id: subjectId, runtimeFlag: subjectApplicable }) &&
    dimensionApplies(canonical.periods, { id: periodId })
  );
}

module.exports = {
  ENGINE_ID,
  PROFILE_STATUSES,
  APPLICABILITY,
  SUBJECT_APPLICABILITY_MODES,
  PERIOD_APPLICABILITY_MODES,
  TIE_STRATEGIES,
  ROUNDING_MODES,
  MISSING_SCORE_POLICY,
  GENERIC_COMPONENT_IDS,
  AcademicRuleProfileError,
  requireSchoolId,
  assertSameTenant,
  validateSpec,
  specSha256,
  resolveScoreCell,
  assertNaIsNotZero,
  componentApplies,
};
