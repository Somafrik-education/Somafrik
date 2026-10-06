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
  const issueDialog = read("web/src/components/students/StudentCardIssueDialog.tsx");
  const settings = read("web/src/components/students/StudentCardSettingsSection.tsx");
  const settingsPage = read("web/src/pages/parametres/SchoolSetupSettingsPage.tsx");
  const css = read("web/src/index.css");
  const webPackage = read("web/package.json");
  const product = [api, tab, printView, issueDialog, settings].join("\n");

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
  assert.match(tab, /STUDENT_CARD_ACTIVE_ALREADY_EXISTS[\s\S]{0,240}setIssueOpen\(false\)/);
  assert.doesNotMatch(product, /localStorage|sessionStorage|indexedDB|Idempotency-Key|withIdempotency/);
  assert.doesNotMatch(product, /NDEFReader|navigator\.nfc|expo-camera|POST \/api\/student-cards\/scan|student-cards\/scan/);
  assert.doesNotMatch(product, /console\.log|navigator\.clipboard|data-card-token|data-token/);

  assert.match(printView, /from "qrcode"/);
  assert.match(printView, /QRCode\.toDataURL\(cardToken/);
  assert.match(printView, /PrintButton/);
  assert.match(printView, /disabled=\{qrState !== "ready"\}/);
  assert.match(printView, /Réessayer le QR/);
  assert.match(printView, /type QrState = "loading" \| "ready" \| "error"/);
  assert.match(printView, /studentCardDocumentTitle/);
  assert.match(printView, /85\.60mm|STUDENT_CARD_CR80/);
  assert.match(css, /85\.6mm 53\.98mm/);
  assert.match(css, /somafrik-print-student-card/);
  assert.match(webPackage, /"qrcode": "\^1\.5\.4"/);
  assert.doesNotMatch(printView, /parentPhone|parentEmail|birthDate|token_hash/);
  assert.doesNotMatch(read("web/src/lib/studentCardPolicy.ts"), /Mobile\/|NDEFReader|navigator\.nfc/);

  console.log("verify-student-card-web: SUCCESS");
}

main();
