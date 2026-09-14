"use strict";

/**
 * LOT 5 — PDF imprimable et QR stratégie A, après publication LOT 4 durable.
 * Consomme payloadForRender. Aucun mint de token, aucun recalcul, aucune UI.
 */

const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");
const { PRINT_CONTRACT } = require("../../contracts/reportCard/contract");
const { normalizeRenderingTemplate } = require("./renderingTemplate");

const TEMPLATE_DIR = path.join(__dirname, "../../templates/reportCard");
const PRINT_FONT_FAMILY = "SomafrikReportCard";
const PRINT_FONT_PATH = path.join(TEMPLATE_DIR, "fonts/LiberationSans-Regular.ttf");
const QR_PRINT_MM = 30;
const QR_DPI = 300;

class ReportCardPdfError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ReportCardPdfError";
    this.code = code;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attr(name, value) {
  if (value == null || value === "") return "";
  return ` ${name}="${escapeHtml(value)}"`;
}

function decodeQrPng(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!result || result.data == null || result.data === "") {
    throw new ReportCardPdfError("QR_UNREADABLE");
  }
  return result.data;
}

async function buildPrintableQr(url) {
  const width = Math.round((QR_PRINT_MM / 25.4) * QR_DPI);
  const png = await QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: PRINT_CONTRACT.ecc,
    margin: PRINT_CONTRACT.quiet_zone_modules,
    width,
    color: { dark: "#000000", light: "#ffffff" },
  });
  const decoded = decodeQrPng(png);
  if (decoded !== url) {
    throw new ReportCardPdfError("QR_SCAN_MISMATCH");
  }
  return {
    png,
    dataUrl: `data:image/png;base64,${png.toString("base64")}`,
    url,
    decoded,
    ecc: PRINT_CONTRACT.ecc,
    quietZoneModules: PRINT_CONTRACT.quiet_zone_modules,
    printSizeMm: QR_PRINT_MM,
  };
}

function cellLabel(cell) {
  if (!cell || typeof cell !== "object") return "";
  if (cell.exposed != null) return String(cell.exposed);
  if (cell.kind === "NOT_APPLICABLE") return "N/A";
  return cell.kind == null ? "" : String(cell.kind);
}

function slotLabel(slot) {
  if (!slot || typeof slot !== "object") return "";
  if (slot.kind === "DECISION") {
    const decision = slot.passed === true ? "PASS" : slot.passed === false ? "FAIL" : "";
    const metric = slot.exposed != null ? String(slot.exposed) : "";
    return [metric, decision].filter(Boolean).join(" ");
  }
  return cellLabel(slot);
}

function presenceLabel(entry) {
  const parts = [entry.section_id, entry.column_id, entry.row_id, entry.field_kind, entry.field_id].filter(
    (part) => part != null && part !== ""
  );
  return parts.join(" ");
}

function renderCellRows(student) {
  return (student.cells || [])
    .map(
      (cell) => `<tr>
        <td>${escapeHtml(cell.subject_id)}</td>
        <td>${escapeHtml(cell.period_id)}</td>
        <td>${escapeHtml(cell.score_component_id)}</td>
        <td>${escapeHtml(cellLabel(cell))}</td>
      </tr>`
    )
    .join("\n");
}

function matchingSlots(student, sectionId) {
  const slots = student.slots || [];
  const filtered = slots.filter((slot) => slot.section_id === sectionId);
  return filtered.length ? filtered : slots;
}

function matchingPresence(student, sectionId) {
  const presence = student.presence || [];
  const filtered = presence.filter((entry) => entry.section_id === sectionId);
  return filtered.length ? filtered : presence;
}

function renderSlotRows(slots) {
  return slots
    .map(
      (slot) => `<tr data-slot="${escapeHtml(slot.slot)}"${attr("data-section", slot.section_id)}>
        <td>${escapeHtml(slot.slot)}</td>
        <td>${escapeHtml(slotLabel(slot))}</td>
      </tr>`
    )
    .join("\n");
}

