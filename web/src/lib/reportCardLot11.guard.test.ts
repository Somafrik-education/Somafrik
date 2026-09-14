import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

const WEB_FILES = [
  "web/src/pages/ReportCardSchoolWorkflowPage.tsx",
  "web/src/pages/ReportCardSuperadminWorkflowPage.tsx",
  "web/src/lib/reportCardConfigurationApi.ts",
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

describe("LOT 11 web guards", () => {
  it("report-card-lot11-web-upload-error-success-persisted", () => {
    const school = readRel("web/src/pages/ReportCardSchoolWorkflowPage.tsx");
    expect(school).toMatch(/Envoyer un modèle de bulletin/);
    expect(school).toMatch(/source-artifact|sourceArtifact|attachSourceArtifact/);
    expect(school).toMatch(/role="alert"/);
    expect(school.includes("computeReportCard")).toBe(false);
    const api = readRel("web/src/lib/reportCardConfigurationApi.ts");
    expect(api).toMatch(/source-artifact|attachSourceArtifact|uploadSourceArtifact/);
  });

  it("report-card-lot11-superadmin-preview-surface", () => {
    const admin = readRel("web/src/pages/ReportCardSuperadminWorkflowPage.tsx");
    expect(admin).toMatch(/Artefact source/);
    expect(admin).toMatch(/source-artifact|sourceArtifact/);
    expect(admin).toMatch(/AcademicRuleProfile|profile_id|Lier le bundle/);
    expect(admin).not.toMatch(/ocr|tesseract|autoExtract/i);
    expect(admin.includes("computeReportCard")).toBe(false);
  });

  it("report-card-lot11-no-country-school-branch", () => {
    for (const rel of WEB_FILES) {
      const src = readRel(rel);
      for (const re of FORBIDDEN) {
        expect(re.test(src), `${rel} matched ${re}`).toBe(false);
      }
    }
  });

  it("report-card-lot11-no-mobile-lot12-plus", () => {
    expect(existsSync(path.join(ROOT, "docs/project/REPORT-CARD-LOT12.md"))).toBe(false);
    expect(existsSync(path.join(ROOT, "Mobile/src/screens/ReportCardSourceArtifactUpload.tsx"))).toBe(false);
    const hits = walk(path.join(ROOT, "Mobile/src")).filter((file) => {
      if (!/reportCard|ReportCard|bulletin/i.test(file)) return false;
      const src = readFileSync(file, "utf8");
      return /source-artifact|Envoyer un modèle de bulletin|sourceArtifact/.test(src);
    });
    expect(hits).toEqual([]);
  });
});
