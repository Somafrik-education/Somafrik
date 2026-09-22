const test = require("node:test");
const assert = require("node:assert/strict");
const { RbacService, routePermissions } = require("../services/rbacService");

test("P0 production : Voir élèves ouvre la liste déjà filtrée par affectations", () => {
  const rbac = new RbacService();
  const teacher = { role: "Enseignant", permissions: ["Voir élèves"] };

  assert.equal(rbac.canAccess(teacher, "GET /api/students"), true);
  assert.equal(rbac.canAccess(teacher, "GET /api/students/:id"), true);
  assert.equal(rbac.canAccess(teacher, "GET /api/classes/:classCode/students"), true);
  assert.equal(rbac.canAccess(teacher, "GET /api/mobile-sync/l1/students"), true);
  assert.ok(routePermissions["GET /api/students"].includes("Voir élèves"));
});

test("P0 production : alias communication staff écrit, alias Parent reste lecture seule", () => {
  const rbac = new RbacService();
  const teacher = { role: "Enseignant", permissions: ["Messages parents"] };
  const parent = { role: "Parent", permissions: ["Messages école"] };
  const readRoutes = [
    "GET /api/backoffice/messages",
    "GET /api/backoffice/messages/unread-count",
    "GET /api/backoffice/conversations",
  ];
  const writeRoutes = [
    "POST /api/backoffice/messages",
    "POST /api/backoffice/conversations",
    "POST /api/backoffice/conversations/:conversationId/messages",
  ];

  for (const route of readRoutes) {
    assert.equal(rbac.canAccess(teacher, route), true, `enseignant ${route}`);
    assert.equal(rbac.canAccess(parent, route), true, `parent ${route}`);
  }
  for (const route of writeRoutes) {
    assert.equal(rbac.canAccess(teacher, route), true, `enseignant ${route}`);
    assert.equal(rbac.canAccess(parent, route), false, `parent read-only ${route}`);
  }
  assert.equal(
    rbac.canAccess(parent, "GET /api/backoffice/messages/recipients"),
    false,
    "le Parent sans CREATE ne doit pas charger les destinataires de composition",
  );
});

test("P0 production : aucun alias métier n'accorde la gestion des utilisateurs", () => {
  const rbac = new RbacService();
  const teacher = {
    role: "Enseignant",
    permissions: ["Voir élèves", "Messages parents", "Créer notes", "Modifier notes"],
  };

  assert.equal(rbac.canAccess(teacher, "POST /api/users/:id/reset-password"), false);
  assert.equal(rbac.canAccess(teacher, "POST /api/backoffice/users/:userId/roles/grant"), false);
});
