import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

const WEB_FILES = [
  "web/src/components/bulletin/ReportCardSnapshotView.tsx",
  "web/src/pages/VerifyReportCardPage.tsx",
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

describe("LOT 10 web guards", () => {
  it("report-card-lot10-pdf-web-mobile-same-snapshot", () => {
    for (const rel of WEB_FILES) {
      expect(existsSync(path.join(ROOT, rel)), `missing ${rel}`).toBe(true);
      const src = readRel(rel);
      expect(src.includes("computeReportCard")).toBe(false);
      expect(src).toMatch(/payload/);
    }
    const view = readRel("web/src/components/bulletin/ReportCardSnapshotView.tsx");
    expect(view).toMatch(/payload\.students/);
    expect(existsSync(path.join(ROOT, "backend/lib/reportCard/reportCardQualification.js"))).toBe(true);
  });

  it("report-card-lot10-no-country-school-branch", () => {
    for (const rel of WEB_FILES) {
      const src = readRel(rel);
      for (const re of FORBIDDEN) {
        expect(re.test(src), `${rel} matched ${re}`).toBe(false);
      }
    }
  });

  it("report-card-lot10-no-lot11-plus", () => {
    expect(existsSync(path.join(ROOT, "web/src/pages/ReportCardCountryPackPage.tsx"))).toBe(false);
    const hits = walk(path.join(ROOT, "web/src")).filter((file) => {
      if (!/reportCard|ReportCard|bulletin/i.test(file)) return false;
      const src = readFileSync(file, "utf8");
      return /countryPack|CountryPack|country_pack_bi/.test(src);
    });
    expect(hits).toEqual([]);
  });
});
