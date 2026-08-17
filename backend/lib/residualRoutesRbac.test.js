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

console.log("residualRoutesRbac.test.js: OK");