function renderPresenceItems(presence) {
  return presence
    .map(
      (entry) =>
        `<li data-presence${attr("data-section", entry.section_id)}${attr("data-column", entry.column_id)}${attr(
          "data-row",
          entry.row_id
        )} data-applicable="${entry.applicable === true ? "true" : "false"}">${escapeHtml(presenceLabel(entry))}</li>`
    )
    .join("\n");
}

function wrapTemplateSection(section, inner) {
  return `<section data-template-section="${escapeHtml(section.id)}"${attr("data-section", section.id)}>
      <h3>${escapeHtml(section.label)}</h3>
      ${inner}
    </section>`;
}

function renderStudentFromTemplate(student, template) {
  const blocks = template.sections
    .map((section) => {
      if (section.source === "cells") {
        return wrapTemplateSection(
          section,
          `<table class="cells" data-cells>
        <thead><tr><th>subject</th><th>period</th><th>component</th><th>value</th></tr></thead>
        <tbody>${renderCellRows(student)}</tbody>
      </table>`
        );
      }
      if (section.source === "slots") {
        return wrapTemplateSection(
          section,
          `<table class="slots" data-slots>
        <thead><tr><th>slot</th><th>value</th></tr></thead>
        <tbody>${renderSlotRows(matchingSlots(student, section.id))}</tbody>
      </table>`
        );
      }
      return wrapTemplateSection(
        section,
        `<ul class="presence">${renderPresenceItems(matchingPresence(student, section.id))}</ul>`
      );
    })
    .join("\n");
  return `<section>
      <h2>${escapeHtml(student.student_id)}</h2>
      ${blocks}
    </section>`;
}

function renderStudentFallback(student) {
  return `<section>
      <h2>${escapeHtml(student.student_id)}</h2>
      <table class="cells" data-cells>
        <thead><tr><th>subject</th><th>period</th><th>component</th><th>value</th></tr></thead>
        <tbody>${renderCellRows(student)}</tbody>
      </table>
      <table class="slots" data-slots>
        <thead><tr><th>slot</th><th>value</th></tr></thead>
        <tbody>${renderSlotRows(student.slots || [])}</tbody>
      </table>
      <ul class="presence">${renderPresenceItems(student.presence || [])}</ul>
    </section>`;
}

function renderStudentTables(payload, template) {
  const students = Array.isArray(payload.students) ? payload.students : [];
  return students
    .map((student) => (template ? renderStudentFromTemplate(student, template) : renderStudentFallback(student)))
    .join("\n");
}

function embeddedFontCss() {
  if (!fs.existsSync(PRINT_FONT_PATH)) {
    throw new ReportCardPdfError("PDF_FONT_UNAVAILABLE");
  }
  const bytes = fs.readFileSync(PRINT_FONT_PATH);
  if (!bytes.length) {
    throw new ReportCardPdfError("PDF_FONT_UNAVAILABLE");
  }
  return `@font-face {
  font-family: "${PRINT_FONT_FAMILY}";
  src: url("data:font/ttf;base64,${bytes.toString("base64")}") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
`;
}

function buildHtml(payload, qr, template) {
  const htmlTemplate = fs.readFileSync(path.join(TEMPLATE_DIR, "canonical.html"), "utf8");
  const css = `${embeddedFontCss()}${fs.readFileSync(path.join(TEMPLATE_DIR, "canonical.css"), "utf8")}`;
  return htmlTemplate
    .replaceAll("{{INLINE_CSS}}", css)
    .replaceAll("{{REPORT_CARD_ID}}", escapeHtml(payload.report_card_id))
    .replaceAll("{{VERSION}}", escapeHtml(payload.published_snapshot_version))
    .replaceAll("{{PUBLISHED_AT}}", escapeHtml(payload.published_at))
    .replaceAll("{{STUDENTS}}", renderStudentTables(payload, template))
    .replaceAll("{{QR_DATA_URL}}", qr.dataUrl)
    .replaceAll("{{QR_URL}}", escapeHtml(qr.url));
}

function assertHtmlString(html) {
  if (typeof html !== "string" || html.trim() === "") {
    throw new ReportCardPdfError("PDF_RENDER_FAILED", "html string required");
  }
  return html;
}

