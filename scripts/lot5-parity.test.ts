/**
 * Contrats LOT 5 — PARITY-023 / 024 / 033 / 060 Pédagogie.
 *
 *   npx --yes tsx --test scripts/lot5-parity.test.ts
 *
 * Required.needs reste extensible (lot5 n'est pas figé comme dernier).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel: string) {
  return fs.existsSync(path.join(ROOT, rel));
}

test("PARITY-023 — Bulletins Mobile lecture + workflow read-only, zéro mutation", () => {
  const screen = read("Mobile/src/screens/ReportCardsScreen.tsx");
  const publications = read("Mobile/src/lib/reportCardPublicationApi.ts");
  const history = read("Mobile/src/lib/reportCardHistoryApi.ts");
  assert.match(publications, /listReportCardPublications/);
  assert.match(publications, /\/report-card\/publications/);
  assert.match(publications, /getReportCardPublicationSnapshot/);
  assert.match(history, /listPublishedVersionHistory/);
  assert.match(history, /\/report-card\/publications\/\$\{/);
  assert.match(screen, /downloadReportCardPdf/);
  assert.match(screen, /État du workflow bulletin|workflow bulletin/i);
  assert.match(
    screen,
    /configuration, l'approbation et la publication des bulletins se font depuis Somafrik Web/i,
  );
  assert.ok(exists("Mobile/src/lib/reportCardWorkflowApi.ts"), "client GET /report-card/requests manquant");
  const workflow = read("Mobile/src/lib/reportCardWorkflowApi.ts");
  assert.match(workflow, /\/report-card\/requests/);
  assert.doesNotMatch(workflow, /method:\s*["'`]POST/);
  assert.doesNotMatch(workflow, /method:\s*["'`]PUT/);
  assert.doesNotMatch(workflow, /method:\s*["'`]PATCH/);
  assert.doesNotMatch(workflow, /method:\s*["'`]DELETE/);
  assert.doesNotMatch(publications, /method:\s*["'`]POST/);
  assert.doesNotMatch(history, /corrections|revoke/);
  assert.doesNotMatch(screen, /\/report-card\/requests\/\$\{[^}]+\}\/approve/);
  assert.doesNotMatch(screen, /parent_student[\s\S]{0,80}listReportCardRequests|listReportCardRequests[\s\S]{0,120}parent_student/);
  assert.match(screen, /card\.studentName/);
  const firstCard = screen.indexOf("<ExpandableEntityCard");
  const studentNameAt = screen.indexOf("card.studentName");
  assert.ok(firstCard >= 0 && studentNameAt > firstCard, "PD-06 : première carte = bulletin publié");
});

test("PARITY-024 — Examens Mobile natifs /exams, lifecycle RBAC, pas planning-exams", () => {
  assert.ok(exists("Mobile/src/screens/ExamsScreen.tsx"), "ExamsScreen manquant");
  const screen = read("Mobile/src/screens/ExamsScreen.tsx");
  const api = read("Mobile/src/services/api.ts");
  const nav = read("Mobile/src/navigation/AppNavigator.tsx");
  const inventory = read("Mobile/src/lib/mobileMutationInventory.ts");
  const perms = exists("Mobile/src/lib/examPermissions.ts")
    ? read("Mobile/src/lib/examPermissions.ts")
    : read("Mobile/src/domain/security/permissions.ts");
  assert.match(api, /export function listExams/);
  assert.match(api, /["'`]\/exams["'`]/);
  assert.match(api, /export function getExam/);
  assert.match(api, /export function createExam/);
  assert.match(api, /export function patchExam/);
  assert.match(api, /export function validateExam/);
  assert.match(api, /export function cancelExam/);
  assert.match(api, /export function archiveExam/);
  assert.doesNotMatch(api, /\/backoffice\/planning-exams/);
  assert.doesNotMatch(screen, /\/backoffice\/planning-exams/);
  assert.match(screen, /listExams|getExam|createExam|validateExam|cancelExam|archiveExam/);
  assert.match(screen, /formatDateForDisplay/);
  assert.ok(exists("Mobile/src/lib/examEdit.ts"), "examEdit manquant");
  const examEdit = read("Mobile/src/lib/examEdit.ts");
  assert.match(examEdit, /export function examToForm/);
  assert.match(examEdit, /export function examFormToPatchPayload/);
  assert.match(examEdit, /export function examPatchChanged/);
  assert.match(examEdit, /formatDateForDisplay/);
  assert.match(examEdit, /toApiDate/);
  assert.match(screen, /editForm/);
  assert.match(screen, /startEdit/);
  assert.match(screen, /discardEdit/);
  assert.match(screen, /submitEdit/);
  assert.match(screen, /examToForm|examFormToPatchPayload/);
  assert.match(screen, /Annuler les modifications/);
  assert.doesNotMatch(screen, /name:\s*detail\.name/);
  assert.match(nav, /Exams/);
  assert.match(perms, /canReadExams|Examens:READ/);
  assert.match(perms, /Organiser examens/);
  assert.match(perms, /Valider examens/);
  assert.match(inventory, /createExam[\s\S]*?path:\s*["'`]\/exams["'`][\s\S]*?outbox:\s*false/);
  assert.doesNotMatch(screen, /outbox/);
  assert.doesNotMatch(screen, /schoolCode:/);
});

test("PARITY-033 — moyenne Parent/Mobile canonique 17,5 / 12 / 15,67 — 16,4 interdit", () => {
  const panel = read("web/src/components/grades/ParentChildGradesPanel.tsx");
  const notes = read("Mobile/src/screens/StudentNotesScreen.tsx");
  assert.doesNotMatch(panel, /displayedAverage\s*=\s*courseFilter\s*\?\s*kpis\.average/);
  assert.match(panel, /GradeBookService/);
  assert.match(panel, /getStudentAverageValue/);
  assert.match(notes, /canonicalStudentGeneralAverage|canonicalCourseAverage/);
  assert.match(notes, /courseFilter|selectedCourse|Tous les cours/);
  assert.match(notes, /selectedStudentId/);
});

test("PARITY-060 — statistiques classe Mobile = contrat Web", () => {
  assert.ok(exists("Mobile/src/lib/classGradesStats.ts"), "classGradesStats manquant");
  assert.ok(
    exists("Mobile/src/screens/ClassGradesStatsScreen.tsx") ||
      read("Mobile/src/screens/TeacherGradesScreen.tsx").includes("classGradesStats"),
    "vue stats classe Mobile manquante",
  );
  const helper = read("Mobile/src/lib/classGradesStats.ts");
  assert.match(helper, /export function classGradesStats/);
  assert.match(helper, /canonicalStudentGeneralAverage/);
  assert.match(helper, /classAverage|bestAverage|lowestAverage|successRate/);
  assert.match(helper, /atRisk|ranking/);
  assert.match(helper, /classPeriodNotes/);
  assert.match(helper, /export function resolveClassGradesScope/);
  assert.match(helper, /isTeacherSession/);
  assert.match(helper, /teacherScopedClassLabels/);
  const screen = exists("Mobile/src/screens/ClassGradesStatsScreen.tsx")
    ? read("Mobile/src/screens/ClassGradesStatsScreen.tsx")
    : read("Mobile/src/screens/TeacherGradesScreen.tsx");
  assert.match(screen, /classGradesStats|Classement|élèves en difficulté|reussite|réussite/i);
  assert.match(screen, /resolveClassGradesScope/);
  assert.doesNotMatch(screen, /includes\(["'`]enseign/);
});

test("PARITY-023/024/033/060 — gate CI lot5 extensible avec LOT 0–4", () => {
  const pkg = read("package.json");
  const gates = read(".github/workflows/pr-gates.yml");
  const requiredJob = gates.slice(gates.indexOf("name: Required"));
  assert.match(pkg, /"test:lot5-parity"/);
  assert.match(pkg, /"test:lot4-parity"/);
  assert.match(gates, /name: LOT 5 parity/);
  assert.match(gates, /npm run test:lot5-parity/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot0[^\]]*\]/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot4[^\]]*\]/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot5[^\]]*\]/);
  assert.match(requiredJob, /LOT5: \$\{\{ needs\.lot5\.result \}\}/);
  assert.match(requiredJob, /"\$LOT5"/);
});
