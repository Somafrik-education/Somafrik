"use strict";

/**
 * NOTES-P1 — gate d'intégration écriture enseignant.
 * HELP write articles restent absents. Pas de fallback JWT/BO pour l'écriture notes.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function readRepo(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function assertHelpWriteArticlesAbsent() {
  const articles = readRepo("packages/help-catalog/src/articles.js");
  assert.doesNotMatch(articles, /help\/grades\/create-evaluation/);
  assert.doesNotMatch(articles, /help\/grades\/enter/);
  const helpV1a = readRepo("scripts/verify-help-v1a-catalogue.js");
  assert.match(helpV1a, /create-evaluation/);
  // Baseline #400 n'inclut pas HELP-V1C (#401). Le guard mobile n'existe que si le fichier est présent.
  const helpV1cPath = path.join(ROOT, "scripts/verify-help-v1c-mobile.js");
  if (fs.existsSync(helpV1cPath)) {
    assert.match(fs.readFileSync(helpV1cPath, "utf8"), /help\/grades\/enter/);
  }
}

function assertTeacherRuntimeSource() {
  const pg = readRepo("backend/db/postgresRepository.js");
  const upsertGrade = pg.slice(pg.indexOf("async upsertGrade"), pg.indexOf("async resolveEvaluationRow"));
  assert.match(upsertGrade, /isTeacherPrincipal\(principal\)/);
  assert.match(upsertGrade, /assertTeacherGradeMutationPermission/);
  assert.match(upsertGrade, /resolveTeacherPgIdForPrincipal/);
  assert.doesNotMatch(upsertGrade, /jwt_classNames/);

  const upsertEval = pg.slice(
    pg.indexOf("async upsertEvaluationFromLegacy"),
    pg.indexOf("async syncNotesDomainFromBackOffice"),
  );
  assert.match(upsertEval, /findActiveTeacherAssignmentRow/);
  assert.match(upsertEval, /teacherId = teacherPgId/);
  assert.match(upsertEval, /assertTeacherCannotValidateEvaluation/);
  const insertBlock = upsertEval.slice(upsertEval.indexOf("INSERT INTO evaluations"));
  assert.match(insertBlock, /teacherId,/);
  assert.doesNotMatch(insertBlock.slice(0, 900), /teacher\?\.id \?\? null/);

  const classAccess = pg.slice(
    pg.indexOf("async teacherCanAccessStudentClass"),
    pg.indexOf("async teacherCanAccessEvaluation"),
  );
  assert.match(classAccess, /teacher_assignments/);
  assert.doesNotMatch(classAccess, /jwt_classNames/);
  assert.doesNotMatch(classAccess, /fallback_bo_class/);

  const evalAccess = pg.slice(
    pg.indexOf("async teacherCanAccessEvaluation"),
    pg.indexOf("async collectTeacherLookupKeysForPrincipal"),
  );
  assert.match(evalAccess, /findActiveTeacherAssignmentRow/);
  assert.match(evalAccess, /pg_teacher_assignment/);
  assert.doesNotMatch(evalAccess, /jwt_classNames/);
  assert.doesNotMatch(evalAccess, /fallback_bo_class/);

  const rbac = readRepo("backend/services/rbacService.js");
  const postEval = rbac.match(/"POST \/api\/evaluations":\s*\[[^\]]+\]/);
  assert.ok(postEval, "POST /api/evaluations introuvable");
  assert.match(postEval[0], /Notes:CREATE/);
  assert.doesNotMatch(postEval[0], /Notes:UPDATE/);

  const server = readRepo("backend/server.js");
  assert.match(server, /app\.post\("\/api\/evaluations".*requireSchoolSubscriptionFeature\("write_notes"\)/s);
  assert.match(server, /app\.post\("\/api\/notes".*requireSchoolSubscriptionFeature\("write_notes"\)/s);

  const web = readRepo("web/src/lib/evaluations.ts");
  assert.match(web, /export function evaluationStatusAllowsGradeWrite/);
  assert.match(web, /canEnterGradesForEvaluation/);

  const mobile = readRepo("Mobile/src/lib/evaluationsV2.ts");
  assert.match(mobile, /status === "draft" \|\| status === "open" \|\| status === "locked"/);

  const gradesScreen = readRepo("Mobile/src/screens/TeacherGradesScreen.tsx");
  assert.match(gradesScreen, /canValidate = canUpdate && !teacher/);
  assert.match(gradesScreen, /hasSecurityPermission\(session, "Notes", "CREATE"\)/);
  assert.doesNotMatch(
    gradesScreen,
    /canCreate = hasSecurityPermission\(session, "Notes", "CREATE"\) \|\| hasSecurityPermission\(session, "Notes", "UPDATE"\)/,
  );

  const contactProvision = readRepo("backend/lib/contactUserProvision.js");
  const enseignantDefaults = contactProvision.match(/Enseignant:\s*\[[^\]]+\]/);
  assert.ok(enseignantDefaults, "defaults Enseignant introuvables");
  assert.match(enseignantDefaults[0], /Notes:CREATE/);
  assert.match(enseignantDefaults[0], /Notes:UPDATE/);
  assert.match(enseignantDefaults[0], /Affectations:READ/);
  assert.match(enseignantDefaults[0], /Matières:READ/);
  assert.doesNotMatch(enseignantDefaults[0], /Présences:CREATE/);
  assert.doesNotMatch(enseignantDefaults[0], /Présences:UPDATE/);

  const criticalParity = readRepo("backend/lib/criticalParityRbacCanonical.js");
  assert.doesNotMatch(criticalParity, /moduleKey:\s*"grades"/);

  const { rolePermissionsDeclared } = require(path.join(ROOT, "backend/data"));
  assert.ok(rolePermissionsDeclared.Enseignant.includes("Créer notes"));
  assert.ok(rolePermissionsDeclared.Enseignant.includes("Modifier notes"));
  assert.ok(rolePermissionsDeclared["Préfet des études"].includes("Créer notes"));
  assert.equal(rolePermissionsDeclared["Admin School"].includes("Créer notes"), false);
  assert.equal(rolePermissionsDeclared["Admin School"].includes("Notes:CREATE"), false);

  const pedagogy = readRepo("backend/scripts/verify-pedagogy-management.js");
  const forge = pedagogy.slice(pedagogy.indexOf("forgedEvaluation"), pedagogy.indexOf("évaluation scellée"));
  assert.match(forge, /EVAL-FORGE/);
  assert.match(forge, /token: teacherToken/);
  assert.doesNotMatch(forge, /token: adminToken/);

  const evalTypes = readRepo("backend/scripts/verify-evaluation-types-management.js");
  const pgTypes = evalTypes.slice(evalTypes.indexOf("async function runPgSuite"), evalTypes.indexOf("async function main"));
  assert.match(pgTypes, /token: teacherToken/);
  assert.doesNotMatch(pgTypes, /token: adminToken/);
}

assertHelpWriteArticlesAbsent();
assertTeacherRuntimeSource();

run(process.execPath, ["--test", "backend/lib/evaluationGradeEntry.test.js"]);
run(process.execPath, ["--test", "backend/lib/notesEvaluationsRbacLive.test.js"]);
run(process.execPath, ["--test", "backend/lib/criticalParityRbacCanonical.test.js"]);
run(process.execPath, ["backend/lib/noteContract.test.js"]);
run("npm", ["--prefix", "web", "run", "test", "--", "src/lib/evaluations.test.ts", "src/pages/GradesEvaluationsPage.test.tsx", "src/components/grades/GradeEntryGrid.test.tsx"]);
run("npx", ["--yes", "tsx", "Mobile/src/lib/evaluationsV2.test.ts"]);

console.log("OK: verify-notes-p1-teacher-runtime");
