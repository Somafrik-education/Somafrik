"use strict";

/**
 * P1-06 — Planning / L1 school-courses / mobileSync / candidats professeur
 * titulaire : Superadmin et Admin Pays sont fail-closed. Ils ne sont pas un
 * Admin School. Un schoolCode request-scoped ne rouvre pas ces voies.
 *
 *   node --test backend/lib/planningSyncDeny.p1-06.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { RbacService } = require("../services/rbacService");
const {
  SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM,
  PLATFORM_ADMIN_ALLOWED,
  isPlatformPersonalDataForbidden,
  isPlatformPersonalDataForbiddenHttp,
} = require("./platformPersonalDataGuard");
const {
  resolvePlanningSchoolScope,
  filterPlanningRows,
  assertPlanningReadable,
  attachPlanningMembershipScope,
  attachPlanningFixtureScope,
} = require("./planningSchoolScope");
const {
  resolveClassesSyncScope,
  resolveStudentsSyncScope,
  resolveAssignmentsSyncScope,
  resolveSchoolCoursesSyncScope,
  resolveCourseSchedulesSyncScope,
  resolveLiveClassesSyncSnapshot,
  resolveLiveSchoolCoursesSyncSnapshot,
  resolveLiveCourseSchedulesSyncSnapshot,
} = require("./mobileSyncScope");
const {
  SCHOOL_WIDE_STUDENT_READ_ROLES,
  principalHasClassAccess,
  scopeSchoolStudentsForPrincipal,
  scopeSchoolClassesForPrincipal,
} = require("./classStudentsAuthz");

const SCHOOL_A = "CD-LAC-26-001";
const SCHOOL_B = "BI-BUJ-26-001";
const SCHOOL_ID_A = "11111111-1111-4111-8111-111111111111";

const P1_06_FORBIDDEN = [
  "GET /api/mobile-sync/l1/school-courses",
  "GET /api/mobile-sync/l1/course-schedules",
  "GET /api/course-schedules",
  "POST /api/course-schedules",
  "PATCH /api/course-schedules/:scheduleId",
  "DELETE /api/course-schedules/:scheduleId",
  "GET /api/classes/:classCode/head-teacher/candidates",
  "PUT /api/classes/:classCode/head-teacher",
  "DELETE /api/classes/:classCode/head-teacher",
];

const SUPER = {
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES", "Planning de cours:READ", "Matières:READ", "Gérer classes"],
  schoolCode: "*",
};

const SUPER_SCOPED = {
  ...SUPER,
  schoolCode: "",
  effectiveSchoolCode: SCHOOL_A,
  schoolScopeSource: "request",
  planningLoginCode: SCHOOL_A,
  planningSchoolId: SCHOOL_ID_A,
};

const COUNTRY = {
  role: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES", "Planning de cours:READ"],
  schoolCode: "*",
  countryCode: "CD",
};

const COUNTRY_SCOPED = {
  ...COUNTRY,
  schoolCode: SCHOOL_A,
  effectiveSchoolCode: SCHOOL_A,
  schoolScopeSource: "request",
  planningLoginCode: SCHOOL_A,
  planningSchoolId: SCHOOL_ID_A,
};

const SCHOOL_ADMIN = {
  role: "Admin School",
  roleKeys: ["SCHOOL_ADMIN"],
  permissions: [
    "Planning de cours:READ",
    "Planning de cours:CREATE",
    "Matières:READ",
    "Gérer classes",
    "Classes:UPDATE",
    "Voir classes",
  ],
  schoolCode: SCHOOL_A,
  planningLoginCode: SCHOOL_A,
  planningSchoolId: SCHOOL_ID_A,
};

const TEACHER = {
  role: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: ["Planning de cours:READ", "Matières:READ", "Voir classes"],
  schoolCode: SCHOOL_A,
  planningLoginCode: SCHOOL_A,
  planningSchoolId: SCHOOL_ID_A,
  assignments: [{ classId: "class-a", classCode: "CLS-A", status: "active" }],
};

function expect403(error) {
  return error?.statusCode === 403;
}

test("P1-06 Superadmin / Admin Pays → Planning mode none, jamais all/country", () => {
  assert.equal(resolvePlanningSchoolScope(null).mode, "none");
  assert.equal(resolvePlanningSchoolScope(SUPER).mode, "none");
  assert.equal(resolvePlanningSchoolScope(SUPER_SCOPED).mode, "none");
  assert.equal(resolvePlanningSchoolScope({ role: "super_admin", roleKeys: ["SUPER_ADMIN"] }).mode, "none");
  assert.equal(resolvePlanningSchoolScope(COUNTRY).mode, "none");
  assert.equal(resolvePlanningSchoolScope(COUNTRY_SCOPED).mode, "none");
  assert.equal(filterPlanningRows([{ schoolCode: SCHOOL_A, schoolId: SCHOOL_ID_A }], resolvePlanningSchoolScope(SUPER)).length, 0);
  assert.throws(() => assertPlanningReadable(SUPER), expect403);
  assert.throws(() => assertPlanningReadable(COUNTRY_SCOPED), expect403);
});

test("P1-06 Admin School / Teacher conservent le Planning de leur établissement", () => {
  const adminScope = resolvePlanningSchoolScope(SCHOOL_ADMIN);
  assert.equal(adminScope.mode, "school");
  assert.equal(adminScope.loginCode, SCHOOL_A);
  assert.doesNotThrow(() => assertPlanningReadable(SCHOOL_ADMIN));
  const teacherScope = resolvePlanningSchoolScope(TEACHER);
  assert.equal(teacherScope.mode, "school");
  assert.doesNotThrow(() => assertPlanningReadable(TEACHER));
});

test("P1-06 attach / fixture Superadmin ne rouvre pas le Planning", async () => {
  const attached = await attachPlanningMembershipScope(SUPER_SCOPED, async () => {
    throw new Error("lookup école interdit pour Superadmin Planning");
  });
  assert.equal(attached.planningLoginCode, SCHOOL_A);
  assert.equal(resolvePlanningSchoolScope(attached).mode, "none");
  const fixture = attachPlanningFixtureScope(SUPER);
  assert.equal(resolvePlanningSchoolScope(fixture).mode, "none");
});

test("P1-06 HTTP L1 school-courses / course-schedules / planning / candidats refusés", () => {
  const rbac = new RbacService();
  for (const route of P1_06_FORBIDDEN) {
    assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(route), true, route);
    assert.equal(PLATFORM_ADMIN_ALLOWED.includes(route), false, route);
    assert.equal(isPlatformPersonalDataForbidden(SUPER, route), true, `super ${route}`);
    assert.equal(isPlatformPersonalDataForbidden(SUPER_SCOPED, route), true, `super+school ${route}`);
    assert.equal(isPlatformPersonalDataForbidden(COUNTRY, route), true, `country ${route}`);
    assert.equal(rbac.canAccess(SUPER, route), false, `rbac super ${route}`);
    assert.equal(rbac.canAccess(COUNTRY, route), false, `rbac country ${route}`);
  }
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/mobile-sync/l1/school-courses"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/mobile-sync/l1/course-schedules"), true);
  assert.equal(isPlatformPersonalDataForbiddenHttp(COUNTRY, "GET", "/api/course-schedules"), true);
  assert.equal(
    isPlatformPersonalDataForbiddenHttp(SUPER, "GET", "/api/classes/CLS-A/head-teacher/candidates"),
    true,
  );
  assert.equal(isPlatformPersonalDataForbiddenHttp(SCHOOL_ADMIN, "GET", "/api/course-schedules"), false);
  assert.equal(isPlatformPersonalDataForbidden(SCHOOL_ADMIN, "GET /api/course-schedules"), false);
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, "GET /api/course-schedules"), true);
  assert.equal(rbac.canAccess(TEACHER, "GET /api/course-schedules"), true);
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, "GET /api/classes/:classCode/head-teacher/candidates"), true);
  assert.equal(rbac.canAccess(TEACHER, "GET /api/classes/:classCode/head-teacher/candidates"), false);
});

test("P1-06 GET /api/classes et L1 classes restent des métadonnées plateforme", () => {
  const rbac = new RbacService();
  assert.equal(isPlatformPersonalDataForbidden(SUPER, "GET /api/classes"), false);
  assert.equal(isPlatformPersonalDataForbidden(SUPER, "GET /api/mobile-sync/l1/classes"), false);
  assert.equal(PLATFORM_ADMIN_ALLOWED.includes("GET /api/classes"), true);
  assert.equal(PLATFORM_ADMIN_ALLOWED.includes("GET /api/mobile-sync/l1/classes"), true);
  assert.equal(rbac.canAccess(SUPER, "GET /api/classes"), true);
  assert.equal(rbac.canAccess(SCHOOL_ADMIN, "GET /api/classes"), true);
});

test("P1-06 mobileSync Superadmin / Admin Pays = none, pas school-wide", () => {
  for (const resolve of [
    resolveClassesSyncScope,
    resolveStudentsSyncScope,
    resolveAssignmentsSyncScope,
    resolveSchoolCoursesSyncScope,
    resolveCourseSchedulesSyncScope,
  ]) {
    assert.equal(resolve(SUPER).scopeKind, "none", resolve.name);
    assert.equal(resolve(SUPER_SCOPED).scopeKind, "none", resolve.name);
    assert.equal(resolve(COUNTRY).scopeKind, "none", resolve.name);
    assert.equal(resolve(COUNTRY_SCOPED).scopeKind, "none", resolve.name);
    assert.equal(resolve({ role: "super_admin", roleKeys: ["SUPER_ADMIN"] }).scopeKind, "none", resolve.name);
  }
  assert.equal(resolveClassesSyncScope(SCHOOL_ADMIN).scopeKind, "school-wide");
  assert.equal(resolveStudentsSyncScope(SCHOOL_ADMIN).scopeKind, "school-wide");
  assert.equal(resolveAssignmentsSyncScope(SCHOOL_ADMIN).scopeKind, "school-wide");
  assert.equal(resolveSchoolCoursesSyncScope(SCHOOL_ADMIN).scopeKind, "school-wide");
  assert.equal(resolveCourseSchedulesSyncScope(SCHOOL_ADMIN).scopeKind, "school-wide");
  assert.equal(resolveClassesSyncScope(TEACHER).scopeKind, "assigned");
  assert.equal(resolveSchoolCoursesSyncScope(TEACHER).scopeKind, "assigned");
  assert.equal(resolveCourseSchedulesSyncScope(TEACHER).scopeKind, "assigned");
});

test("P1-06 snapshot live Superadmin ignore un rôle établissement du tenant", async () => {
  const repo = {
    async listActiveUserRoleKeysForSchool() {
      throw new Error("live school roles interdits pour Superadmin");
    },
    async resolveEffectivePermissions() {
      throw new Error("permissions live interdites pour Superadmin");
    },
  };
  const schoolRef = { schoolCode: SCHOOL_A, schoolId: SCHOOL_ID_A };
  const classes = await resolveLiveClassesSyncSnapshot(repo, SUPER_SCOPED, schoolRef);
  const courses = await resolveLiveSchoolCoursesSyncSnapshot(repo, SUPER, schoolRef);
  const schedules = await resolveLiveCourseSchedulesSyncSnapshot(repo, COUNTRY_SCOPED, schoolRef);
  assert.equal(classes.scope.scopeKind, "none");
  assert.equal(courses.scope.scopeKind, "none");
  assert.equal(schedules.scope.scopeKind, "none");
});

test("P1-06 Admin Pays retiré de SCHOOL_WIDE_STUDENT_READ_ROLES", () => {
  assert.equal(SCHOOL_WIDE_STUDENT_READ_ROLES.has("Admin Pays"), false);
  assert.equal(SCHOOL_WIDE_STUDENT_READ_ROLES.has("Admin School"), true);
  assert.equal(principalHasClassAccess(COUNTRY, "Classe A"), false);
  assert.throws(
    () => scopeSchoolStudentsForPrincipal(COUNTRY, [{ id: "STU-1" }], () => undefined),
    expect403,
  );
  assert.deepEqual(scopeSchoolClassesForPrincipal(COUNTRY, [{ id: "cls-1" }]), [{ id: "cls-1" }]);
  assert.deepEqual(scopeSchoolClassesForPrincipal(SCHOOL_ADMIN, [{ id: "cls-1" }]), [{ id: "cls-1" }]);
});

test("garde source P1-06 : resolvePlanningSchoolScope ne produit plus mode all", () => {
  const source = fs.readFileSync(path.join(__dirname, "planningSchoolScope.js"), "utf8");
  const resolveFn = source.slice(
    source.indexOf("function resolvePlanningSchoolScope"),
    source.indexOf("function sqlPlanningScope"),
  );
  assert.match(resolveFn, /if \(!principal\) \{\s*return \{ mode: "none" \}/);
  assert.doesNotMatch(resolveFn, /mode:\s*["']all["']/);
  assert.doesNotMatch(resolveFn, /return \{ mode: "all" \}/);
  assert.match(resolveFn, /isPlatformAdminPrincipal\(principal\)/);
  assert.doesNotMatch(resolveFn, /require\("\.\/superadminPrincipal"\)/);

  const syncSource = fs.readFileSync(path.join(__dirname, "mobileSyncScope.js"), "utf8");
  assert.match(syncSource, /isPlatformAdminPrincipal\(principal\)/);
  assert.doesNotMatch(
    syncSource,
    /SUPER_ADMIN_ROLES\.has\(principal\.role\) \|\| principalHasAnyRole\(principal, SUPER_ADMIN_ROLES\)/,
  );
});
