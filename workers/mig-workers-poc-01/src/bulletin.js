import { templateCss, templateHtml } from "./bulletinTemplates.js";

const FIXTURE = Object.freeze({
  "{{INLINE_CSS}}": templateCss,
  "{{LOGO_HTML}}": "",
  "{{SCHOOL_NAME}}": "Établissement fictif POC",
  "{{SCHOOL_CODE}}": "POC-WORKERS-01",
  "{{PERIOD}}": "Session POC",
  "{{STATUS}}": "Fictif",
  "{{STATUS_CLASS}}": "draft",
  "{{REPORT_ID}}": "POC-01",
  "{{REPORT_TITLE}}": "Bulletin POC",
  "{{REPORT_SUBTITLE}}": "Donnée fictive — MIG-WORKERS-POC-01",
  "{{STUDENT_NAME}}": "Élève fictif POC-01",
  "{{STUDENT_MATRICULE}}": "POC-01",
  "{{STUDENT_CLASS}}": "Classe fictive",
  "{{GENERATED_AT}}": "29/10/2026",
  "{{SUBJECT_ROWS}}": "<tr><td>Épreuve fictive</td><td>10.00</td><td>1</td></tr>",
  "{{AVERAGE}}": "10.00 / 20",
  "{{RANK_BLOCK}}": "",
  "{{APPRECIATION_BLOCK}}": "<p><strong>Appréciation :</strong> Fixture de preuve Browser Run.</p>",
  "{{QR_BLOCK}}": "",
  "{{FOOTER_NOTE}}": "Document fictif généré pour MIG-WORKERS-POC-01. Aucune donnée scolaire.",
  "{{VERIFICATION_HINT}}": "",
});

export function buildPocBulletinHtml() {
  let html = templateHtml;
  for (const [token, value] of Object.entries(FIXTURE)) {
    html = html.split(token).join(value);
  }
  if (html.includes("{{")) {
    throw new Error("POC_BULLETIN_PLACEHOLDER");
  }
  assertSafeBulletinHtml(html);
  return html;
}

export function assertSafeBulletinHtml(html) {
  const forbidden = /(?:https?:|file:|ws:|wss:|\/\/)/i;
  if (forbidden.test(html)) {
    throw new Error("POC_BULLETIN_EXTERNAL_URL");
  }
  if (!html.includes("Élève fictif POC-01")) {
    throw new Error("POC_BULLETIN_FIXTURE_MISSING");
  }
}
