/**
 * LOT 2 — Notes & évaluations V2 (Mobile).
 *
 * Usage : npm run verify:mobile-evaluations-v2
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "Mobile");
const SRC = path.join(MOBILE, "src");
const BACKEND = path.join(ROOT, "backend");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function rel(file) {
  return path.relative(ROOT, file);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "build", ".expo", "android", "ios", "coverage"].includes(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { encoding: "utf8", cwd });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout || result.error}`,
    );
  }
  process.stdout.write(result.stdout);
}

function main() {
  run("npx", ["--yes", "tsx", path.join("src", "lib", "evaluationsV2.test.ts")], MOBILE);
  run("node", ["--test", path.join("lib", "evaluationGradeEntry.test.js")], BACKEND);
  run("node", ["--test", path.join("lib", "notesEvaluationsRbacLive.test.js")], BACKEND);

  const serverSrc = read(path.join(BACKEND, "server.js"));
  assert.match(serverSrc, /app\.get\("\/api\/evaluations"/);
  assert.match(serverSrc, /app\.post\("\/api\/evaluations"/);
  assert.match(serverSrc, /app\.patch\("\/api\/evaluations\/:evaluationId"/);
  assert.match(serverSrc, /app\.post\("\/api\/notes"/);
  assert.doesNotMatch(serverSrc, /app\.get\("\/api\/evaluations\/:evaluationId"/);
  assert.doesNotMatch(serverSrc, /app\.post\("\/api\/notes\/batch"/);
  assert.match(serverSrc, /listSchoolEvaluations/);
  assert.match(serverSrc, /filterNotesForPrincipal/);
  assert.match(serverSrc, /ignoreClientScope\(req\.body/);
  console.log("OK: contrat HTTP evaluations/notes réel (pas de GET by id, pas de batch inventé)");

  const pedagogy = read(path.join(BACKEND, "lib", "pedagogyManagement.js"));
  assert.match(pedagogy, /function ignoreClientScope/);
  assert.match(pedagogy, /delete next\.schoolCode/);
  console.log("OK: ignoreClientScope retire le tenant client");

  const pgStore = read(path.join(BACKEND, "db", "postgresRepository.js"));
  assert.match(pgStore, /assertTeacherCannotValidateEvaluation\(principal, status\)/);
  assert.match(pgStore, /if \(principal && !existing\) \{\s*\n\s*const \{ assertTeacherCannotValidateEvaluation \}/);
  console.log("OK: enseignant ne peut pas créer/valider Validée côté PG");

  const listEval = pgStore.slice(
    pgStore.indexOf("async listSchoolEvaluations"),
    pgStore.indexOf("ORDER BY e.created_at DESC"),
  );
  assert.match(listEval, /isTeacher/);
  assert.match(listEval, /teacher_assignments/);
  assert.match(listEval, /isParentOrStudent/);
  assert.match(listEval, /status = 'published'/);
  console.log("OK: GET evaluations scoped JWT enseignant / parent publié");

  const api = read(path.join(SRC, "services", "api.ts"));
  assert.match(api, /function getEvaluations/);
  assert.match(api, /["']\/evaluations["']/);
  assert.match(api, /function createEvaluation/);
  assert.match(api, /function updateEvaluation/);
  assert.match(api, /delete body\.status/);
  assert.match(api, /stripEvaluationClientScope/);
  assert.match(api, /function saveNote/);
  assert.doesNotMatch(api, /\/notes\/batch/);
  assert.doesNotMatch(api, /\/evaluations\/:id/);
  console.log("OK: client API Mobile GET/POST/PATCH evaluations + POST notes unitaire");

  const gradesScreen = stripComments(read(path.join(SRC, "screens", "TeacherGradesScreen.tsx")));
  assert.match(gradesScreen, /loadEvaluations/);
  assert.match(gradesScreen, /loadEvaluation/);
  assert.match(gradesScreen, /loadEvaluationGrades/);
  assert.match(gradesScreen, /createEvaluation/);
  assert.match(gradesScreen, /updateEvaluation/);
  assert.match(gradesScreen, /saveNote/);
  assert.match(gradesScreen, /buildCreateEvaluationPayload/);
  assert.match(gradesScreen, /buildValidateEvaluationPatch/);
  assert.match(gradesScreen, /evaluationId/);
  assert.match(gradesScreen, /classId/);
  assert.doesNotMatch(gradesScreen, /from ["']\.\.\/data\/catalog["']/);
  assert.doesNotMatch(gradesScreen, /GradeBookService/);
  assert.doesNotMatch(gradesScreen, /refreshBackOfficeState/);
  assert.doesNotMatch(gradesScreen, /\bfetch\s*\(/);
  assert.doesNotMatch(gradesScreen, /\baxios\b/);
  assert.doesNotMatch(gradesScreen, /teacherId:/);
  assert.doesNotMatch(gradesScreen, /status:\s*["']Validée["']/);
  assert.doesNotMatch(gradesScreen, /Trimestre 1/);
  assert.doesNotMatch(gradesScreen, /catch\(\s*\(\)\s*=>\s*\[\s*\]\s*\)/);
  console.log("OK: TeacherGradesScreen V2 sans catalog / mock / teacherId forgé / Validée client");

  const studentNotes = stripComments(read(path.join(SRC, "screens", "StudentNotesScreen.tsx")));
  assert.match(studentNotes, /loadNotes/);
  assert.match(studentNotes, /canonicalWeightedAverage/);
  assert.match(studentNotes, /notesForStudent/);
  assert.doesNotMatch(studentNotes, /GradeBookService/);
  assert.doesNotMatch(studentNotes, /from ["']\.\.\/data\/catalog["']/);
  assert.doesNotMatch(studentNotes, /Trimestre 1/);
  assert.doesNotMatch(studentNotes, /generateReport/);
  console.log("OK: StudentNotesScreen consultation canonique");

  const home = stripComments(read(path.join(SRC, "screens", "HomeScreen.tsx")));
  assert.match(home, /canonicalWeightedAverage/);
  assert.match(home, /parentAverageDisplay/);
  assert.match(home, /loadNotes/);
  assert.doesNotMatch(home, /getStudentAcademicSummary/);
  assert.doesNotMatch(home, /GradeBookService/);
  console.log("OK: dashboard Parent moyenne canonique / indisponible");

  const context = stripComments(read(path.join(SRC, "context", "AdminDataContext.tsx")));
  assert.match(context, /loadEvaluations/);
  assert.match(context, /loadEvaluation/);
  assert.match(context, /loadEvaluationGrades/);
  assert.match(context, /loadNotes/);
  assert.match(context, /getEvaluations/);
  console.log("OK: loaders ciblés evaluations/notes (pas un snapshot global pour ce lot)");

  const v2 = read(path.join(SRC, "lib", "evaluationsV2.ts"));
  assert.match(v2, /evaluationId obligatoire/);
  assert.match(v2, /teacherCreatePayloadContainsForbiddenFields/);
  assert.match(v2, /rosterStudentsForEvaluation/);
  assert.match(v2, /canonicalWeightedAverage/);
  console.log("OK: helpers V2 evaluationId / scope / moyenne normalisée");

  const srcFiles = walk(SRC).map((file) => ({ file, source: stripComments(read(file)) }));
  const catchEmpty = srcFiles.filter(({ source }) => /\.catch\(\s*\(\)\s*=>\s*\[\s*\]\s*\)/.test(source));
  assert.deepStrictEqual(
    catchEmpty.map(({ file }) => rel(file)),
    [],
    `catch(() => []) interdit: ${catchEmpty.map(({ file }) => rel(file)).join(", ")}`,
  );

  const gradesAndNotes = [
    path.join(SRC, "screens", "TeacherGradesScreen.tsx"),
    path.join(SRC, "screens", "StudentNotesScreen.tsx"),
    path.join(SRC, "lib", "evaluationsV2.ts"),
  ].map((file) => ({ file, source: stripComments(read(file)) }));
  for (const { file, source } of gradesAndNotes) {
    assert.doesNotMatch(source, /demoNotes|MOCK_EVAL|fakeEvaluation|catalog\.notes/i, rel(file));
  }
  console.log("OK: aucune donnée démo / catalog notes sur le parcours V2");

  console.log("verify:mobile-evaluations-v2 OK");
}

main();
