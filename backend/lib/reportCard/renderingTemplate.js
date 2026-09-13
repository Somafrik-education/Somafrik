"use strict";

/**
 * RenderingTemplate — contrat de spec partagé LOT 5 (PDF) / LOT 6 (persistance).
 * Aucune clé pays/école dans la spec. JCS RFC 8785 + SHA-256.
 */

const crypto = require("node:crypto");
const { canonicalize } = require("../../contracts/reportCard/jcs");

const SECTION_ID_RE = /^[A-Z][A-Z0-9_]{0,31}$/;
const SECTION_SOURCES = Object.freeze(["cells", "slots", "presence"]);

class RenderingTemplateError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "RenderingTemplateError";
    this.code = code;
  }
}

function isForbiddenBranchKey(key) {
  const compact = String(key).replace(/_/g, "").toLowerCase();
  return (
    compact === "country" ||
    compact === "countryid" ||
    compact === "countrycode" ||
    compact === "isocode" ||
    compact === "school" ||
    compact === "schoolid" ||
    compact === "schoolname"
  );
}

function rejectCountrySchoolKeys(value) {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectCountrySchoolKeys(item);
    return;
  }
  for (const key of Object.keys(value)) {
    if (isForbiddenBranchKey(key)) {
      throw new RenderingTemplateError("COUNTRY_SCHOOL_BRANCH_FORBIDDEN", `forbidden key ${key}`);
    }
    rejectCountrySchoolKeys(value[key]);
  }
}

function normalizeRenderingTemplate(raw) {
  if (raw === undefined) return null;
  if (raw == null) {
    throw new RenderingTemplateError("RENDERING_TEMPLATE_REQUIRED");
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  }
  rejectCountrySchoolKeys(raw);
  if (raw.qr_required === false) {
    throw new RenderingTemplateError("QR_REQUIRED");
  }
  const paper = raw.paper == null || raw.paper === "" ? "A4" : String(raw.paper);
  const orientation = raw.orientation == null || raw.orientation === "" ? "portrait" : String(raw.orientation);
  if (paper !== "A4" || orientation !== "portrait") {
    throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  }
  const sectionsIn = Array.isArray(raw.sections) ? raw.sections : null;
  if (!sectionsIn || sectionsIn.length < 1) {
    throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  }
  const seenIds = new Set();
  const seenOrders = new Set();
  const sections = sectionsIn.map((section, index) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
    }
    const id = String(section.id || "").trim();
    if (!SECTION_ID_RE.test(id) || seenIds.has(id)) {
      throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
    }
    seenIds.add(id);
    const order = section.order == null ? index + 1 : Number(section.order);
    if (!Number.isInteger(order) || order < 1 || seenOrders.has(order)) {
      throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
    }
    seenOrders.add(order);
    const source = String(section.source || "").trim();
    if (!SECTION_SOURCES.includes(source)) {
      throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
    }
    const label = String(section.label ?? "").trim();
    if (!label) {
      throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
    }
    return Object.freeze({ id, order, source, label });
  });
  sections.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return Object.freeze({
    paper,
    orientation,
    qr_required: true,
    sections: Object.freeze(sections),
  });
}

function specSha256(spec) {
  return crypto.createHash("sha256").update(canonicalize(spec), "utf8").digest("hex");
}

module.exports = {
  RenderingTemplateError,
  normalizeRenderingTemplate,
  rejectCountrySchoolKeys,
  specSha256,
  SECTION_SOURCES,
};
