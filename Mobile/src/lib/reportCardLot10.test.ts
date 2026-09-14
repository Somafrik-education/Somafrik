/**
 * LOT 10 — Mobile consomme le snapshot qualifié, sans pack pays.
 *
 *   npx --yes tsx --test Mobile/src/lib/reportCardLot10.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { formatStudentSnapshot } from "./reportCardSnapshotDisplay";

const ROOT = path.resolve(__dirname, "../../..");

const LOT10_FILES = [
  "Mobile/src/components/bulletin/ReportCardSnapshotView.tsx",
  "Mobile/src/screens/ReportCardsScreen.tsx",
];

const BRANCH_IDENT =
  "(?:country|countryCode|country_code|iso_code|isoCode|school|schoolCode|school_code|schoolName|school_name)";

const FORBIDDEN_BRANCH = [
  new RegExp(String.raw`if\s*\(\s*${BRANCH_IDENT}\b`),
  new RegExp(String.raw`switch\s*\(\s*${BRANCH_IDENT}\b`),
  new RegExp(String.raw`\b${BRANCH_IDENT}\s*===?\s*['"]`),
  new RegExp(String.raw`['"][^'"]+['"]\s*===?\s*${BRANCH_IDENT}\b`),
];

function readRel(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.includes(".test.")) acc.push(full);
  }
  return acc;
}

test("report-card-lot10-pdf-web-mobile-same-snapshot", () => {
  for (const rel of LOT10_FILES) {
    assert.equal(existsSync(path.join(ROOT, rel)), true, `missing ${rel}`);
    const src = readRel(rel);
    assert.equal(src.includes("computeReportCard"), false, rel);
  }
  const view = readRel("Mobile/src/components/bulletin/ReportCardSnapshotView.tsx");
  assert.match(view, /payload/);
  assert.equal(existsSync(path.join(ROOT, "backend/lib/reportCard/reportCardQualification.js")), true);
});

test("report-card-lot10-mobile-renders-qualified-a-and-b-snapshots", () => {
  const catalogDir = path.join(ROOT, "backend/lib/reportCard/qualification");
  const cases = [
    { model: "model-a.json", must: ["FRANCAIS", "COMPONENT_PERIOD", "Domaines"], mustNot: [" TJ "] },
    { model: "model-b.json", must: ["TPA", "TJ", "EX", "N/A", "RELIGION_MORALE"], mustNot: ["COMPONENT_PERIOD"] },
  ];
  for (const row of cases) {
    const fixture = JSON.parse(readFileSync(path.join(catalogDir, row.model), "utf8"));
    const expectedPath = path.join(catalogDir, "expected", row.model);
    assert.equal(existsSync(expectedPath), true, `RED: snapshot golden missing ${row.model}`);
    const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
    assert.ok(Array.isArray(expected.snapshot?.students) && expected.snapshot.students.length > 0, "RED: golden.snapshot required");
    const text = expected.snapshot.students
      .map((student: { student_id?: string }) => formatStudentSnapshot(student, fixture.template))
      .join("\n");
    assert.equal(text.includes("computeReportCard"), false);
    for (const needle of row.must) {
      assert.match(text, new RegExp(needle));
    }
    for (const needle of row.mustNot) {
      assert.equal(text.includes(needle.trim()), false, `${row.model} leaked ${needle}`);
    }
  }
});

test("report-card-lot10-no-country-school-branch", () => {
  for (const rel of LOT10_FILES) {
    const src = readRel(rel);
    for (const re of FORBIDDEN_BRANCH) {
      assert.equal(re.test(src), false, `${rel} matched ${re}`);
    }
  }
});

test("report-card-lot10-no-lot11-plus", () => {
  assert.equal(existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardCountryPack.tsx")), false);
  const hits = walk(path.join(ROOT, "Mobile/src")).filter((file) => {
    if (!/reportCard|ReportCard|bulletin/i.test(file)) return false;
    const src = readFileSync(file, "utf8");
    return /countryPack|CountryPack|country_pack_bi/.test(src);
  });
  assert.deepEqual(hits, []);
});
