"use strict";

/**
 * LOT 3 — moteur canonique somafrik.report_card.v1 (pur, déterministe).
 * Consomme AcademicRuleProfile + ReportCardSchema. Aucun snapshot / QR / PDF / publication.
 * Les agrégats, ranking activé et DECISION fail-closed tant que LOT 1 ne fige pas les formules (voir
 * docs/project/REPORT-CARD-LOT3-CALCULABILITY.md).
 */

const { ENGINE_ID } = require("../../contracts/reportCard/contract");
const {
  validateSpec: validateProfileSpec,
  componentApplies,
  resolveScoreCell,
  requireSchoolId,
  assertSameTenant,
} = require("./academicRuleProfile");
const { validateSpec: validateSchemaSpec, validateAgainstProfile } = require("./reportCardSchema");

const AGGREGATE_SLOTS = new Set([
  "TOTAL",
  "SUBTOTAL",
  "PERIOD_POINTS",
  "PERIOD_MAX",
  "ANNUAL_POINTS",
  "ANNUAL_MAX",
]);

class ReportCardEngineError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ReportCardEngineError";
    this.code = code;
  }
}

function rejectFactBranchKeys(value) {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectFactBranchKeys(item);
    return;
  }
  for (const key of Object.keys(value)) {
    if (/^(country|country_id|countryCode|country_code|iso_code|school|school_name|schoolName)$/i.test(key)) {
      throw new ReportCardEngineError("COUNTRY_SCHOOL_BRANCH_FORBIDDEN", `forbidden key ${key}`);
    }
    if (key !== "school_id") rejectFactBranchKeys(value[key]);
  }
}

function requireProfile(raw) {
  return raw?.layer === "AcademicRuleProfile" ? raw : validateProfileSpec(raw);
}

function requireSchema(raw) {
  return raw?.layer === "ReportCardSchema" ? raw : validateSchemaSpec(raw);
}

function roundNumber(value, decimals, mode) {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const epsilon = 1e-8;
  if (mode === "down") {
    return Math.floor(scaled + epsilon) / factor;
  }
  const floor = Math.floor(scaled + epsilon);
  const fraction = scaled - floor;
  if (mode === "half_up") {
    return (fraction >= 0.5 - epsilon ? floor + 1 : floor) / factor;
  }
  if (fraction > 0.5 + epsilon) return (floor + 1) / factor;
  if (fraction < 0.5 - epsilon) return floor / factor;
  return (floor % 2 === 0 ? floor : floor + 1) / factor;
}

function compareId(a, b) {
  return String(a).localeCompare(String(b));
}

function schemaColumns(schema) {
  const columns = [];
  for (const section of schema.sections) {
    for (const column of section.columns) columns.push({ section, column });
  }
  return columns;
}

function requestedSlots(schema) {
  return schemaColumns(schema)
    .filter(({ column }) => column.kind === "computed_slot")
    .map(({ column }) => column.slot);
}

function evaluateWhen(when, ctx) {
  if (!when) return true;
  if (when.period_id && !ctx.periodIds.has(when.period_id)) return false;
  if (when.score_component_id && !ctx.componentIds.has(when.score_component_id)) return false;
  if (when.slot && !ctx.slotIds.has(when.slot)) return false;
  return true;
}

function assertTenant(tenant, facts) {
  if (!tenant) return null;
  if (tenant.schoolId == null || tenant.schoolId === "" || tenant.actorSchoolId == null || tenant.actorSchoolId === "") {
    throw new ReportCardEngineError("TENANT_REQUIRED");
  }
  try {
    requireSchoolId(tenant.schoolId);
    assertSameTenant(tenant.schoolId, tenant.actorSchoolId);
  } catch (err) {
    throw new ReportCardEngineError(err.code || "TENANT_MISMATCH");
  }
  const schools = new Set(facts.map((item) => item.school_id).filter((id) => id != null && id !== ""));
  if (schools.size > 1) throw new ReportCardEngineError("MIXED_TENANT_FACTS");
  if (schools.size === 1 && !schools.has(tenant.schoolId)) throw new ReportCardEngineError("MIXED_TENANT_FACTS");
  return { school_id: tenant.schoolId };
}

function componentById(profile, id) {
  return profile.score_components.find((component) => component.id === id);
}

