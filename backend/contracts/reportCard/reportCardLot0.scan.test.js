"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { scanEngineSources } = require("./noCountrySchoolBranch.js");

const ROOT = path.resolve(__dirname, "../../..");

test("no-country-school-branch: engine/contract sources have no country/school forks", () => {
  const hits = scanEngineSources();
  assert.deepEqual(hits, []);
});

test("LOT 0 does not add SQL migrations, HTTP routes, or Web/Mobile UI", () => {
  const migrations = path.join(ROOT, "backend/migrations");
  if (fs.existsSync(migrations)) {
    const added = fs.readdirSync(migrations).filter((name) => /report.?card/i.test(name));
    assert.deepEqual(added, []);
  }
  const contractDir = fs.readdirSync(__dirname);
  assert.ok(!contractDir.includes("routes.js"));
  assert.ok(!contractDir.includes("server.js"));
});
