/** Tokens injectés côté serveur lors de la génération PDF. */
export const BULLETIN_TEMPLATE_TOKENS = [
  { id: "SCHOOL_NAME", label: "Nom établissement", token: "{{SCHOOL_NAME}}" },
  { id: "SCHOOL_CODE", label: "Code établissement", token: "{{SCHOOL_CODE}}" },
  { id: "PERIOD", label: "Période", token: "{{PERIOD}}" },
  { id: "REPORT_TITLE", label: "Titre bulletin", token: "{{REPORT_TITLE}}" },
  { id: "REPORT_SUBTITLE", label: "Sous-titre", token: "{{REPORT_SUBTITLE}}" },
  { id: "STUDENT_NAME", label: "Nom élève", token: "{{STUDENT_NAME}}" },
  { id: "STUDENT_MATRICULE", label: "Matricule", token: "{{STUDENT_MATRICULE}}" },
  { id: "STUDENT_CLASS", label: "Classe", token: "{{STUDENT_CLASS}}" },
  { id: "GENERATED_AT", label: "Date génération", token: "{{GENERATED_AT}}" },
  { id: "SUBJECT_ROWS", label: "Tableau des notes", token: "{{SUBJECT_ROWS}}" },
  { id: "AVERAGE", label: "Moyenne générale", token: "{{AVERAGE}}" },
  { id: "RANK_BLOCK", label: "Bloc rang", token: "{{RANK_BLOCK}}" },
  { id: "APPRECIATION_BLOCK", label: "Bloc appréciation", token: "{{APPRECIATION_BLOCK}}" },
  { id: "QR_BLOCK", label: "QR code", token: "{{QR_BLOCK}}" },
  { id: "FOOTER_NOTE", label: "Note pied de page", token: "{{FOOTER_NOTE}}" },
  { id: "LOGO_HTML", label: "Logo établissement", token: "{{LOGO_HTML}}" },
] as const;

/** Corps HTML par défaut (contenu éditable GrapesJS). */
export const DEFAULT_BULLETIN_BODY_HTML = `
<div class="page">
  <header class="header">
    <div class="brand">
      {{LOGO_HTML}}
      <div>
        <h1>{{SCHOOL_NAME}}</h1>
        <p>Code établissement : {{SCHOOL_CODE}}</p>
      </div>
    </div>
    <div class="meta">
      <strong>{{PERIOD}}</strong>
      <span class="status-badge">Publié</span>
    </div>
  </header>
  <section class="title-block">
    <h2>{{REPORT_TITLE}}</h2>
    <p>{{REPORT_SUBTITLE}}</p>
  </section>
  <section class="student-grid">
    <div><span>Élève</span>{{STUDENT_NAME}}</div>
    <div><span>Matricule</span>{{STUDENT_MATRICULE}}</div>
    <div><span>Classe</span>{{STUDENT_CLASS}}</div>
    <div><span>Date</span>{{GENERATED_AT}}</div>
  </section>
  <table class="results">
    <thead>
      <tr>
        <th>Cours</th>
        <th style="width:18%">Moyenne /20</th>
        <th style="width:12%">Coeff.</th>
      </tr>
    </thead>
    <tbody>{{SUBJECT_ROWS}}</tbody>
  </table>
  <section class="summary">
    <div class="summary-box">
      <p><strong>Moyenne générale :</strong> <span class="average">{{AVERAGE}}</span></p>
      {{RANK_BLOCK}}
      {{APPRECIATION_BLOCK}}
    </div>
    {{QR_BLOCK}}
  </section>
  <footer class="footer">
    <span>{{FOOTER_NOTE}}</span>
  </footer>
</div>
`.trim();

/** Styles par défaut alignés sur backend/templates/bulletin/report-card.css */
export const DEFAULT_BULLETIN_CSS = `
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #0f172a; background: #fff; }
.page { width: 100%; min-height: 100%; }
.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid #0d9488; }
.brand { display: flex; align-items: center; gap: 14px; }
.brand img { width: 72px; height: 72px; object-fit: contain; }
.brand h1 { margin: 0; font-size: 18pt; line-height: 1.2; }
.brand p { margin: 4px 0 0; font-size: 9.5pt; color: #475569; }
.meta { text-align: right; font-size: 9.5pt; color: #475569; }
.meta strong { display: block; color: #0f172a; font-size: 11pt; }
.title-block { margin: 18px 0 14px; text-align: center; }
.title-block h2 { margin: 0; font-size: 16pt; letter-spacing: 0.04em; text-transform: uppercase; }
.title-block p { margin: 6px 0 0; color: #475569; }
.student-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 16px; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
.student-grid div { font-size: 10pt; }
.student-grid span { display: block; color: #64748b; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
table.results { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
table.results th, table.results td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
table.results th { background: #0d9488; color: #fff; font-size: 9.5pt; text-transform: uppercase; }
table.results td.num { text-align: center; font-variant-numeric: tabular-nums; }
.summary { display: grid; grid-template-columns: 1fr 120px; gap: 16px; align-items: start; }
.summary-box { padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
.summary-box p { margin: 0 0 8px; }
.summary-box .average { font-size: 14pt; font-weight: 700; color: #0d9488; }
.qr-box { text-align: center; padding: 10px; border: 1px dashed #cbd5e1; border-radius: 10px; }
.qr-box img { width: 108px; height: 108px; }
.footer { margin-top: 18px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 8.5pt; color: #64748b; }
.status-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #ecfdf5; color: #047857; font-size: 9pt; font-weight: 600; }
`.trim();