function assertRequestedSlots(profile, schema) {
  const slots = requestedSlots(schema);
  const components = profile.score_components;
  for (const slot of slots) {
    if (slot === "RANK") {
      if (profile.ranking.enabled) throw new ReportCardEngineError("CALCULABILITY_RANKING_METRIC");
      continue;
    }
    if (slot === "DECISION") {
      throw new ReportCardEngineError("CALCULABILITY_PASS_RULE_SCALE");
    }
    if (slot === "PERCENTAGE") {
      if (components.some((component) => component.max == null)) {
        throw new ReportCardEngineError("CALCULABILITY_PERCENTAGE_WITHOUT_MAX");
      }
      throw new ReportCardEngineError("CALCULABILITY_COEFFICIENT_AGGREGATION");
    }
    if (AGGREGATE_SLOTS.has(slot)) {
      throw new ReportCardEngineError("CALCULABILITY_COEFFICIENT_AGGREGATION");
    }
  }
}

function computeReportCard(input = {}) {
  const { facts = [], provenance = null, tenant = null, cohort = null } = input;
  if (!Array.isArray(facts)) throw new ReportCardEngineError("INVALID_FACTS");
  rejectFactBranchKeys(facts);
  rejectFactBranchKeys(cohort);
  const profile = requireProfile(input.profile);
  const schema = requireSchema(input.schema);
  try {
    validateAgainstProfile(schema, profile);
  } catch (err) {
    throw new ReportCardEngineError(err.code || "INVALID_PROFILE_REFERENCE");
  }
  const tenantOut = assertTenant(tenant, facts);
  const periodIds = new Set(profile.periods.map((period) => period.id));
  const componentIds = new Set(profile.score_components.map((component) => component.id));
  for (const row of facts) {
    if (!row || typeof row !== "object") throw new ReportCardEngineError("INVALID_FACTS");
    if (!periodIds.has(row.period_id) || !componentIds.has(row.score_component_id)) {
      throw new ReportCardEngineError("INVALID_FACTS");
    }
    if (row.raw_score != null && row.raw_score !== "") {
      const numeric = Number(row.raw_score);
      if (!Number.isFinite(numeric)) throw new ReportCardEngineError("INVALID_FACTS");
    }
  }
  void cohort;
  assertRequestedSlots(profile, schema);

  const slotIds = new Set(requestedSlots(schema));
  const students = new Map();
  for (const row of facts) {
    if (!students.has(row.student_id)) students.set(row.student_id, []);
    students.get(row.student_id).push(row);
  }

  const studentResults = [...students.keys()].sort(compareId).map((studentId) => {
    const rows = students.get(studentId);
    const cells = rows
      .map((row) => {
        const component = componentById(profile, row.score_component_id);
        const applicable = componentApplies(component, {
          subjectId: row.subject_id,
          periodId: row.period_id,
          subjectApplicable: row.subject_applicable,
        });
        const resolved = resolveScoreCell({ applicable, rawScore: row.raw_score });
        const cell = {
          student_id: studentId,
          subject_id: row.subject_id,
          period_id: row.period_id,
          score_component_id: row.score_component_id,
          kind: resolved.kind,
          internal: resolved.numericValue,
        };
        if (resolved.kind === "NUMERIC") {
          cell.exposed = roundNumber(resolved.numericValue, profile.rounding.decimals, profile.rounding.mode);
        } else {
          cell.exposed = null;
        }
        return cell;
      })
      .sort(
        (a, b) =>
          compareId(a.subject_id, b.subject_id) ||
          compareId(a.period_id, b.period_id) ||
          compareId(a.score_component_id, b.score_component_id)
      );

    const ctx = {
      periodIds: new Set(rows.map((row) => row.period_id)),
      componentIds: new Set(rows.map((row) => row.score_component_id)),
      slotIds,
    };
    const presence = {};
    for (const { section, column } of schemaColumns(schema)) {
      presence[section.id] = { applicable: evaluateWhen(section.presence?.when, ctx) };
      presence[column.id] = { applicable: evaluateWhen(column.presence?.when, ctx) };
    }

    const slots = {};
    if (slotIds.has("RANK") && !profile.ranking.enabled) {
      slots.RANK = { kind: "NOT_APPLICABLE", reason: "RANKING_DISABLED" };
    }

    return { student_id: studentId, cells, slots, presence };
  });

  const result = {
    engine_id: ENGINE_ID,
    provenance: provenance
      ? {
          profile: provenance.profile || null,
          schema: provenance.schema || null,
        }
      : null,
    students: studentResults,
  };
  if (tenantOut) result.tenant = tenantOut;
  return result;
}

module.exports = {
  ENGINE_ID,
  ReportCardEngineError,
  computeReportCard,
};
