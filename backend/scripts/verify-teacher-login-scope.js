"use strict";

/**
 * Gate P0 AUTH/SCOPE TEACHER — login/refresh JWT conserve classId/classCode.
 */
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function run(file) {
  const result = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function assertPresenceWebUsesSessionAssignments() {
  const roster = fs.readFileSync(path.join(ROOT, "web/src/lib/presenceRoster.ts"), "utf8");
  assert.match(roster, /currentUser\?\.assignments|currentUser\.assignments/);
  assert.match(roster, /assignedClassIds/);
  assert.match(roster, /isExplicitlyActiveAssignmentStatus/);
  assert.doesNotMatch(roster, /if \(!normalized\) return true/);
}

function assertNotesWebUsesSessionAssignments() {
  const helper = fs.readFileSync(path.join(ROOT, "web/src/lib/evaluationCourseOptions.ts"), "utf8");
  const modal = fs.readFileSync(path.join(ROOT, "web/src/components/grades/EvaluationFormModal.tsx"), "utf8");
  const routeMap = fs.readFileSync(path.join(ROOT, "web/src/lib/routeDomainMap.ts"), "utf8");
  const notesRepo = fs.readFileSync(path.join(ROOT, "backend/db/postgresRepository.js"), "utf8");

  assert.match(helper, /user\?\.assignments/);
  assert.match(helper, /isExplicitlyActiveAssignmentStatus/);
  assert.match(helper, /isTeacherUserRole/);
  assert.match(modal, /courseOptionsForClass\(/);
  assert.match(modal, /user,/);

  const notesRule = routeMap.match(/prefix:\s*"\/notes"[^}]+}/);
  assert.ok(notesRule, "/notes manquant dans routeDomainMap");
  assert.match(notesRule[0], /"notes"/);
  assert.match(notesRule[0], /"evaluations"/);
  assert.doesNotMatch(notesRule[0], /"assignments"/);
  assert.doesNotMatch(notesRule[0], /"courses"/);

  const loaders = fs.readFileSync(path.join(ROOT, "web/src/lib/domainLoaders.ts"), "utf8");
  assert.match(loaders, /"evaluations"/);
  assert.match(loaders, /listEvaluations/);
  const pedagogyApi = fs.readFileSync(path.join(ROOT, "web/src/lib/pedagogyApi.ts"), "utf8");
  assert.match(pedagogyApi, /listEvaluations:\s*\(\)\s*=>\s*api\.get<unknown\[]>\("\/evaluations"\)/);
  const serverSrc = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  assert.match(serverSrc, /app\.get\("\/api\/evaluations"/);
  assert.match(serverSrc, /listSchoolEvaluations/);

  assert.match(notesRepo, /Accès refusé: cours non affecté/);
  assert.match(notesRepo, /error\.statusCode = 403/);

  const gradesPage = fs.readFileSync(path.join(ROOT, "web/src/pages/GradesEvaluationsPage.tsx"), "utf8");
  assert.match(gradesPage, /periodFilterOptions/);
  assert.match(gradesPage, /filterEvaluationsForQueue/);
  assert.match(gradesPage, /resolveEvaluationsQueueDefaults/);
  assert.match(gradesPage, /evaluationsEligibleForGradeEntry/);
  assert.match(gradesPage, /canEnterGradesForEvaluation/);
  assert.doesNotMatch(
    gradesPage,
    /canEditEvaluation\(selectedEvaluation/,
    "saisie des notes ne doit pas réutiliser canEditEvaluation",
  );
  assert.doesNotMatch(
    gradesPage,
    /<Input value=\{period\}/,
    "Période Notes ne doit plus être un Input texte libre",
  );

  const gradeGrid = fs.readFileSync(path.join(ROOT, "web/src/components/grades/GradeEntryGrid.tsx"), "utf8");
  assert.match(gradeGrid, /type GradeDraft/);
  assert.match(gradeGrid, /dirty:\s*boolean/);
  assert.match(gradeGrid, /function saveAll\(/);
  assert.match(gradeGrid, /onChange\(changed\)/);
  assert.doesNotMatch(
    gradeGrid,
    /onBlur=\{/,
    "la note ne doit plus être persistée au blur",
  );
  assert.doesNotMatch(
    gradeGrid,
    />\s*Enregistrer\s*</,
    "aucun bouton Enregistrer par élève ne doit subsister",
  );
  assert.match(gradeGrid, />\s*Enregistrer tout\s*</);

  const evaluationsLib = fs.readFileSync(path.join(ROOT, "web/src/lib/evaluations.ts"), "utf8");
  assert.match(evaluationsLib, /export function canEnterGradesForEvaluation/);
  assert.match(evaluationsLib, /evaluation\.status !== "Validée"/);
  assert.match(evaluationsLib, /evaluationsEligibleForGradeEntry/);

  const gradeEntry = fs.readFileSync(path.join(ROOT, "backend/lib/evaluationGradeEntry.js"), "utf8");
  assert.match(gradeEntry, /EVALUATION_NOT_VALIDATED/);
  assert.match(gradeEntry, /isValidatedEvaluationStatus/);
  assert.match(gradeEntry, /assertTeacherCannotValidateEvaluation/);

  const notesRoute = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  assert.match(notesRoute, /assertNoteWrite/);
  const upsertGrade = notesRepo.match(/async upsertGrade[\s\S]+?async resolveStudentForGrade/);
  assert.ok(upsertGrade, "upsertGrade introuvable");
  assert.match(upsertGrade[0], /assertEvaluationAllowsGradeEntry/);
  assert.match(upsertGrade[0], /assertStudentEnrolledInEvaluationClass/);
}

assertPresenceWebUsesSessionAssignments();
assertNotesWebUsesSessionAssignments();
run("backend/lib/teacherLoginScope.diagnostic.test.js");
run("backend/lib/teacherSessionAssignments.test.js");
run("backend/lib/classStudentsAuthz.test.js");
run("backend/lib/teacherLoginScope.pg.test.js");
run("backend/lib/teacherNotesWriteAccess.test.js");

const web = spawnSync(
  "npm",
  [
    "--prefix",
    "web",
    "run",
    "test",
    "--",
    "src/lib/presenceRoster.test.ts",
    "src/lib/evaluations.test.ts",
    "src/components/grades/EvaluationFormModal.test.tsx",
    "src/lib/routeDomainMap.usersSchoolCode.test.ts",
    "src/lib/domainLoaders.evaluations.test.ts",
    "src/lib/evaluationQueue.test.ts",
    "src/pages/GradesEvaluationsPage.test.tsx",
    "src/components/grades/GradeEntryGrid.test.tsx",
  ],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  },
);
if (web.status !== 0) {
  process.exit(web.status || 1);
}
console.log("verify-teacher-login-scope: OK");
