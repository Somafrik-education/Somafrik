"use strict";

/**
 * LOT 3 — moteur canonique somafrik.report_card.v1 (pur, déterministe).
 * Consomme AcademicRuleProfile LOT 1.1 + ReportCardSchema. Aucun snapshot / QR / PDF / publication.
 * Profils historiques / non calculables : fail-closed, aucune convention inventée.
 */

const { ENGINE_ID } = require("../../contracts/reportCard/contract");
const {
  validateSpec: validateProfileSpec,
  componentApplies,
  resolveScoreCell,
  requireSchoolId,
  assertSameTenant,
  weightedContribution,
  percentageFromWeighted,
  isCalculablePassRule,
  assertScoreBounds,
  AGGREGATION_MODE_V1,
  PERCENTAGE_MODE_V1,
  ROUNDING_STAGE_V1,
  RANKING_METRIC_V1,
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

function wrapEngineError(err, fallback) {
  throw new ReportCardEngineError(err.code || fallback, err.message);
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
  try {
    return validateProfileSpec(raw);
  } catch (err) {
    wrapEngineError(err, "INVALID_PROFILE");
  }
}

function requireSchema(raw) {
  try {
    return validateSchemaSpec(raw);
  } catch (err) {
    wrapEngineError(err, "INVALID_SCHEMA");
  }
}

function hasCalculableAggregation(profile) {
  return (
    profile?.aggregation?.mode === AGGREGATION_MODE_V1 &&
    profile?.aggregation?.percentage === PERCENTAGE_MODE_V1 &&
    profile?.rounding?.stage === ROUNDING_STAGE_V1
  );
}

function requireNonEmptyId(value, code = "INVALID_FACTS") {
  if (value == null || String(value).trim() === "") {
    throw new ReportCardEngineError(code);
  }
  return value;
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
  return String(a ?? "").localeCompare(String(b ?? ""));
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

function factSemanticKey(row) {
  return `${row.student_id}\0${row.subject_id}\0${row.period_id}\0${row.score_component_id}`;
}

function assertRequestedSlots(profile, schema) {
  const calculableAgg = hasCalculableAggregation(profile);
  for (const { column } of schemaColumns(schema)) {
    if (column.kind !== "computed_slot") continue;
    const slot = column.slot;
    if (slot === "RANK") {
      if (profile.ranking.enabled) {
        if (profile.ranking.metric !== RANKING_METRIC_V1 || !calculableAgg) {
          throw new ReportCardEngineError("CALCULABILITY_RANKING_METRIC");
        }
      }
      continue;
    }
    if (slot === "DECISION") {
      if (!isCalculablePassRule(profile) || !calculableAgg) {
        throw new ReportCardEngineError("CALCULABILITY_PASS_RULE_SCALE");
      }
      continue;
    }
    if (slot === "PERCENTAGE") {
      if (!calculableAgg) {
        if (profile.score_components.some((component) => component.max == null)) {
          throw new ReportCardEngineError("CALCULABILITY_PERCENTAGE_WITHOUT_MAX");
        }
        throw new ReportCardEngineError("CALCULABILITY_COEFFICIENT_AGGREGATION");
      }
      continue;
    }
    if (AGGREGATE_SLOTS.has(slot) && !calculableAgg) {
      throw new ReportCardEngineError("CALCULABILITY_COEFFICIENT_AGGREGATION");
    }
  }
}

function aggregateWeighted(profile, cells, { periodId, scoreComponentId } = {}) {
  let points = 0;
  let maxPoints = 0;
  for (const cell of cells) {
    if (periodId && cell.period_id !== periodId) continue;
    if (scoreComponentId && cell.score_component_id !== scoreComponentId) continue;
    if (cell.kind !== "NUMERIC") continue;
    const component = componentById(profile, cell.score_component_id);
    let contrib;
    try {
      contrib = weightedContribution({
        numericScore: cell.internal,
        component,
        aggregation: profile.aggregation,
      });
    } catch (err) {
      wrapEngineError(err, "CALCULABILITY_COEFFICIENT_AGGREGATION");
    }
    points += contrib.points;
    if (contrib.max_points == null) {
      throw new ReportCardEngineError("CALCULABILITY_PERCENTAGE_WITHOUT_MAX");
    }
    maxPoints += contrib.max_points;
  }
  return { points, max_points: maxPoints };
}

function computePercentageValue(profile, cells, column) {
  const { points, max_points } = aggregateWeighted(profile, cells, {
    periodId: column.period_id,
    scoreComponentId: column.score_component_id,
  });
  try {
    const internal = percentageFromWeighted({ points, max_points });
    return {
      kind: "NUMERIC",
      internal,
      exposed: roundNumber(internal, profile.rounding.decimals, profile.rounding.mode),
    };
  } catch (err) {
    wrapEngineError(err, "CALCULABILITY_COEFFICIENT_AGGREGATION");
  }
}

function comparePresence(a, b) {
  return (
    compareId(a.section_id, b.section_id) ||
    compareId(a.column_id, b.column_id) ||
    compareId(a.row_id, b.row_id) ||
    compareId(a.field_kind, b.field_kind) ||
    compareId(a.field_id, b.field_id)
  );
}

function compareSlot(a, b) {
  return (
    compareId(a.section_id, b.section_id) ||
    compareId(a.column_id, b.column_id) ||
    compareId(a.slot, b.slot) ||
    compareId(a.period_id, b.period_id) ||
    compareId(a.score_component_id, b.score_component_id)
  );
}

function collectPresence(schema, ctx) {
  const presence = [];
  for (const section of schema.sections) {
    presence.push({
      section_id: section.id,
      applicable: evaluateWhen(section.presence?.when, ctx),
    });
    for (const column of section.columns) {
      presence.push({
        section_id: section.id,
        column_id: column.id,
        applicable: evaluateWhen(column.presence?.when, ctx),
      });
    }
    for (const row of section.rows || []) {
      presence.push({
        section_id: section.id,
        row_id: row.id,
        applicable: evaluateWhen(row.presence?.when, ctx),
      });
    }
  }
  for (const field of schema.identity_fields || []) {
    presence.push({
      field_kind: "identity",
      field_id: field.id,
      applicable: evaluateWhen(field.presence?.when, ctx),
    });
  }
  for (const field of schema.metadata_fields || []) {
    presence.push({
      field_kind: "metadata",
      field_id: field.id,
      applicable: evaluateWhen(field.presence?.when, ctx),
    });
  }
  return presence.sort(comparePresence);
}

function computeSlots(profile, schema, cells) {
  const slots = [];
  for (const { section, column } of schemaColumns(schema)) {
    if (column.kind !== "computed_slot") continue;
    const identity = {
      section_id: section.id,
      column_id: column.id,
      slot: column.slot,
      ...(column.period_id ? { period_id: column.period_id } : {}),
      ...(column.score_component_id ? { score_component_id: column.score_component_id } : {}),
    };
    if (column.slot === "RANK" && !profile.ranking.enabled) {
      slots.push({ ...identity, kind: "NOT_APPLICABLE", reason: "RANKING_DISABLED" });
      continue;
    }
    if (column.slot === "PERCENTAGE") {
      const value = computePercentageValue(profile, cells, column);
      slots.push({ ...identity, ...value });
      continue;
    }
    throw new ReportCardEngineError("CALCULABILITY_COEFFICIENT_AGGREGATION");
  }
  return slots.sort(compareSlot);
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
  const seenFacts = new Set();
  for (const row of facts) {
    if (!row || typeof row !== "object") throw new ReportCardEngineError("INVALID_FACTS");
    requireNonEmptyId(row.student_id);
    requireNonEmptyId(row.subject_id);
    if (!periodIds.has(row.period_id) || !componentIds.has(row.score_component_id)) {
      throw new ReportCardEngineError("INVALID_FACTS");
    }
    const component = componentById(profile, row.score_component_id);
    if (component?.applicability?.subjects?.mode === "per_subject" && typeof row.subject_applicable !== "boolean") {
      throw new ReportCardEngineError("INVALID_FACTS");
    }
    if (row.raw_score != null && row.raw_score !== "") {
      const numeric = Number(row.raw_score);
      if (!Number.isFinite(numeric)) throw new ReportCardEngineError("INVALID_FACTS");
    }
    const key = factSemanticKey(row);
    if (seenFacts.has(key)) throw new ReportCardEngineError("DUPLICATE_FACT");
    seenFacts.add(key);
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
        if (resolved.kind === "NUMERIC") {
          try {
            assertScoreBounds({ numericScore: resolved.numericValue, max: component?.max });
          } catch (err) {
            wrapEngineError(err, "INVALID_FACTS");
          }
        }
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
    const presence = collectPresence(schema, ctx);
    const slots = computeSlots(profile, schema, cells);

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
