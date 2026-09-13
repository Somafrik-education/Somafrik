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
  assignRanks,
  AGGREGATION_MODE_V1,
  PERCENTAGE_MODE_V1,
  ROUNDING_STAGE_V1,
  RANKING_METRIC_V1,
  PASS_RULE_METRIC_V1,
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
  let maxComplete = true;
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
      maxComplete = false;
    } else {
      maxPoints += contrib.max_points;
    }
  }
  return { points, max_points: maxComplete ? maxPoints : null };
}

function numericSlot(internal, profile) {
  return {
    kind: "NUMERIC",
    internal,
    exposed: roundNumber(internal, profile.rounding.decimals, profile.rounding.mode),
  };
}

function columnScope(section, column) {
  return {
    periodId: column.period_id || section.period_id || null,
    scoreComponentId: column.score_component_id || section.score_component_id || null,
  };
}

function assertSlotContext(profile, section, column) {
  const slot = column.slot;
  const { periodId, scoreComponentId } = columnScope(section, column);
  if (slot === "PERIOD_POINTS" || slot === "PERIOD_MAX") {
    if (!periodId) throw new ReportCardEngineError("INVALID_SLOT_CONTEXT");
  }
  if (slot === "ANNUAL_POINTS" || slot === "ANNUAL_MAX") {
    if (periodId || profile.annual === false) throw new ReportCardEngineError("INVALID_SLOT_CONTEXT");
  }
  if (slot === "SUBTOTAL") {
    if (!periodId && !scoreComponentId) throw new ReportCardEngineError("INVALID_SLOT_CONTEXT");
  }
  if (slot === "TOTAL") {
    if (!periodId && profile.annual === false) throw new ReportCardEngineError("INVALID_SLOT_CONTEXT");
  }
}

function computePercentageValue(profile, cells, scope) {
  const { points, max_points } = aggregateWeighted(profile, cells, scope);
  if (max_points == null) {
    throw new ReportCardEngineError("CALCULABILITY_PERCENTAGE_WITHOUT_MAX");
  }
  try {
    return percentageFromWeighted({ points, max_points });
  } catch (err) {
    wrapEngineError(err, "CALCULABILITY_COEFFICIENT_AGGREGATION");
  }
}

function periodAggregatesFor(profile, cells) {
  const periodIds = [...new Set(cells.map((cell) => cell.period_id))].sort(compareId);
  return periodIds.map((period_id) => {
    const { points, max_points } = aggregateWeighted(profile, cells, { periodId: period_id });
    return { period_id, points, max_points };
  });
}

