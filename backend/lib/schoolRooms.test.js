"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { formatRoomCode, extractRoomSequence } = require("./roomCodeAllocation");
const { parseEquipment, parseCapacity } = require("./schoolRoomsService");
const { parseOccurrenceDate } = require("./courseScheduleReplacementsService");
const { PEDAGOGY_ERROR } = require("./pedagogyManagement");
const { routePermissions } = require("../services/rbacService");
const { RbacService } = require("../services/rbacService");
const { CANONICAL_ROOMS_ROLE_GRANTS, CANONICAL_REPLACEMENTS_ROLE_GRANTS } = require("./planningRoomsReplacementsRbac");

test("codes salle SAL-####", () => {
  assert.equal(formatRoomCode(1), "SAL-0001");
  assert.equal(extractRoomSequence("SAL-0042"), 42);
  assert.equal(extractRoomSequence("A01"), null);
});

test("équipements et capacité", () => {
  assert.deepEqual(parseEquipment("Tableau, projecteur"), ["Tableau", "projecteur"]);
  assert.equal(parseCapacity(""), null);
  assert.equal(parseCapacity(40), 40);
  assert.throws(() => parseCapacity(0));
});

test("occurrenceDate civile obligatoire", () => {
  assert.equal(parseOccurrenceDate("2026-08-24"), "2026-08-24");
  assert.throws(() => parseOccurrenceDate("lundi"), (error) => error.code === PEDAGOGY_ERROR.REPLACEMENT_WEEKDAY_MISMATCH);
});

test("routePermissions Salles / Remplacements fail-closed", () => {
  assert.deepEqual(routePermissions["GET /api/school-rooms"], ["Salles:READ", "ALL_PRIVILEGES"]);
  assert.deepEqual(routePermissions["POST /api/school-rooms"], ["Salles:CREATE", "ALL_PRIVILEGES"]);
  assert.deepEqual(routePermissions["GET /api/course-schedule-replacements"], ["Remplacements:READ", "ALL_PRIVILEGES"]);
  assert.deepEqual(routePermissions["POST /api/course-schedule-replacements"], ["Remplacements:CREATE", "ALL_PRIVILEGES"]);
  const rbac = new RbacService({ rolePermissions: {} });
  const parent = { role: "Parent", permissions: ["Élèves:READ"] };
  assert.equal(rbac.canAccess(parent, "GET /api/school-rooms"), false);
  assert.equal(rbac.canAccess(parent, "GET /api/course-schedule-replacements"), false);
  const secretary = { role: "Secrétaire", permissions: ["Élèves:READ"] };
  assert.equal(rbac.canAccess(secretary, "POST /api/school-rooms"), false);
  assert.equal(rbac.canAccess({ role: "Enseignant", permissions: ["Salles:READ"] }, "POST /api/school-rooms"), false);
  assert.equal(rbac.canAccess({ role: "Enseignant", permissions: ["Remplacements:READ"] }, "POST /api/course-schedule-replacements"), false);
});

test("matrice canonique Préfet CRUD / Enseignant READ", () => {
  assert.equal(CANONICAL_ROOMS_ROLE_GRANTS.PREFET_ETUDES.canCreate, true);
  assert.equal(CANONICAL_ROOMS_ROLE_GRANTS.TEACHER.canCreate, false);
  assert.equal(CANONICAL_REPLACEMENTS_ROLE_GRANTS.TEACHER.canRead, true);
  assert.equal(CANONICAL_REPLACEMENTS_ROLE_GRANTS.TEACHER.canUpdate, false);
});
