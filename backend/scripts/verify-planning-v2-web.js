"use strict";

/**
 * Planning V2 — réexposition Web contrôlée.
 * Flag true, garde RBAC conservé, payload weekly, projection serveur, refresh ciblé.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function main() {
  const constants = read("web/src/lib/constants.ts");
  assert.match(constants, /export const PLANNING_WEB_UI_ENABLED = true/);
  assert.match(constants, /view: "planning", path: "\/planning", label: "Planning de cours"/);

  const permissions = read("web/src/lib/permissions.ts");
  assert.match(permissions, /viewName === "planning" && !PLANNING_WEB_UI_ENABLED/);

  const sync = read("web/src/lib/pedagogyPlanningSync.ts");
  assert.match(sync, /toWeeklyScheduleWritePayload/);
  assert.doesNotMatch(sync, /className: slot\.className/);
  assert.doesNotMatch(sync, /subject: slot\.subject/);

  const page = read("web/src/pages/CoursePlanningPage.tsx");
  assert.match(page, /schoolCourseId/);
  assert.match(page, /listPlanningCourseOptions/);
  assert.match(page, /planningNoSchedulableCoursesMessage/);
  assert.match(page, /listCourseScheduleOccurrences/);
  assert.match(page, /mapServerOccurrencesToCalendarEvents/);
  assert.match(page, /refresh\(\["courseSchedules"\]\)/);
  assert.doesNotMatch(page, /listSchoolCoursesForClass/);
  assert.doesNotMatch(page, /Créez-le dans Mon établissement/);
  assert.doesNotMatch(page, /slotsToClassCalendarEvents/);
  assert.doesNotMatch(page, /expandScheduleOccurrences/);
  assert.doesNotMatch(page, /await refresh\(\)/);
  assert.doesNotMatch(page, /Planifier un examen/);
  assert.doesNotMatch(page, /handleRepairPlanningData/);
  assert.match(page, /Annuler le créneau/);

  const api = read("web/src/lib/pedagogyApi.ts");
  assert.match(api, /listCourseScheduleOccurrences/);
  assert.match(api, /listPlanningCourseOptions/);
  assert.match(api, /projection: "course-options"/);
  assert.match(api, /from: query\.from/);
  assert.match(api, /to: query\.to/);

  const placeholders = read("web/src/pages/planning/PlanningPlaceholders.tsx");
  assert.match(placeholders, /ComingSoonState/);
  assert.match(placeholders, /title="Emploi du temps par salle"/);
  assert.doesNotMatch(placeholders, /title="Salles"/);
  assert.doesNotMatch(placeholders, /title="Remplacements"/);
  assert.match(read("web/src/pages/planning/PlanningRoomsPage.tsx"), /data-testid="planning-rooms-page"/);
  assert.match(read("web/src/pages/planning/PlanningSubstitutionsPage.tsx"), /data-testid="planning-replacements-page"/);
  assert.doesNotMatch(read("web/src/pages/CoursePlanningPage.tsx"), /Salles et remplacements ne sont pas/);
  assert.match(read("web/src/pages/CoursePlanningPage.tsx"), /planning-room-select/);

  const mobileConstants = read("Mobile/src/lib/constants.ts");
  assert.doesNotMatch(mobileConstants, /PLANNING_WEB_UI_ENABLED = true/);

  const routeMap = read("web/src/lib/routeDomainMap.ts");
  assert.match(routeMap, /prefix: "\/planning"/);
  assert.match(routeMap, /assignments/);
  assert.match(
    routeMap,
    /prefix: "\/planning", domains: \["academicConfigs", "courseSchedules", "classes", "teachers", "assignments"\]/,
  );

  const e2e = path.join(ROOT, "backend/scripts/verify-planning-v2-web-e2e.js");
  assert.ok(fs.existsSync(e2e), "E2E navigateur Planning manquant");

  console.log(
    "OK verify-planning-v2-web: flag, payload weekly, projection serveur, refresh ciblé, UI contrôlée",
  );
}

main();
