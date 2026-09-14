import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

const LOT9_WEB_FILES = [
  "web/src/lib/reportCardHistoryApi.ts",
  "web/src/pages/ReportCardHistoryPage.tsx",
];

const BRANCH_IDENT =
  "(?:country|countryCode|country_code|iso_code|isoCode|school|schoolCode|school_code|schoolName|school_name)";

const FORBIDDEN = [
  new RegExp(String.raw`if\s*\(\s*${BRANCH_IDENT}\b`),
  new RegExp(String.raw`switch\s*\(\s*${BRANCH_IDENT}\b`),
  new RegExp(String.raw`\b${BRANCH_IDENT}\s*===?\s*['"]`),
  new RegExp(String.raw`['"][^'"]+['"]\s*===?\s*${BRANCH_IDENT}\b`),
];

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.includes(".test.")) acc.push(full);
  }
  return acc;
}

function readRel(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("LOT 9 web guards", () => {
  it("report-card-lot9-web-history-and-correction-states", () => {
    for (const rel of LOT9_WEB_FILES) {
      expect(existsSync(path.join(ROOT, rel)), `missing ${rel} (RED)`).toBe(true);
    }
    const api = readRel("web/src/lib/reportCardHistoryApi.ts");
    expect(api).toMatch(/\/history/);
    expect(api).toMatch(/corrections/);
    expect(api).toMatch(/revoke/);
    const page = readRel("web/src/pages/ReportCardHistoryPage.tsx");
    expect(page).toMatch(/ACTIVE/);
    expect(page).toMatch(/SUPERSEDED/);
    expect(page).toMatch(/REVOKED/);
    expect(page).toMatch(/Corriger/);
    expect(page).toMatch(/Révoquer/);
    expect(page).toMatch(/motif|reason/i);
  });

  it("report-card-lot9-no-client-recalculation", () => {
    for (const rel of LOT9_WEB_FILES) {
      expect(existsSync(path.join(ROOT, rel)), `missing ${rel} (RED)`).toBe(true);
      const src = readRel(rel);
      expect(src.includes("computeReportCard")).toBe(false);
      expect(/\braw_score\b/.test(src)).toBe(false);
    }
  });

  it("report-card-lot9-no-country-school-branch", () => {
    for (const rel of LOT9_WEB_FILES) {
      if (!existsSync(path.join(ROOT, rel))) continue;
      const src = readRel(rel);
      for (const re of FORBIDDEN) {
        expect(re.test(src), `${rel} matched ${re}`).toBe(false);
      }
    }
  });

  it("report-card-lot9-no-lot10-plus", () => {
    expect(existsSync(path.join(ROOT, "web/src/pages/ReportCardCountryPackPage.tsx"))).toBe(false);
    const hits = walk(path.join(ROOT, "web/src")).filter((file) => {
      if (!/reportCard|ReportCard|bulletin/i.test(file)) return false;
      const src = readFileSync(file, "utf8");
      return /countryPack|CountryPack|qualificationPays/.test(src);
    });
    expect(hits).toEqual([]);
  });
});
