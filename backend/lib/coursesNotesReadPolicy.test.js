"use strict";

const assert = require("node:assert/strict");
const {
  COURSE_READ_PERMISSIONS,
  COURSE_CREATE_PERMISSIONS,
  COURSE_UPDATE_PERMISSIONS,
  COURSE_DELETE_PERMISSIONS,
} = require("./coursesRbacPolicy");

assert.equal(
  COURSE_READ_PERMISSIONS.includes("Notes:READ"),
  true,
  "un lecteur Notes doit pouvoir lire le catalogue cours nécessaire au calcul canonique",
);

for (const [verb, permissions] of [
  ["CREATE", COURSE_CREATE_PERMISSIONS],
  ["UPDATE", COURSE_UPDATE_PERMISSIONS],
  ["DELETE", COURSE_DELETE_PERMISSIONS],
]) {
  assert.equal(
    permissions.includes("Notes:READ"),
    false,
    `Notes:READ ne doit jamais ouvrir ${verb} sur les cours`,
  );
}

console.log("OK: courses Notes read policy");