function cellsFingerprint(cells) {
  return cells
    .map(
      (cell) =>
        `${cell.subject_id}\0${cell.period_id}\0${cell.score_component_id}\0${cell.kind}\0${cell.internal}`
    )
    .sort(compareId)
    .join("\n");
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

function computeSlots(profile, schema, cells, ranksByColumn) {
  const slots = [];
  for (const { section, column } of schemaColumns(schema)) {
    if (column.kind !== "computed_slot") continue;
    assertSlotContext(profile, section, column);
    const scope = columnScope(section, column);
    const identity = {
      section_id: section.id,
      column_id: column.id,
      slot: column.slot,
      ...(scope.periodId ? { period_id: scope.periodId } : {}),
      ...(scope.scoreComponentId ? { score_component_id: scope.scoreComponentId } : {}),
    };
    if (column.slot === "RANK") {
      if (!profile.ranking.enabled) {
        slots.push({ ...identity, kind: "NOT_APPLICABLE", reason: "RANKING_DISABLED" });
        continue;
      }
      const rank = ranksByColumn.get(`${section.id}\0${column.id}`);
      slots.push({ ...identity, kind: "RANK", internal: rank, exposed: rank });
      continue;
    }
    if (column.slot === "PERCENTAGE") {
      const internal = computePercentageValue(profile, cells, scope);
      slots.push({ ...identity, ...numericSlot(internal, profile) });
      continue;
    }
    if (column.slot === "DECISION") {
      const internal = computePercentageValue(profile, cells, scope);
      slots.push({
        ...identity,
        kind: "DECISION",
        metric: PASS_RULE_METRIC_V1,
        threshold: profile.pass_rule.threshold,
        internal,
        exposed: roundNumber(internal, profile.rounding.decimals, profile.rounding.mode),
        passed: internal >= profile.pass_rule.threshold,
      });
      continue;
    }
    if (AGGREGATE_SLOTS.has(column.slot)) {
      const { points, max_points } = aggregateWeighted(profile, cells, scope);
      const isMax = column.slot === "PERIOD_MAX" || column.slot === "ANNUAL_MAX";
      if (isMax && max_points == null) {
        throw new ReportCardEngineError("CALCULABILITY_PERCENTAGE_WITHOUT_MAX");
      }
      const internal = isMax ? max_points : points;
      slots.push({ ...identity, ...numericSlot(internal, profile) });
      continue;
    }
    throw new ReportCardEngineError("INVALID_SLOT_CONTEXT");
  }
  return slots.sort(compareSlot);
}

function validateFactRows(profile, rows, periodIds, componentIds) {
  const seenFacts = new Set();
  for (const row of rows) {
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
}

function groupByStudent(rows) {
  const students = new Map();
  for (const row of rows) {
    if (!students.has(row.student_id)) students.set(row.student_id, []);
    students.get(row.student_id).push(row);
  }
  return students;
}

function buildCells(profile, studentId, rows) {
  return rows
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
}

function computeRanksByColumn(profile, schema, cohortCells) {
  const ranksByStudent = new Map();
  const rankColumns = schemaColumns(schema).filter(
    ({ column }) => column.kind === "computed_slot" && column.slot === "RANK" && profile.ranking.enabled
  );
  const studentIds = [...cohortCells.keys()];
  for (const { section, column } of rankColumns) {
    const keyed = `${section.id}\0${column.id}`;
    const scope = columnScope(section, column);
    const values = studentIds.map((studentId) => ({
      studentId,
      pct: computePercentageValue(profile, cohortCells.get(studentId), scope),
    }));
    values.sort((left, right) => right.pct - left.pct);
    const ranks = assignRanks(
      values.map((item) => item.pct),
      profile.ranking.ties
    );
    values.forEach((item, index) => {
      if (!ranksByStudent.has(item.studentId)) ranksByStudent.set(item.studentId, new Map());
      ranksByStudent.get(item.studentId).set(keyed, ranks[index]);
    });
  }
  return ranksByStudent;
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
  validateFactRows(profile, facts, periodIds, componentIds);
  assertRequestedSlots(profile, schema);

  const rankEnabled = schemaColumns(schema).some(
    ({ column }) => column.kind === "computed_slot" && column.slot === "RANK" && profile.ranking.enabled
  );
  if (rankEnabled) {
    if (!Array.isArray(cohort) || cohort.length < 1) throw new ReportCardEngineError("COHORT_REQUIRED");
    validateFactRows(profile, cohort, periodIds, componentIds);
    assertTenant(tenant, cohort);
  }

  const slotIds = new Set(requestedSlots(schema));
  const students = groupByStudent(facts);
  const factCells = new Map();
  for (const studentId of students.keys()) {
    factCells.set(studentId, buildCells(profile, studentId, students.get(studentId)));
  }

  let ranksByStudent = new Map();
  if (rankEnabled) {
    const cohortGroups = groupByStudent(cohort);
    const cohortCells = new Map();
    for (const studentId of cohortGroups.keys()) {
      cohortCells.set(studentId, buildCells(profile, studentId, cohortGroups.get(studentId)));
    }
    for (const studentId of students.keys()) {
      if (!cohortCells.has(studentId)) throw new ReportCardEngineError("COHORT_INCOMPLETE");
      if (cellsFingerprint(factCells.get(studentId)) !== cellsFingerprint(cohortCells.get(studentId))) {
        throw new ReportCardEngineError("COHORT_MISMATCH");
      }
    }
    ranksByStudent = computeRanksByColumn(profile, schema, cohortCells);
  }

  const calculable = hasCalculableAggregation(profile);
  const studentResults = [...students.keys()].sort(compareId).map((studentId) => {
    const rows = students.get(studentId);
    const cells = factCells.get(studentId);
    const ctx = {
      periodIds: new Set(rows.map((row) => row.period_id)),
      componentIds: new Set(rows.map((row) => row.score_component_id)),
      slotIds,
    };
    const presence = collectPresence(schema, ctx);
    const slots = computeSlots(profile, schema, cells, ranksByStudent.get(studentId) || new Map());
    const result = { student_id: studentId, cells, slots, presence };
    if (calculable) {
      const period_aggregates = periodAggregatesFor(profile, cells);
      result.period_aggregates = period_aggregates;
      if (profile.annual !== false) {
        result.annual = {
          points: period_aggregates.reduce((acc, row) => acc + row.points, 0),
          max_points: period_aggregates.some((row) => row.max_points == null)
            ? null
            : period_aggregates.reduce((acc, row) => acc + row.max_points, 0),
        };
      }
    }
    return result;
  });

  const output = {
    engine_id: ENGINE_ID,
    provenance: provenance
      ? {
          profile: provenance.profile || null,
          schema: provenance.schema || null,
        }
      : null,
    students: studentResults,
  };
  if (tenantOut) output.tenant = tenantOut;
  return output;
}

module.exports = {
  ENGINE_ID,
  ReportCardEngineError,
  computeReportCard,
};
