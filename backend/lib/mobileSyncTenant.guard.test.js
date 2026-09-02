"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

function read(relative) {
  return fs.readFileSync(path.join(__dirname, relative), "utf8");
}

test("GP-020: les 5 handlers L1 refusent login_code vide", () => {
  for (const file of [
    "mobileSyncClasses.js",
    "mobileSyncStudents.js",
    "mobileSyncAssignments.js",
    "mobileSyncSchoolCourses.js",
    "mobileSyncCourseSchedules.js",
  ]) {
    const src = read(file);
    assert.match(src, /assertMobileSyncCanonicalLoginCode/, `${file} sans garde SY-08`);
    assert.doesNotMatch(src, /COALESCE\(login_code,\s*school_code\)/i);
  }
});

test("GP-020: helper SY-08 n'a pas de fallback leftover", () => {
  const src = read("mobileSyncSchoolScope.js");
  assert.match(src, /login_code vide/);
  assert.doesNotMatch(src, /COALESCE/i);
  assert.doesNotMatch(src, /school_code \|\|/);
});
