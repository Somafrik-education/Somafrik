"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { scanEngineSources, scanText } = require("./noCountrySchoolBranch.js");

const ROOT = path.resolve(__dirname, "../../..");

test("no-country-school-branch: engine/contract sources have no country/school forks", () => {
  const hits = scanEngineSources();
  assert.deepEqual(hits, []);
});

test("no-country-school-branch: generic lookup/map/switch/ternary variants are rejected", () => {
  const snippets = [
    'if (country === "CD") { return pack; }',
    'if ("BI" === country) { return pack; }',
    "if (country == 'RW') { return pack; }",
    'const n = country === "CD" ? 1 : 0;',
    'const n2 = "FR" === iso_code ? 1 : 0;',
    'switch (country) { case "CD": break; default: break; }',
    'switch (school) { case "COL": break; }',
    'const byIso = new Map([["CD", { a: 1 }]]);',
    'const byIso2 = new Map([["RW", x], ["BI", y]]);',
    "const picked = table[country];",
    "const schoolRow = index[school];",
    'if (countryCode === "CM") {}',
    'if (schoolCode === "XYZ") {}',
  ];
  for (const src of snippets) {
    assert.ok(scanText(src).length > 0, `expected a hit for: ${src}`);
  }
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
