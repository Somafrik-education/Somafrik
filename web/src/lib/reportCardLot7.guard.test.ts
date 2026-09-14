import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

const LOT7_FILES = [
  "backend/lib/reportCard/reportCardHttp.js",
  "web/src/pages/ReportCardSchoolWorkflowPage.tsx",
  "web/src/pages/ReportCardSuperadminWorkflowPage.tsx",
  "web/src/pages/VerifyReportCardPage.tsx",
  "web/src/components/bulletin/ReportCardSnapshotView.tsx",
  "web/src/lib/reportCardConfigurationApi.ts",
  "web/src/lib/reportCardVerifyApi.ts",
  "web/src/lib/reportCardVerifyRoute.ts",
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

describe("LOT 7 guards", () => {
  it("report-card-lot7-web-no-country-school-branch", () => {
    for (const rel of LOT7_FILES) {
      const abs = path.join(ROOT, rel);
      expect(existsSync(abs), `missing ${rel}`).toBe(true);
      const src = readFileSync(abs, "utf8");
      for (const re of FORBIDDEN) {
        expect(re.test(src), `${rel} matched ${re}`).toBe(false);
      }
    }
  });

  it("report-card-lot7-no-mobile-lot8-plus", () => {
    expect(existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardVerify.tsx"))).toBe(false);
    expect(existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardSchoolWorkflow.tsx"))).toBe(false);
    expect(existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardSuperadmin.tsx"))).toBe(false);
    const mobileHits = walk(path.join(ROOT, "Mobile/src")).filter((file) => {
      const src = readFileSync(file, "utf8");
      return /reportCardHttp|\/verify\/rc\/|REPORT_CARD_CONFIGURE/.test(src);
    });
    expect(mobileHits).toEqual([]);
    const http = readFileSync(path.join(ROOT, "backend/lib/reportCard/reportCardHttp.js"), "utf8");
    expect(http.includes("Mobile/src")).toBe(false);
  });
});
