"use strict";

/**
 * LOT 2 — ReportCardSchema (structure sémantique), versionné, tenant-safe.
 * Pas de calcul métier, pas de RenderingTemplate, pas de moteur / PDF /verify.
 */

const crypto = require("node:crypto");
const { canonicalize } = require("../../contracts/reportCard/jcs");
const { ENGINE_ID, LAYERS } = require("../../contracts/reportCard/contract");

const SCHEMA_STATUSES = Object.freeze(["DRAFT", "ACTIVE", "SUPERSEDED", "ARCHIVED"]);
const SECTION_KINDS = Object.freeze([
  "identity",
  "subject_groups",
  "subject_rows",
  "totals",
  "rank",
  "decision",
  "observations",
  "signatures",
]);
const COLUMN_KINDS = Object.freeze([
  "identity",
  "score_component",
  "period",
  "computed_slot",
  "observation",
  "signature",
]);
const ROW_KINDS = Object.freeze(["group", "subject", "slot"]);
const SLOT_IDS = Object.freeze([
  "TOTAL",
  "SUBTOTAL",
  "RANK",
  "DECISION",
  "OBSERVATION",
  "PERCENTAGE",
  "ANNUAL_MAX",
  "ANNUAL_POINTS",
  "PERIOD_MAX",
  "PERIOD_POINTS",
]);
const SELECTOR_ID_RE = /^[A-Z][A-Z0-9_]{0,31}$/;
const CALCULATION_KEYS = new Set([
  "formula",
  "expression",
  "coefficient",
  "max",
  "rounding",
  "ranking",
  "average",
  "sum",
  "weight",
  "na_equals_zero",
  "missing_score",
  "missing_as_zero",
  "pass_rule",
]);
const RENDERING_KEYS = new Set([
  "color",
  "colour",
  "font",
  "css",
  "margin",
  "padding",
  "pixel",
  "width_mm",
  "height_mm",
  "accent",
  "paper",
  "orientation",
  "layout",
]);

class ReportCardSchemaError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ReportCardSchemaError";
    this.code = code;
  }
}

function requireSchoolId(schoolId) {
  if (schoolId == null || schoolId === "") {
    throw new ReportCardSchemaError("TENANT_REQUIRED");
  }
  return schoolId;
}

function assertSameTenant(schoolId, actorSchoolId) {
  requireSchoolId(schoolId);
  requireSchoolId(actorSchoolId);
  if (actorSchoolId !== schoolId) {
    throw new ReportCardSchemaError("TENANT_MISMATCH");
  }
}

function rejectForbiddenKeys(value) {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectForbiddenKeys(item);
    return;
  }
  for (const key of Object.keys(value)) {
    if (/^(country|country_id|countryCode|country_code|iso_code|school|school_id|school_name|schoolName)$/i.test(key)) {
      throw new ReportCardSchemaError("COUNTRY_SCHOOL_BRANCH_FORBIDDEN", `forbidden key ${key}`);
    }
    if (CALCULATION_KEYS.has(key)) {
      throw new ReportCardSchemaError("CALCULATION_FORBIDDEN", `forbidden key ${key}`);
    }
    if (RENDERING_KEYS.has(key)) {
      throw new ReportCardSchemaError("RENDERING_FORBIDDEN", `forbidden key ${key}`);
    }
    rejectForbiddenKeys(value[key]);
  }
}

function requireId(raw, code = "INVALID_SPEC") {
  const id = String(raw || "").trim();
  if (!SELECTOR_ID_RE.test(id)) throw new ReportCardSchemaError(code);
  return id;
}

function sortByOrder(items) {
  return [...items].sort((a, b) => a.order - b.order);
}

function assertUniqueOrders(items) {
  const orders = items.map((item) => item.order);
  if (new Set(orders).size !== orders.length) {
    throw new ReportCardSchemaError("INVALID_ORDER");
  }
}

function assertUniqueIds(ids) {
  if (new Set(ids).size !== ids.length) {
    throw new ReportCardSchemaError("DUPLICATE_ID");
  }
}

function normalizeOrder(raw, fallback) {
  const order = raw == null ? fallback : Number(raw);
  if (!Number.isInteger(order) || order < 1) throw new ReportCardSchemaError("INVALID_ORDER");
  return order;
}

function normalizeColumn(raw, index) {
  if (!raw || typeof raw !== "object") throw new ReportCardSchemaError("INVALID_COLUMNS");
  const id = requireId(raw.id, "INVALID_COLUMNS");
  const kind = String(raw.kind || "").trim();
  if (!COLUMN_KINDS.includes(kind)) throw new ReportCardSchemaError("INVALID_COLUMNS");
  const column = {
    id,
    order: normalizeOrder(raw.order, index + 1),
    kind,
  };
  if (kind === "score_component") {
    column.score_component_id = requireId(raw.score_component_id, "INVALID_COLUMNS");
  } else if (raw.score_component_id != null) {
    throw new ReportCardSchemaError("INVALID_COLUMNS");
  }
  if (kind === "period") {
    column.period_id = requireId(raw.period_id, "INVALID_COLUMNS");
  } else if (raw.period_id != null) {
    throw new ReportCardSchemaError("INVALID_COLUMNS");
  }
  if (kind === "computed_slot") {
    const slot = String(raw.slot || "").trim();
    if (!SLOT_IDS.includes(slot)) throw new ReportCardSchemaError("INVALID_COLUMNS");
    column.slot = slot;
  }
  return column;
}

