"use strict";

const assert = require("node:assert/strict");
const { RbacService, routePermissions } = require("../services/rbacService");

const teacherPrincipal = {
  role: "Enseignant",
  permissions: ["Examens:READ", "Bulletins:READ", "Documents:READ", "Voir tableau de bord"],
};

const rbac = new RbacService();

assert.ok(
  rbac.canAccess(teacherPrincipal, "GET /api/backoffice/planning-exams"),
  "Enseignant avec Examens:READ peut lire planning-exams",
);
assert.ok(
  rbac.canAccess(teacherPrincipal, "GET /api/backoffice/report-cards"),
  "Enseignant avec Bulletins:READ peut lire report-cards",
);
assert.ok(
  rbac.canAccess(teacherPrincipal, "GET /api/backoffice/establishment-documents"),
  "Enseignant avec Documents:READ peut lire establishment-documents",
);
assert.equal(
  rbac.canAccess(teacherPrincipal, "PUT /api/backoffice/planning-exams"),
  false,
  "Enseignant read-only ne peut pas écrire planning-exams",
);
assert.equal(
  rbac.canAccess(teacherPrincipal, "PUT /api/backoffice/report-cards"),
  false,
  "Enseignant read-only ne peut pas écrire report-cards",
);
assert.equal(
  rbac.canAccess(teacherPrincipal, "PUT /api/backoffice/establishment-documents"),
  false,
  "Enseignant read-only ne peut pas écrire establishment-documents",
);

assert.ok(routePermissions["GET /api/backoffice/planning-exams"]?.includes("Examens:READ"));
assert.ok(routePermissions["GET /api/backoffice/report-cards"]?.includes("Bulletins:READ"));
assert.ok(routePermissions["GET /api/backoffice/establishment-documents"]?.includes("Documents:READ"));

assert.ok(rbac.canAccess(teacherPrincipal, "GET /api/exams"), "Enseignant avec Examens:READ peut lire /api/exams");
assert.equal(rbac.canAccess(teacherPrincipal, "POST /api/exams"), false, "Enseignant read-only ne peut pas POST /api/exams");

assert.ok(routePermissions["GET /api/presences"]?.includes("Présences:READ"));
assert.ok(routePermissions["POST /api/presences"]?.includes("Présences:CREATE"));
assert.ok(routePermissions["POST /api/presences"]?.includes("Présences:UPDATE"));
assert.ok(routePermissions["GET /api/students/:id/presences"]?.includes("Présences:READ"));
assert.equal(
  rbac.canAccess(teacherPrincipal, "GET /api/presences"),
  false,
  "Enseignant sans Présences:READ ne lit pas /api/presences",
);
assert.ok(
  rbac.canAccess({ ...teacherPrincipal, permissions: ["Présences:READ"] }, "GET /api/presences"),
  "Enseignant avec Présences:READ lit /api/presences",
);

assert.ok(routePermissions["GET /api/academic-config"]?.includes("Paramètres Établissement:READ"));
assert.ok(routePermissions["GET /api/academic-config"]?.includes("Référentiels pédagogiques:READ"));
assert.ok(routePermissions["GET /api/academic-config"]?.includes("Classes:READ"));
assert.equal(
  rbac.canAccess(teacherPrincipal, "GET /api/academic-config"),
  false,
  "Enseignant sans Classes:READ ne lit pas academic-config",
);
assert.ok(
  rbac.canAccess({ ...teacherPrincipal, permissions: ["Classes:READ"] }, "GET /api/academic-config"),
  "Enseignant avec Classes:READ lit academic-config",
);
assert.equal(routePermissions["POST /api/backoffice/education-levels"]?.includes("COUNTRY_PRIVILEGES"), false);
assert.equal(routePermissions["POST /api/backoffice/education-class-groups"]?.includes("COUNTRY_PRIVILEGES"), false);
assert.ok(routePermissions["PATCH /api/backoffice/education-reference/labels"]?.includes("Référentiels pédagogiques:UPDATE"));

assert.deepEqual(routePermissions["GET /api/course-schedules"], ["Planning de cours:READ", "ALL_PRIVILEGES"]);
assert.deepEqual(routePermissions["GET /api/mobile-sync/l1/course-schedules"], ["Planning de cours:READ", "ALL_PRIVILEGES"]);
assert.deepEqual(routePermissions["POST /api/course-schedules"], ["Planning de cours:CREATE", "ALL_PRIVILEGES"]);
assert.deepEqual(routePermissions["PATCH /api/course-schedules/:scheduleId"], ["Planning de cours:UPDATE", "ALL_PRIVILEGES"]);
assert.deepEqual(routePermissions["DELETE /api/course-schedules/:scheduleId"], ["Planning de cours:DELETE", "ALL_PRIVILEGES"]);
assert.equal(
  rbac.canAccess(teacherPrincipal, "GET /api/course-schedules"),
  false,
  "Enseignant sans Planning de cours:READ ne lit pas /api/course-schedules",
);
assert.ok(
  rbac.canAccess({ ...teacherPrincipal, permissions: ["Planning de cours:READ"] }, "GET /api/course-schedules"),
  "Enseignant avec Planning de cours:READ lit /api/course-schedules",
);
assert.equal(
  rbac.canAccess({ ...teacherPrincipal, permissions: ["Planning de cours:READ"] }, "POST /api/course-schedules"),
  false,
  "Enseignant READ-only ne crée pas de créneau",
);
assert.deepEqual(routePermissions["GET /api/school-rooms"], ["Salles:READ", "ALL_PRIVILEGES"]);
assert.deepEqual(routePermissions["GET /api/course-schedule-replacements"], ["Remplacements:READ", "ALL_PRIVILEGES"]);
assert.deepEqual(routePermissions["GET /api/course-schedule-replacements/options"], ["Remplacements:CREATE", "ALL_PRIVILEGES"]);
assert.deepEqual(routePermissions["POST /api/course-schedule-replacements"], ["Remplacements:CREATE", "ALL_PRIVILEGES"]);
assert.equal(rbac.canAccess(teacherPrincipal, "GET /api/school-rooms"), false);
assert.ok(rbac.canAccess({ ...teacherPrincipal, permissions: ["Salles:READ"] }, "GET /api/school-rooms"));
assert.equal(rbac.canAccess({ ...teacherPrincipal, permissions: ["Salles:READ"] }, "POST /api/school-rooms"), false);
assert.ok(
  rbac.canAccess({ ...teacherPrincipal, permissions: ["Remplacements:READ"] }, "GET /api/course-schedule-replacements"),
  "Enseignant GET /replacements → 200 (ses lignes)",
);
assert.equal(
  rbac.canAccess({ ...teacherPrincipal, permissions: ["Remplacements:READ"] }, "GET /api/course-schedule-replacements/options"),
  false,
  "Enseignant GET /replacements/options → 403",
);
assert.ok(
  rbac.canAccess({ role: "Préfet des études", permissions: ["Remplacements:CREATE"] }, "GET /api/course-schedule-replacements/options"),
  "Préfet GET /options → 200",
);
assert.ok(
  rbac.canAccess({ role: "Admin School", permissions: ["Remplacements:CREATE"] }, "GET /api/course-schedule-replacements/options"),
  "Admin GET /options → 200",
);
assert.equal(rbac.canAccess({ role: "Parent", permissions: ["Élèves:READ"] }, "GET /api/course-schedule-replacements"), false);
assert.equal(rbac.canAccess({ role: "Secrétaire", permissions: ["Élèves:READ"] }, "GET /api/school-rooms"), false);