async function rasterQrAfterLayout(page, qr) {
  const handle = await page.$(".qr");
  if (!handle) {
    throw new ReportCardPdfError("QR_UNREADABLE");
  }
  const raster = await handle.screenshot({ type: "png", omitBackground: false });
  const rasterQrDecoded = decodeQrPng(Buffer.from(raster));
  if (qr && qr.url && rasterQrDecoded !== qr.url) {
    throw new ReportCardPdfError("QR_SCAN_MISMATCH");
  }
  return rasterQrDecoded;
}

async function resolveEmbeddedFont(page) {
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate((family) => {
    const faces = [...document.fonts];
    const embedded = faces.some((face) => face.family.replace(/["']/g, "") === family && face.status === "loaded");
    return embedded && document.fonts.check(`12px "${family}"`);
  }, PRINT_FONT_FAMILY);
  if (!loaded) {
    throw new ReportCardPdfError("PDF_FONT_UNAVAILABLE");
  }
  return { embeddedFontFamily: PRINT_FONT_FAMILY, embeddedFontLoaded: true };
}

async function renderPdfAfterCommit({ html, qr } = {}) {
  const documentHtml = assertHtmlString(html);
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url === "about:blank") {
        req.continue();
        return;
      }
      req.abort();
    });
    await page.setContent(documentHtml, { waitUntil: "domcontentloaded" });
    const font = await resolveEmbeddedFont(page);
    const rasterQrDecoded = await rasterQrAfterLayout(page, qr);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    await page.close();
    return { pdf: Buffer.from(pdf), rasterQrDecoded, ...font };
  } finally {
    await browser.close();
  }
}

function thenable(value, fn) {
  if (value && typeof value.then === "function") return value.then(fn);
  return fn(value);
}

function unwrapDriverResult(result) {
  if (Buffer.isBuffer(result)) {
    return {
      pdf: result,
      rasterQrDecoded: result.rasterQrDecoded,
      embeddedFontFamily: result.embeddedFontFamily,
      embeddedFontLoaded: result.embeddedFontLoaded,
    };
  }
  if (result && Buffer.isBuffer(result.pdf)) {
    return {
      pdf: result.pdf,
      rasterQrDecoded: result.rasterQrDecoded,
      embeddedFontFamily: result.embeddedFontFamily,
      embeddedFontLoaded: result.embeddedFontLoaded,
    };
  }
  throw new ReportCardPdfError("PDF_RENDER_FAILED");
}

function createReportCardPdf({ publication, pdfDriver } = {}) {
  if (!publication || typeof publication.payloadForRender !== "function") {
    throw new ReportCardPdfError("PUBLICATION_REQUIRED");
  }
  const driver = pdfDriver || renderPdfAfterCommit;

  function render({ tenant, reportCardId, version, renderingTemplate, payload: providedPayload } = {}) {
    return Promise.resolve().then(() => {
      const template = normalizeRenderingTemplate(renderingTemplate);
      const payloadSource =
        providedPayload != null
          ? providedPayload
          : publication.payloadForRender({ tenant, reportCardId, version });
      return thenable(payloadSource, (payload) =>
        thenable(publication.reprintUrl({ tenant, reportCardId, version }), (url) =>
          thenable(buildPrintableQr(url), (qr) => {
            const html = buildHtml(payload, qr, template);
            return thenable(driver({ html, qr, payload }), (raw) => {
              const unwrapped = unwrapDriverResult(raw);
              return Object.freeze({
                pdf: unwrapped.pdf,
                html,
                qr: Object.freeze(qr),
                payload,
                ...(unwrapped.rasterQrDecoded != null ? { rasterQrDecoded: unwrapped.rasterQrDecoded } : {}),
                ...(unwrapped.embeddedFontFamily != null
                  ? { embeddedFontFamily: unwrapped.embeddedFontFamily, embeddedFontLoaded: unwrapped.embeddedFontLoaded }
                  : {}),
              });
            });
          })
        )
      );
    });
  }

  return { render };
}

module.exports = {
  createReportCardPdf,
  ReportCardPdfError,
  normalizeRenderingTemplate,
  QR_PRINT_MM,
  PRINT_FONT_FAMILY,
};
