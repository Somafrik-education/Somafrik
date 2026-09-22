"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { RbacService, routePermissions } = require("../services/rbacService");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function parentDefaultsBlock(source) {
  const start = source.indexOf("  Parent: [");
  const end = source.indexOf('  "Élève / Étudiant": [', start);
  assert.ok(start >= 0 && end > start, "bloc Parent introuvable");
  return source.slice(start, end);
}

test("PARENT-COM-01 — defaults Web/Mobile = Messages READ sans CREATE", () => {
  for (const relative of [
    "web/src/lib/internalRoleDefaults.ts",
    "Mobile/src/lib/internalRoleDefaults.ts",
  ]) {
    const block = parentDefaultsBlock(read(relative));
    assert.match(block, /"Messages:READ"/, relative + " doit conserver Messages:READ");
    assert.doesNotMatch(
      block,
      /"Messages:CREATE"/,
      relative + " ne doit pas accorder Messages:CREATE par défaut au Parent",
    );
  }
});

test("PARENT-COM-02 — seed/mémoire Parent lit mais ne compose pas", () => {
  const rbac = new RbacService();
  const parent = { role: "parent_student" };

  assert.equal(rbac.canAccess(parent, "GET /api/backoffice/messages"), true);
  assert.equal(rbac.canAccess(parent, "GET /api/backoffice/conversations"), true);
  assert.equal(rbac.canAccess(parent, "GET /api/backoffice/messages/recipients"), false);
  assert.equal(rbac.canAccess(parent, "POST /api/backoffice/messages"), false);
  assert.equal(rbac.canAccess(parent, "POST /api/backoffice/conversations"), false);
  assert.equal(
    rbac.canAccess(parent, "POST /api/backoffice/conversations/:conversationId/messages"),
    false,
  );
  assert.equal(
    rbac.canAccess(parent, "POST /api/backoffice/communications/attachments"),
    false,
  );
});

test('PARENT-COM-03 — legacy "Messages école" reste strictement READ', () => {
  const rbac = new RbacService();
  const parent = { role: "parent_student", permissions: ["Messages école"] };

  assert.equal(rbac.canAccess(parent, "GET /api/backoffice/messages"), true);
  assert.equal(rbac.canAccess(parent, "GET /api/backoffice/conversations"), true);
  assert.equal(rbac.canAccess(parent, "GET /api/backoffice/messages/recipients"), false);
  assert.equal(rbac.canAccess(parent, "POST /api/backoffice/messages"), false);
  assert.equal(
    rbac.canAccess(parent, "POST /api/backoffice/conversations/:conversationId/messages"),
    false,
  );

  assert.equal(
    routePermissions["POST /api/backoffice/messages"].includes("Messages école"),
    false,
    "l'alias Parent de lecture ne doit jamais réapparaître dans une route POST",
  );
});

test("PARENT-COM-04 — CREATE explicite reste la seule extension Parent canonique", () => {
  const rbac = new RbacService();
  const parent = {
    role: "parent_student",
    permissions: ["Messages:READ", "Messages:CREATE"],
  };

  assert.equal(rbac.canAccess(parent, "GET /api/backoffice/messages/recipients"), true);
  assert.equal(rbac.canAccess(parent, "POST /api/backoffice/messages"), true);
  assert.equal(rbac.canAccess(parent, "POST /api/backoffice/conversations"), true);
  assert.equal(
    rbac.canAccess(parent, "POST /api/backoffice/conversations/:conversationId/messages"),
    true,
  );
});

test('PARENT-COM-05 — legacy staff "Messages parents" conserve la compatibilité écriture', () => {
  const rbac = new RbacService();
  const staff = { role: "teacher", permissions: ["Messages parents"] };

  assert.equal(rbac.canAccess(staff, "GET /api/backoffice/messages"), true);
  assert.equal(rbac.canAccess(staff, "GET /api/backoffice/messages/recipients"), true);
  assert.equal(rbac.canAccess(staff, "POST /api/backoffice/messages"), true);
});
