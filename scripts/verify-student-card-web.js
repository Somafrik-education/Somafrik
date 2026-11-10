"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function main() {
  const navigation = read("web/src/lib/studentWorkspaceNavigation.ts");
  const workspace = read("web/src/lib/studentWorkspace.ts");
  const api = read("web/src/lib/studentCardsApi.ts");
  const tab = read("web/src/components/students/StudentCardTab.tsx");
  const printView = read("web/src/components/students/StudentCardPrintView.tsx");
  const face = read("web/src/components/students/StudentCardFace.tsx");
  const qrHook = read("web/src/lib/studentCardQr.ts");
  const fonts = read("web/src/lib/studentCardFonts.ts");
  const issueDialog = read("web/src/components/students/StudentCardIssueDialog.tsx");
  const settings = read("web/src/components/students/StudentCardSettingsSection.tsx");
  const settingsPage = read("web/src/pages/parametres/SchoolSetupSettingsPage.tsx");
  const css = read("web/src/index.css");
  const webPackage = read("web/package.json");
  const product = [api, tab, printView, face, qrHook, fonts, issueDialog, settings].join("\n");

  assert.match(navigation, /card: "carte"/);
  assert.match(navigation, /\/etablissement\/eleves\//);
  assert.match(workspace, /title: "Carte élève"/);
  assert.match(workspace, /requiredPermission: "student.identity.read"/);
  assert.doesNotMatch(workspace, /student\.card\.read|Cartes:READ|Cartes:UPDATE/);

  assert.match(api, /\/students\/\$\{encodeURIComponent\(studentId\)\}\/cards/);
  assert.match(api, /api\.post<IssuedStudentAccessCard>\("\/student-cards"/);
  assert.match(api, /\/lost/);
  assert.match(api, /\/revoke/);
  assert.match(api, /\/replace/);
  assert.doesNotMatch(api, /Idempotency-Key|withIdempotency|student-cards\/scan/);

  assert.match(settingsPage, /StudentCardSettingsSection/);
  assert.match(settingsPage, /configuration de l'établissement|Configuration de l'établissement/);
  assert.match(settings, /schoolSettingsApi[\s\S]{0,80}\.get\(schoolCode\)/);
  assert.match(settings, /schoolSettingsApi\.patch/);
  assert.match(settings, /studentCardEnabled/);
  assert.doesNotMatch(settings, /localStorage|sessionStorage|indexedDB|Idempotency-Key/);

  assert.match(tab, /studentCardEnabled !== true|resolveStudentCardSettingsGate/);
  assert.match(tab, /formatDateTimeForDisplay/);
  assert.doesNotMatch(tab, /toLocaleDateString/);
  assert.match(tab, /canManage && readyMedium && !hasActiveCard/);
  assert.match(tab, /STUDENT_CARD_ACTIVE_ALREADY_EXISTS[\s\S]{0,400}setIssueOpen\(false\)/);
  assert.match(tab, /const cardScopeKey = `\$\{resolvedSchoolCode\}:\$\{workspace\.studentId\}`/);
  assert.match(tab, /currentScopeRef/);
  assert.match(tab, /if \(currentScopeRef\.current !== requestScope\) return/);
  assert.match(tab, /if \(!scopeIsCurrent\(requestScope\)\) return/);
  assert.doesNotMatch(product, /localStorage|sessionStorage|indexedDB|Idempotency-Key|withIdempotency/);
  assert.doesNotMatch(product, /NDEFReader|navigator\.nfc|expo-camera|POST \/api\/student-cards\/scan|student-cards\/scan/);
  assert.doesNotMatch(product, /console\.log|navigator\.clipboard|data-card-token|data-token/);

  // CARTE-UI-01 : le jeton n'est manipulé que par useStudentCardQr ; StudentCardFace ne reçoit que l'image.
  assert.match(qrHook, /from "qrcode"/);
  // Requête liée au jeton courant (et à la tentative) : un résultat périmé n'est jamais affiché.
  assert.match(qrHook, /useMemo\(\(\) => \(\{ token: cardToken, attempt \}\), \[cardToken, attempt\]\)/);
  assert.match(qrHook, /QRCode\.toDataURL\(request\.token/);
  assert.match(qrHook, /result\?\.request === request \? result : null/);
  assert.match(qrHook, /errorCorrectionLevel: "M"/);
  assert.match(qrHook, /margin: 4/);
  assert.match(qrHook, /export type StudentCardQrState = "idle" \| "loading" \| "ready" \| "error"/);
  assert.doesNotMatch(face, /cardToken|useStudentCardQr|from "qrcode"|QRCode/);
  assert.match(face, /STUDENT_CARD_CR80/);
  assert.doesNotMatch(face, /truncate|text-ellipsis|line-clamp/);
  assert.doesNotMatch(printView, /from "qrcode"|QRCode\./);
  assert.match(printView, /useStudentCardQr\(holderTitle \? cardToken : null\)/);
  assert.match(printView, /StudentCardFace/);
  assert.match(printView, /PrintButton/);
  assert.match(printView, /const printReady = Boolean\(holderTitle\) && qrState === "ready"/);
  assert.match(printView, /disabled=\{!printReady\}/);
  assert.match(printView, /Réessayer le QR/);
  assert.match(printView, /studentCardDocumentTitle/);
  assert.match(printView, /studentCardHolderTitle\(holder\)/);
  assert.doesNotMatch(fonts, /https?:\/\//);
  assert.match(css, /85\.6mm 53\.98mm/);
  assert.match(css, /somafrik-print-student-card/);
  assert.match(webPackage, /"qrcode": "\^1\.5\.4"/);
  assert.doesNotMatch(printView, /parentPhone|parentEmail|birthDate|token_hash/);
  assert.doesNotMatch(face, /parentPhone|parentEmail|birthDate|token_hash|publicId/);
  assert.doesNotMatch(read("web/src/lib/studentCardPolicy.ts"), /Mobile\/|NDEFReader|navigator\.nfc/);

  // CARTE-BATCH-WEB-01 : secrets hors stockage permanent, pas d'émission unitaire, pas de réémission dans un effet.
  const batchApi = read("web/src/lib/studentCardBatchApi.ts");
  const batchSession = read("web/src/lib/studentCardBatchSession.ts");
  const batchPrintable = read("web/src/lib/studentCardBatchPrintable.ts");
  const batchDialog = read("web/src/components/students/StudentCardBatchDialog.tsx");
  const classesPage = read("web/src/pages/etablissement/ClassesListPage.tsx");
  const batchProduct = [batchApi, batchSession, batchPrintable, batchDialog].join("\n");
  assert.match(classesPage, /canIssueClassStudentCards/);
  assert.match(classesPage, /CLASS_CARD_BATCH_BUTTON_LABEL/);
  assert.match(batchSession, /Émettre \/ exporter les cartes/);
  assert.match(batchSession, /automaticBatchCalls/);
  assert.match(batchApi, /\/preflight/);
  assert.match(batchApi, /\/receipt/);
  assert.match(batchApi, /\/activate/);
  assert.match(batchApi, /\/abort/);
  assert.match(batchApi, /\/batches`, \{\}/);
  assert.match(batchDialog, /documentSaveVerified|canConfirmDocumentSave/);
  assert.match(batchDialog, /printableConverted: true/);
  assert.match(batchDialog, /Je confirme avoir enregistré ce document CR80/);
  assert.match(batchPrintable, /STUDENT_CARD_CR80\.width/);
  assert.match(batchPrintable, /STUDENT_CARD_CR80\.height/);
  assert.match(batchPrintable, /somafrik-card-batch-print-v2/);
  assert.match(batchPrintable, /somafrik-card-batch-print-v1/);
  assert.match(batchPrintable, /readBatchPrintDocument/);
  assert.doesNotMatch(batchDialog, /buildStudentCardBatchDocument|\.txt/);
  assert.doesNotMatch(batchProduct, /localStorage|sessionStorage|indexedDB|Idempotency-Key|withIdempotency|console\.log/);
  assert.doesNotMatch(batchApi, /student-cards\/scan|api\.post<IssuedStudentAccessCard>\("\/student-cards"/);
  const effectBlocks = [...batchDialog.matchAll(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/g)];
  assert.ok(effectBlocks.length >= 2, "les effets du dialogue doivent rester explicites");
  for (const block of effectBlocks) {
    assert.doesNotMatch(block[0], /studentCardBatchApi\.(prepare|activate|abort|receipt)/);
  }

  // CARTE-BATCH-PDF-02 : conversion locale du CR80, sans émission et sans stockage des jetons.
  const batchPdf = read("web/src/lib/studentCardBatchPdf.ts");
  const batchPdfDialog = read("web/src/components/students/StudentCardBatchPdfDialog.tsx");
  const cardDesign = read("web/src/lib/studentCardDesign.ts");
  const pdfProduct = [batchPdf, batchPdfDialog, cardDesign].join("\n");
  assert.match(classesPage, /CLASS_CARD_PDF_BUTTON_LABEL/);
  assert.match(classesPage, /StudentCardBatchPdfDialog/);
  assert.match(batchPdf, /Produire le PDF A4/);
  assert.match(batchPdf, /somafrik-card-batch-print-v2/);
  assert.match(batchPdf, /somafrik-card-batch-print-v1/);
  assert.match(cardDesign, /widthMm: 85\.6/);
  assert.match(cardDesign, /heightMm: 53\.98/);
  assert.match(batchPdf, /from "pdf-lib"/);
  assert.match(batchPdfDialog, /accept="\.html,text\/html"/);
  assert.match(batchPdfDialog, /revokeObjectURL/);
  assert.match(webPackage, /"pdf-lib": "\^1\.17\.1"/);
  assert.match(webPackage, /"jsqr": "\^1\.4\.0"/);
  assert.doesNotMatch(pdfProduct, /studentCardBatchApi|studentCardBatchPrintable|api\/client|localStorage|sessionStorage|indexedDB|console\.log|fetch\(/);
  assert.doesNotMatch(pdfProduct, /\/batches|student-cards\/scan|api\.post/);
  const pdfEffects = [...batchPdfDialog.matchAll(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/g)];
  assert.equal(pdfEffects.length, 1, "le dialogue PDF ne déclenche la conversion que sur le fichier choisi");
  for (const block of pdfEffects) {
    assert.doesNotMatch(block[0], /prepare|activate|abort|receipt|fetch\(/);
  }

  // CARTE-BATCH-DESIGN-01 : une seule référence de design (maquette P1) pour la carte individuelle,
  // le document HTML CR80 par classe et le PDF A4. Aucun gabarit simplifié.
  assert.match(face, /studentCardFaceCss/);
  assert.match(face, /STUDENT_CARD_P1/);
  assert.doesNotMatch(css, /\.student-card-face \.scf-band \{/);
  assert.match(batchPrintable, /createElement\(StudentCardFace/);
  assert.match(batchPrintable, /studentCardFaceCss\(\)/);
  assert.match(batchPrintable, /chooseCardSheetLayout/);
  assert.doesNotMatch(batchPrintable, /<article class="card">|<h1>/);
  assert.match(batchPdf, /STUDENT_CARD_P1/);
  assert.match(batchPdf, /from "\.\/studentCardDesign"/);
  assert.doesNotMatch(cardDesign, /fetch\(|localStorage|sessionStorage|indexedDB|console\.log|cardToken/);

  console.log("verify-student-card-web: SUCCESS");
}

main();
