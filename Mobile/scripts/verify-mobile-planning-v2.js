/**
 * LOT 3 — Planning weekly V2 + salles + remplacements (Mobile).
 *
 * Usage : npm run verify:mobile-planning-v2
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
  run("npx", ["--yes", "tsx", path.join("src", "lib", "planningV2.test.ts")], MOBILE);
  run("node", ["--test", path.join("lib", "planningWeekly.test.js")], BACKEND);
  run("node", ["--test", path.join("lib", "courseSchedulesRbacLive.test.js")], BACKEND);
  run("node", ["--test", path.join("lib", "planningCourseOptions.test.js")], BACKEND);

  const serverSrc = read(path.join(BACKEND, "server.js"));
  assert.match(serverSrc, /app\.get\("\/api\/course-schedules"/);
  assert.match(serverSrc, /app\.post\("\/api\/course-schedules"/);
  assert.match(serverSrc, /app\.patch\("\/api\/course-schedules\/:scheduleId"/);
  assert.match(serverSrc, /app\.delete\("\/api\/course-schedules\/:scheduleId"/);
  assert.match(serverSrc, /app\.get\("\/api\/school-rooms"/);
  assert.match(serverSrc, /app\.get\("\/api\/course-schedule-replacements"/);
  assert.match(serverSrc, /app\.post\("\/api\/course-schedule-replacements"/);
  assert.doesNotMatch(serverSrc, /app\.get\("\/api\/planning\/:id"/);
  assert.doesNotMatch(serverSrc, /app\.get\("\/api\/course-schedules\/:scheduleId"/);
  console.log("OK: contrat HTTP planning réel (pas de GET /planning/:id)");

  const weekly = read(path.join(BACKEND, "lib", "planningWeekly.js"));
  assert.match(weekly, /function mapWeeklyScheduleDto/);
  assert.match(weekly, /dayOfWeek/);
  assert.match(weekly, /startTime/);
  assert.match(weekly, /endTime/);
  assert.match(weekly, /classe déjà occupée/);
  assert.match(weekly, /enseignant déjà occupé/);
  assert.match(weekly, /salle déjà occupée/);
  console.log("OK: DTO weekly + 409 collisions distinctes");

  const pedagogy = read(path.join(BACKEND, "lib", "pedagogyService.js"));
  assert.match(pedagogy, /planning-course-options/);
  assert.match(pedagogy, /resolveTeacherIdForPrincipal/);
  assert.match(pedagogy, /ignoreClientScope/);
  console.log("OK: course options JWT-scoped + ignoreClientScope");

  const replacements = read(path.join(BACKEND, "lib", "courseScheduleReplacementsService.js"));
  assert.match(replacements, /overlayOccurrenceReplacement/);
  assert.match(replacements, /originalTeacherName/);
  assert.match(replacements, /substituteTeacherId/);
  assert.doesNotMatch(replacements, /w\.teacher_id = .*substitute/);
  console.log("OK: remplacements datés sans mutation du créneau maître");

  const api = read(path.join(SRC, "services", "api.ts"));
  assert.match(api, /function getPlanningWeekly/);
  assert.match(api, /["']\/course-schedules["']/);
  assert.match(api, /projection=planning-course-options/);
  assert.match(api, /function getSchoolRooms/);
  assert.match(api, /["']\/school-rooms["']/);
  assert.match(api, /function getCourseScheduleReplacements/);
  assert.match(api, /["']\/course-schedule-replacements["']/);
  assert.match(api, /function createCourseSchedule/);
  assert.match(api, /assertNoLegacyPlanningIdentity/);
  assert.doesNotMatch(api, /\/planning\/:id/);
  assert.doesNotMatch(api, /\/course-schedules\/:id["']/);
  console.log("OK: client API Mobile weekly / options / rooms / replacements");

  const timetable = stripComments(read(path.join(SRC, "screens", "TimetableScreen.tsx")));
  assert.match(timetable, /loadPlanningWeekly/);
  assert.match(timetable, /loadPlanningCourseOptions/);
  assert.match(timetable, /loadRooms/);
  assert.match(timetable, /loadReplacements/);
  assert.match(timetable, /dayOfWeek/);
  assert.match(timetable, /startTime/);
  assert.match(timetable, /endTime/);
  assert.match(timetable, /schoolCourseId/);
  assert.match(timetable, /roomId/);
  assert.match(timetable, /PLANNING_V2_COPY\.empty/);
  assert.match(timetable, /PLANNING_V2_COPY\.error/);
  assert.match(timetable, /PLANNING_V2_COPY\.usualTeacher/);
  assert.match(timetable, /PLANNING_V2_COPY\.replacedBy/);
  assert.match(timetable, /createCourseSchedule/);
  assert.match(timetable, /createCourseScheduleReplacement/);
  assert.doesNotMatch(timetable, /from ["']\.\.\/data\/catalog["']/);
  assert.doesNotMatch(timetable, /refreshBackOfficeState/);
  assert.doesNotMatch(timetable, /\btimetable\b/);
  assert.doesNotMatch(timetable, /groupSlotsByDay/);
  assert.doesNotMatch(timetable, /weekdayOf/);
  assert.doesNotMatch(timetable, /detectConflicts/);
  assert.doesNotMatch(timetable, /slot\.start\b/);
  assert.doesNotMatch(timetable, /slot\.end\b/);
  assert.doesNotMatch(timetable, /teacherScopedClassNames/);
  assert.doesNotMatch(timetable, /classNameMatches/);
  assert.doesNotMatch(timetable, /\bfetch\s*\(/);
  assert.doesNotMatch(timetable, /\baxios\b/);
  assert.doesNotMatch(timetable, /schoolCode:/);
  assert.doesNotMatch(timetable, /subject:/);
  assert.doesNotMatch(timetable, /room:\s*["']/);
  assert.doesNotMatch(timetable, /catch\(\s*\(\)\s*=>\s*\[\s*\]\s*\)/);
  console.log("OK: TimetableScreen weekly V2 sans modèle start/end / catalog / filtre client");

  const context = stripComments(read(path.join(SRC, "context", "AdminDataContext.tsx")));
  assert.match(context, /loadPlanningWeekly/);
  assert.match(context, /loadPlanningCourseOptions/);
  assert.match(context, /loadRooms/);
  assert.match(context, /loadReplacements/);
  assert.match(context, /getPlanningWeekly/);
  assert.match(context, /snapshotFromFailure/);
  const planningLoader = context.slice(
    context.indexOf("const loadPlanningWeekly"),
    context.indexOf("const loadPlanningCourseOptions"),
  );
  assert.doesNotMatch(planningLoader, /refreshBackOfficeState/);
  assert.doesNotMatch(planningLoader, /\.catch\(\s*\(\)\s*=>\s*\[\s*\]\s*\)/);
  assert.match(planningLoader, /snapshotFromFailure/);
  console.log("OK: loaders ciblés Planning (pas refreshBackOfficeState, pas catch [])");

  const v2 = read(path.join(SRC, "lib", "planningV2.ts"));
  assert.match(v2, /CanonicalWeeklySlot/);
  assert.match(v2, /buildCreateWeeklySlotPayload/);
  assert.match(v2, /schoolCourseId/);
  assert.match(v2, /roomId/);
  assert.match(v2, /stripPlanningClientScope/);
  assert.match(v2, /overlayReplacementForDate/);
  assert.match(v2, /Aucun créneau planifié/);
  assert.match(v2, /Impossible de charger le planning/);
  assert.match(v2, /Enseignant habituel/);
  assert.match(v2, /Remplacé par/);
  assert.match(v2, /Classe déjà occupée/);
  assert.match(v2, /Enseignant déjà occupé/);
  assert.match(v2, /Salle déjà occupée/);
  console.log("OK: helpers V2 identities canoniques + overlay remplacement");

  const constants = read(path.join(SRC, "lib", "constants.ts"));
  const permissions = read(path.join(SRC, "domain", "security", "permissions.ts"));
  assert.match(constants, /Timetable:\s*"Planning de cours"/);
  assert.match(permissions, /Timetable:\s*"Planning de cours"/);
  console.log("OK: RBAC Timetable → Planning de cours");

  const srcFiles = walk(SRC).map((file) => ({ file, source: stripComments(read(file)) }));
  const catchEmpty = srcFiles.filter(({ source }) => /\.catch\(\s*\(\)\s*=>\s*\[\s*\]\s*\)/.test(source));
  assert.deepStrictEqual(
    catchEmpty.map(({ file }) => rel(file)),
    [],
    `catch(() => []) interdit: ${catchEmpty.map(({ file }) => rel(file)).join(", ")}`,
  );

  const planningPath = [
    path.join(SRC, "screens", "TimetableScreen.tsx"),
    path.join(SRC, "lib", "planningV2.ts"),
    path.join(SRC, "services", "api.ts"),
  ].map((file) => ({ file, source: stripComments(read(file)) }));
  for (const { file, source } of planningPath) {
    assert.doesNotMatch(source, /catalog\.timetable|demoTimetable|MOCK_PLANNING/i, rel(file));
  }
  console.log("OK: aucune donnée démo / catalog timetable sur le parcours V2");

  console.log("verify:mobile-planning-v2 OK");
}

main();
