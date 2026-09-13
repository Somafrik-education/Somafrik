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

const TEMPLATE_DIR = path.join(__dirname, "../../templates/reportCard");
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

function renderStudentTables(payload) {
  const students = Array.isArray(payload.students) ? payload.students : [];
  return students
    .map((student) => {
      const rows = (student.cells || [])
        .map(
          (cell) => `<tr>
        <td>${escapeHtml(cell.subject_id)}</td>
        <td>${escapeHtml(cell.period_id)}</td>
        <td>${escapeHtml(cell.score_component_id)}</td>
        <td>${escapeHtml(cellLabel(cell))}</td>
      </tr>`
        )
        .join("\n");
      return `<section>
      <h2>${escapeHtml(student.student_id)}</h2>
      <table class="cells">
        <thead><tr><th>subject</th><th>period</th><th>component</th><th>value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
    })
    .join("\n");
}

function buildHtml(payload, qr) {
  const htmlTemplate = fs.readFileSync(path.join(TEMPLATE_DIR, "canonical.html"), "utf8");
  const css = fs.readFileSync(path.join(TEMPLATE_DIR, "canonical.css"), "utf8");
  return htmlTemplate
    .replaceAll("{{INLINE_CSS}}", css)
    .replaceAll("{{REPORT_CARD_ID}}", escapeHtml(payload.report_card_id))
    .replaceAll("{{VERSION}}", escapeHtml(payload.published_snapshot_version))
    .replaceAll("{{PUBLISHED_AT}}", escapeHtml(payload.published_at))
    .replaceAll("{{STUDENTS}}", renderStudentTables(payload))
    .replaceAll("{{QR_DATA_URL}}", qr.dataUrl)
    .replaceAll("{{QR_URL}}", escapeHtml(qr.url));
}

async function renderPdfAfterCommit(html) {
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
  });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url === "about:blank") {
        req.continue();
        return;
      }
      req.abort();
    });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    await page.close();
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function thenable(value, fn) {
  if (value && typeof value.then === "function") return value.then(fn);
  return fn(value);
}

function createReportCardPdf({ publication, pdfDriver } = {}) {
  if (!publication || typeof publication.payloadForRender !== "function") {
    throw new ReportCardPdfError("PUBLICATION_REQUIRED");
  }
  const driver = pdfDriver || renderPdfAfterCommit;

  function render({ tenant, reportCardId, version } = {}) {
    return Promise.resolve().then(() =>
      thenable(publication.payloadForRender({ tenant, reportCardId, version }), (payload) =>
        thenable(publication.reprintUrl({ tenant, reportCardId, version }), (url) =>
          thenable(buildPrintableQr(url), (qr) => {
            const html = buildHtml(payload, qr);
            return thenable(driver({ html, qr, payload }), (pdf) =>
              Object.freeze({
                pdf,
                html,
                qr: Object.freeze(qr),
                payload,
              })
            );
          })
        )
      )
    );
  }

  return { render };
}

module.exports = {
  createReportCardPdf,
  ReportCardPdfError,
  QR_PRINT_MM,
};
