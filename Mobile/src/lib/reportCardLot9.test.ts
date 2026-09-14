/**
 * LOT 9 — Mobile historique read-only.
 *
 *   npx --yes tsx --test Mobile/src/lib/reportCardLot9.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

const LOT9_FILES = [
  "Mobile/src/lib/reportCardPublicationApi.ts",
  "Mobile/src/lib/reportCardHistoryApi.ts",
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

test("report-card-lot9-mobile-history-read-only", () => {
  for (const rel of LOT9_FILES) {
    assert.equal(existsSync(path.join(ROOT, rel)), true, `missing ${rel} (RED)`);
  }
  const api = readRel("Mobile/src/lib/reportCardHistoryApi.ts");
  assert.match(api, /\/history/);
  assert.doesNotMatch(api, /method:\s*["']POST["']/);
  assert.doesNotMatch(api, /corrections/);
  assert.doesNotMatch(api, /revoke/);
  const screen = readRel("Mobile/src/screens/ReportCardsScreen.tsx");
  assert.match(screen, /SUPERSEDED|REVOKED|history/i);
  assert.doesNotMatch(screen, /Corriger/);
  assert.doesNotMatch(screen, /Révoquer/);
});

test("report-card-lot9-no-client-recalculation", () => {
  for (const rel of LOT9_FILES) {
    assert.equal(existsSync(path.join(ROOT, rel)), true, `missing ${rel} (RED)`);
    const src = readRel(rel);
    assert.equal(src.includes("computeReportCard"), false, rel);
    assert.equal(/\braw_score\b/.test(src), false, rel);
  }
});

test("report-card-lot9-no-country-school-branch", () => {
  for (const rel of LOT9_FILES) {
    if (!existsSync(path.join(ROOT, rel))) continue;
    const src = readRel(rel);
    for (const re of FORBIDDEN_BRANCH) {
      assert.equal(re.test(src), false, `${rel} matched ${re}`);
    }
  }
});

test("report-card-lot9-no-lot10-plus", () => {
  assert.equal(existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardCountryPack.tsx")), false);
  assert.equal(existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardCorrection.tsx")), false);
  const bulletinFiles = walk(path.join(ROOT, "Mobile/src")).filter((file) =>
    /reportCard|ReportCard|bulletin/i.test(file),
  );
  const hits = bulletinFiles.filter((file) => {
    const src = readFileSync(file, "utf8");
    return /countryPack|REPORT_CARD_CONFIGURE|REPORT_CARD_CORRECT/.test(src);
  });
  assert.deepEqual(hits, []);
});