function normalizeRow(raw, index) {
  if (!raw || typeof raw !== "object") throw new ReportCardSchemaError("INVALID_ROWS");
  const kind = String(raw.kind || "").trim();
  if (!ROW_KINDS.includes(kind)) throw new ReportCardSchemaError("INVALID_ROWS");
  return {
    id: requireId(raw.id, "INVALID_ROWS"),
    order: normalizeOrder(raw.order, index + 1),
    kind,
  };
}

function normalizeField(raw, index) {
  if (!raw || typeof raw !== "object") throw new ReportCardSchemaError("INVALID_SPEC");
  return {
    id: requireId(raw.id),
    order: normalizeOrder(raw.order, index + 1),
  };
}

function normalizeSection(raw, index) {
  if (!raw || typeof raw !== "object") throw new ReportCardSchemaError("INVALID_SECTIONS");
  const kind = String(raw.kind || "").trim();
  if (!SECTION_KINDS.includes(kind)) throw new ReportCardSchemaError("INVALID_SECTIONS");
  const columnsIn = Array.isArray(raw.columns) ? raw.columns : null;
  if (!columnsIn || columnsIn.length < 1) throw new ReportCardSchemaError("INVALID_COLUMNS");
  const columns = columnsIn.map((column, columnIndex) => normalizeColumn(column, columnIndex));
  assertUniqueOrders(columns);
  assertUniqueIds(columns.map((column) => column.id));
  const rowsIn = Array.isArray(raw.rows) ? raw.rows : [];
  const rows = rowsIn.map((row, rowIndex) => normalizeRow(row, rowIndex));
  assertUniqueOrders(rows);
  assertUniqueIds(rows.map((row) => row.id));
  return {
    id: requireId(raw.id, "INVALID_SECTIONS"),
    order: normalizeOrder(raw.order, index + 1),
    kind,
    columns: sortByOrder(columns),
    ...(rows.length ? { rows: sortByOrder(rows) } : {}),
  };
}

function validateSpec(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ReportCardSchemaError("INVALID_SPEC");
  }
  rejectForbiddenKeys(raw);
  const sectionsIn = Array.isArray(raw.sections) ? raw.sections : null;
  if (!sectionsIn || sectionsIn.length < 1) throw new ReportCardSchemaError("INVALID_SECTIONS");
  const sections = sectionsIn.map((section, index) => normalizeSection(section, index));
  assertUniqueOrders(sections);
  assertUniqueIds(sections.map((section) => section.id));
  const identity_fields = (Array.isArray(raw.identity_fields) ? raw.identity_fields : []).map(normalizeField);
  const metadata_fields = (Array.isArray(raw.metadata_fields) ? raw.metadata_fields : []).map(normalizeField);
  assertUniqueOrders(identity_fields);
  assertUniqueIds(identity_fields.map((field) => field.id));
  assertUniqueOrders(metadata_fields);
  assertUniqueIds(metadata_fields.map((field) => field.id));
  return {
    engine_id: ENGINE_ID,
    layer: LAYERS[1],
    sections: sortByOrder(sections),
    identity_fields: sortByOrder(identity_fields),
    metadata_fields: sortByOrder(metadata_fields),
  };
}

function specSha256(spec) {
  return crypto.createHash("sha256").update(canonicalize(spec), "utf8").digest("hex");
}

function validateAgainstProfile(schemaSpec, profileSpec) {
  const spec = schemaSpec?.layer === "ReportCardSchema" ? schemaSpec : validateSpec(schemaSpec);
  if (!profileSpec || typeof profileSpec !== "object") {
    throw new ReportCardSchemaError("INVALID_PROFILE_REFERENCE");
  }
  const periodIds = new Set(
    (Array.isArray(profileSpec.periods) ? profileSpec.periods : []).map((period) =>
      typeof period === "string" ? period : period?.id
    )
  );
  const componentIds = new Set(
    (Array.isArray(profileSpec.score_components) ? profileSpec.score_components : []).map((component) => component?.id)
  );
  for (const section of spec.sections) {
    for (const column of section.columns) {
      if (column.period_id && !periodIds.has(column.period_id)) {
        throw new ReportCardSchemaError("INVALID_PROFILE_REFERENCE");
      }
      if (column.score_component_id && !componentIds.has(column.score_component_id)) {
        throw new ReportCardSchemaError("INVALID_PROFILE_REFERENCE");
      }
    }
  }
  return spec;
}

module.exports = {
  ENGINE_ID,
  SCHEMA_STATUSES,
  SECTION_KINDS,
  COLUMN_KINDS,
  ROW_KINDS,
  SLOT_IDS,
  ReportCardSchemaError,
  requireSchoolId,
  assertSameTenant,
  validateSpec,
  validateAgainstProfile,
  specSha256,
};
