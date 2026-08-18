/**
 * P0 vocabulaire V2 — empêche la réintroduction des labels visibles
 * « Matière » / « Matières » sur les écrans pédagogiques.
 *
 * Autorisé (clés techniques temporaires) :
 *   Matières:READ|CREATE|UPDATE|DELETE|SUSPEND
 *   feature: "Matières"
 *   useFeaturePermissions("Matières")
 *   VIEW_PERMISSION_FEATURES / moduleName / matrix RBAC "Matières"
 *   identifiants subject / subject_id / subjectCode
 *
 *   node scripts/guard-v2-course-vocabulary.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const FILES = [
  "web/src/components/grades/EvaluationFormModal.tsx",
  "web/src/components/SchoolSubjectsPanel.tsx",
  "web/src/components/grades/StudentGradesPanel.tsx",
  "web/src/pages/GradesEvaluationsPage.tsx",
  "web/src/pages/etablissement/TeachersListPage.tsx",
  "web/src/pages/planning/TimetableByTeacherPage.tsx",
  "web/src/pages/planning/TimetableByClassPage.tsx",
  "web/src/pages/planning/PlanningConflictsPage.tsx",
  "web/src/pages/planning/PlanningLayout.tsx",
  "web/src/pages/CoursePlanningPage.tsx",
  "web/src/pages/BulletinDesignPage.tsx",
  "web/src/pages/parametres/SettingsHubPage.tsx",
  "web/src/pages/parametres/DataBackupSettingsPage.tsx",
  "web/src/pages/EntityPage.tsx",
  "web/src/pages/entity-page/teacherAssignmentWorkflow.ts",
  "web/src/lib/entityModules.ts",
  "web/src/lib/teacherRules.ts",
  "web/src/lib/assignments.ts",
  "web/src/lib/pedagogyGovernance.ts",
  "web/src/lib/coursePlanning.ts",
  "web/src/lib/dashboardCharts.ts",
  "web/src/lib/chartTypes.ts",
  "web/src/lib/bulletinGrapesTemplate.ts",
  "backend/templates/bulletin/report-card.html",
  "backend/db/teacherAssignmentsRepository.js",
  "backend/db/postgresRepository.js",
  "backend/db/fallbackRepository.js",
  "backend/db/documentsExamsPgStore.js",
  "backend/db/documentsExamsMemoryStore.js",
  "backend/lib/pedagogyService.js",
  "backend/lib/pedagogyReferences.js",
  "backend/lib/teacherAssignmentsManagement.js",
  "backend/lib/evaluationAttachment.js",
  "backend/lib/schoolSettingsManagement.js",
  "backend/lib/dataIntegrityRules.js",
  "backend/services/pedagogyGovernanceService.js",
  "Mobile/src/screens/AdminCrudScreen.tsx",
  "Mobile/src/screens/ConfigurationScreen.tsx",
  "Mobile/src/lib/pedagogyGovernance.ts",
  "Mobile/src/domain/mvp/MvpBusinessRules.ts",
];

const WORD_RE = /\b[Mm]ati[eè]re(s)?\b/g;

const ALLOWED = [
  /Matières:(READ|CREATE|UPDATE|DELETE|SUSPEND)/,
  /feature:\s*["']Matières["']/,
  /useFeaturePermissions\(\s*["']Matières["']\s*\)/,
  /moduleName:\s*["']Matières["']/,
  /courses:\s*["']Matières["']/,
  /["']Matières["']\s*:/,
  /^\s*["']Matières["']\s*,?\s*$/,
];

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function isAllowed(line) {
  const trimmed = line.trim();
  return ALLOWED.some((re) => re.test(trimmed) || re.test(line));
}

function main() {
  const violations = [];

  for (const rel of FILES) {
    const absolute = path.join(ROOT, rel);
    if (!fs.existsSync(absolute)) {
      violations.push({ file: rel, line: 0, snippet: "fichier attendu absent" });
      continue;
    }
    const raw = fs.readFileSync(absolute, "utf8");
    const source = stripComments(raw);
    const lines = source.split(/\r?\n/);
    lines.forEach((line, idx) => {
      WORD_RE.lastIndex = 0;
      if (!WORD_RE.test(line)) return;
      if (isAllowed(line)) return;
      violations.push({
        file: rel,
        line: idx + 1,
        snippet: line.trim().slice(0, 160),
      });
    });
  }

  if (violations.length) {
    console.error("guard-v2-course-vocabulary: labels visibles « Matière(s) » interdits en V2.");
    for (const item of violations) {
      console.error(`  ${item.file}:${item.line}  ${item.snippet}`);
    }
    console.error(`\n${violations.length} occurrence(s). Utiliser « Cours ».`);
    console.error("Autorisé: Matières:READ|CREATE|DELETE, feature: \"Matières\", subject_id.");
    process.exit(1);
  }

  console.log(`guard-v2-course-vocabulary: OK (${FILES.length} fichiers, 0 label Matière visible)`);
}

main();
