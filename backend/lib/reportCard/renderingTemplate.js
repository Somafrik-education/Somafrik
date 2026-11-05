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
  const normalized = {
    paper,
    orientation,
    qr_required: true,
    sections: Object.freeze(sections),
  };
  // BULLETIN-UI-01 — bloc de présentation OPTIONNEL : absent, la spec normalisée
  // (et donc son empreinte) est strictement celle d'avant ; les gabarits existants
  // et les bulletins déjà publiés ne changent pas.
  if (raw.presentation !== undefined) normalized.presentation = normalizePresentation(raw.presentation);
  return Object.freeze(normalized);
}

const PRESENTATION_STYLES = Object.freeze(["auto", "simple", "hierarchical"]);
const MAX_SIGNATURES = 4;
const MAX_SIGNATURE_LENGTH = 60;

function normalizePresentation(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  }
  const unknown = Object.keys(raw).filter(
    (key) => !["style", "signatures", "failing_ratio", "period_labels", "component_labels", "header"].includes(key)
  );
  if (unknown.length) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID", `unknown presentation key ${unknown[0]}`);
  const style = raw.style == null || raw.style === "" ? "auto" : String(raw.style);
  if (!PRESENTATION_STYLES.includes(style)) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  const signaturesIn = raw.signatures == null ? [] : raw.signatures;
  if (!Array.isArray(signaturesIn) || signaturesIn.length > MAX_SIGNATURES) {
    throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  }
  const signatures = signaturesIn.map((label) => {
    const value = typeof label === "string" ? label.trim() : "";
    if (!value || value.length > MAX_SIGNATURE_LENGTH) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
    return value;
  });
  const out = { style, signatures: Object.freeze(signatures) };
  // Seuil d'affichage des notes en échec (part du maximum de chaque cellule) ; absent : moitié.
  if (raw.failing_ratio !== undefined) {
    const ratio = Number(raw.failing_ratio);
    if (typeof raw.failing_ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
    }
    out.failing_ratio = ratio;
  }
  // BULLETIN-CATALOG-01 — intitulés d'affichage des périodes et des composantes (optionnels).
  if (raw.period_labels !== undefined) out.period_labels = normalizeLabelMap(raw.period_labels);
  if (raw.component_labels !== undefined) out.component_labels = normalizeLabelMap(raw.component_labels);
  // BULLETIN-CLASSE-01 / L3 — en-tête : éléments et disposition en listes fermées, texte limité.
  if (raw.header !== undefined) out.header = normalizeHeader(raw.header);
  return Object.freeze(out);
}

const HEADER_LAYOUTS = Object.freeze(["logo_left", "logo_center", "no_logo"]);
const HEADER_ELEMENTS = Object.freeze([
  "logo",
  "establishment_name",
  "establishment_address",
  "country",
  "academic_year",
  "class",
  "period",
  "student_name",
  "student_code",
]);
const MAX_HEADER_LINES = 4;
const MAX_HEADER_LINE_LENGTH = 80;
const MAX_HEADER_TITLE_LENGTH = 60;

function normalizeHeader(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  }
  const unknown = Object.keys(raw).filter((key) => !["layout", "show", "lines", "title", "title_align"].includes(key));
  if (unknown.length) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID", `unknown header key ${unknown[0]}`);
  const layout = raw.layout == null || raw.layout === "" ? "logo_left" : String(raw.layout);
  if (!HEADER_LAYOUTS.includes(layout)) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  const showIn = raw.show == null ? [] : raw.show;
  if (!Array.isArray(showIn) || showIn.length > HEADER_ELEMENTS.length) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  const show = [];
  for (const item of showIn) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!HEADER_ELEMENTS.includes(id) || show.includes(id)) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
    show.push(id);
  }
  if (layout === "no_logo" && show.includes("logo")) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  const linesIn = raw.lines == null ? [] : raw.lines;
  if (!Array.isArray(linesIn) || linesIn.length > MAX_HEADER_LINES) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  const lines = linesIn.map((line) => {
    const value = typeof line === "string" ? line.trim() : "";
    if (!value || value.length > MAX_HEADER_LINE_LENGTH) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
    return value;
  });
  const title = raw.title == null ? "" : typeof raw.title === "string" ? raw.title.trim() : null;
  if (title === null || title.length > MAX_HEADER_TITLE_LENGTH) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  const titleAlign = raw.title_align;
  if (titleAlign !== undefined && !["left", "center"].includes(titleAlign)) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  // Do not add missing optional keys to historical signed templates.
  return Object.freeze({ layout, show: Object.freeze(show), lines: Object.freeze(lines), title, ...(titleAlign === undefined ? {} : { title_align: titleAlign }) });
}

const MAX_LABELS = 12;
const LABEL_ID_RE = /^[A-Z][A-Z0-9_]{0,31}$/;

function normalizeLabelMap(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  }
  const entries = Object.entries(raw);
  if (entries.length > MAX_LABELS) throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
  const out = {};
  for (const [id, label] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    const value = typeof label === "string" ? label.trim() : "";
    if (!LABEL_ID_RE.test(id) || !value || value.length > MAX_SIGNATURE_LENGTH) {
      throw new RenderingTemplateError("RENDERING_TEMPLATE_INVALID");
    }
    out[id] = value;
  }
  return Object.freeze(out);
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
  PRESENTATION_STYLES,
  HEADER_LAYOUTS,
  HEADER_ELEMENTS,
};
