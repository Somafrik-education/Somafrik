const fs = require("fs");
const path = require("path");

const TEMPLATE_DIR = path.join(__dirname, "..", "templates", "bulletin");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readAsset(relativePath) {
  return fs.readFileSync(path.join(TEMPLATE_DIR, relativePath), "utf8");
}

function loadLogoDataUrl(logoPath) {
  try {
    const buffer = fs.readFileSync(logoPath);
    const ext = path.extname(logoPath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return "";
  }
}

function buildSubjectRows(subjects) {
  const rows = subjects?.length
    ? subjects
    : [{ subject: "Aucune note publiée", average: 0, coefficient: 0 }];

  return rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.subject)}</td>
        <td class="num">${Number(row.average ?? 0).toFixed(2)}</td>
        <td class="num">${escapeHtml(row.coefficient ?? 1)}</td>
      </tr>`,
    )
    .join("\n");
}

function buildVerificationPayload(report, school) {
  const student = report.student ?? {};
  return JSON.stringify({
    v: 1,
    type: "bulletin",
    id: report.id,
    schoolCode: school.code,
    matricule: student.matricule ?? student.publicId ?? "",
    period: report.period,
    average: Number(report.average ?? 0).toFixed(2),
    generatedAt: report.generatedAt,
  });
}

function applyReplacements(template, replacements) {
  return Object.entries(replacements).reduce(
    (html, [token, value]) => html.replaceAll(token, value),
    template,
  );
}

function resolveTemplateSources(design = {}) {
  const customHtml = String(design.htmlTemplate ?? "").trim();
  if (customHtml) {
    return {
      htmlTemplate: customHtml,
      css: String(design.cssTemplate ?? ""),
      isCustom: true,
    };
  }
  return {
    htmlTemplate: readAsset("report-card.html"),
    css: readAsset("report-card.css"),
    isCustom: false,
  };
}

function wrapCustomHtmlDocument(htmlTemplate, css) {
  const trimmed = htmlTemplate.trim();
  if (/^<!doctype html>/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    if (trimmed.includes("{{INLINE_CSS}}")) {
      return trimmed.replace("{{INLINE_CSS}}", css);
    }
    if (/<\/head>/i.test(trimmed)) {
      return trimmed.replace(/<\/head>/i, `<style>${css}</style></head>`);
    }
    return trimmed;
  }
  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <title>Bulletin scolaire — {{STUDENT_NAME}}</title>
    <style>${css}</style>
  </head>
  <body>${trimmed}</body>
</html>`;
}

function renderReportCardHtml({ report, school, qrCodeDataUrl, logoPath }) {
  const student = report.student ?? {};
  const design = report.design ?? {};
  const { htmlTemplate, css, isCustom } = resolveTemplateSources(design);
  const logoDataUrl = loadLogoDataUrl(logoPath);
  const logoHtml = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="Logo ${escapeHtml(school.name)}" />`
    : "";

  const status = String(report.status ?? "Publié");
  const statusClass = status.toLowerCase().includes("publi") ? "" : "draft";
  const showRank = design.showRank !== false && report.rankLabel;
  const showAppreciation = design.showAppreciation !== false && report.appreciation;
  const showQr = design.showQrCode !== false && qrCodeDataUrl;

  const replacements = {
    "{{INLINE_CSS}}": css,
    "{{LOGO_HTML}}": logoHtml,
    "{{SCHOOL_NAME}}": escapeHtml(school.name),
    "{{SCHOOL_CODE}}": escapeHtml(school.code),
    "{{PERIOD}}": escapeHtml(report.period),
    "{{STATUS}}": escapeHtml(status),
    "{{STATUS_CLASS}}": statusClass,
    "{{REPORT_ID}}": escapeHtml(report.id),
    "{{REPORT_TITLE}}": escapeHtml(design.reportTitle ?? "Bulletin scolaire"),
    "{{REPORT_SUBTITLE}}": escapeHtml(design.reportSubtitle ?? "Année académique en cours · Somafrik"),
    "{{STUDENT_NAME}}": escapeHtml(student.name ?? "Élève"),
    "{{STUDENT_MATRICULE}}": escapeHtml(student.matricule ?? student.publicId ?? "—"),
    "{{STUDENT_CLASS}}": escapeHtml(student.className ?? "—"),
    "{{GENERATED_AT}}": escapeHtml(new Date(report.generatedAt).toLocaleDateString("fr-FR")),
    "{{SUBJECT_ROWS}}": buildSubjectRows(report.subjects),
    "{{AVERAGE}}": `${Number(report.average ?? 0).toFixed(2)} / 20`,
    "{{RANK_BLOCK}}": showRank
      ? `<p><strong>Rang :</strong> ${escapeHtml(report.rankLabel ?? "—")}</p>`
      : "",
    "{{APPRECIATION_BLOCK}}": showAppreciation
      ? `<p><strong>Appréciation :</strong> ${escapeHtml(report.appreciation ?? "—")}</p>`
      : "",
    "{{QR_BLOCK}}": showQr
      ? `<div class="qr-box"><img src="${qrCodeDataUrl}" alt="QR code de vérification" /><p>Vérification du bulletin</p></div>`
      : "",
    "{{FOOTER_NOTE}}": escapeHtml(design.footerNote ?? "Document généré automatiquement par Somafrik."),
    "{{VERIFICATION_HINT}}": showQr ? escapeHtml(buildVerificationPayload(report, school)) : "",
  };

  const documentHtml = isCustom ? wrapCustomHtmlDocument(htmlTemplate, css) : htmlTemplate;
  return applyReplacements(documentHtml, replacements);
}

module.exports = {
  buildVerificationPayload,
  renderReportCardHtml,
  TEMPLATE_DIR,
};
