import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

function readRel(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("S1 / #659 CTA non-régression", () => {
  it("e2e-report-card-school-request-cta-guard", () => {
    const entity = readRel("web/src/pages/EntityPage.tsx");
    expect(entity).toMatch(/Demander un modèle de bulletin/);
    expect(entity).toMatch(/report-card-request-model-cta/);
    expect(entity).toMatch(/\/bulletins\/modele/);
    const school = readRel("web/src/pages/ReportCardSchoolWorkflowPage.tsx");
    expect(school).toMatch(/Soumettre la demande de modèle/);
    expect(school).toMatch(/report-card-submit-request/);
    expect(school).toMatch(/report-card-model-key/);
    expect(existsSync(path.join(ROOT, "backend/scripts/verify-report-card-s1-e2e.js"))).toBe(true);
    const e2e = readRel("backend/scripts/verify-report-card-s1-e2e.js");
    expect(e2e).toMatch(/e2e-report-card-school-request-visible-and-persisted/);
    expect(e2e).toMatch(/e2e-report-card-source-upload-preview-persisted/);
    expect(e2e).toMatch(/e2e-report-card-superadmin-explicit-mapping/);
    expect(e2e).toMatch(/e2e-report-card-ready-review-school-approval-active/);
    expect(e2e).toMatch(/e2e-report-card-request-rbac-fail-closed/);
    expect(e2e).toMatch(/e2e-report-card-cross-tenant-forbidden/);
    expect(e2e).not.toMatch(/page\.waitForTimeout\(\s*\d+/);

    const app = readRel("web/src/App.tsx");
    expect(app).toMatch(
      /path="\/bulletins\/modele"[\s\S]{0,220}?PermissionRoute view="bulletins" action="CREATE" fallbackPath="\/bulletins"/,
    );
    expect(app).toMatch(
      /path="\/bulletins\/historique"[\s\S]{0,180}?PermissionRoute view="bulletins">/,
    );
    expect(app).toMatch(
      /path="\/bulletins"(?!\/)[\s\S]{0,180}?PermissionRoute view="bulletins">/,
    );
    expect(app).not.toMatch(/path="\/bulletins\/historique"[\s\S]{0,180}?action="CREATE"/);
    expect(app).not.toMatch(/path="\/bulletins"(?!\/)[\s\S]{0,180}?action="CREATE"/);

    const rbacStart = e2e.indexOf("e2e-report-card-request-rbac-fail-closed");
    const rbacEnd = e2e.indexOf("e2e-report-card-cross-tenant-forbidden");
    expect(rbacStart).toBeGreaterThan(-1);
    expect(rbacEnd).toBeGreaterThan(rbacStart);
    const rbac = e2e.slice(rbacStart, rbacEnd);
    expect(rbac).toMatch(/page\.goto\(`\$\{WEB_URL\}\/bulletins\/modele`/);
    expect(rbac).toMatch(/waitForURL\(\/\\\/bulletins\\\/\?\$/);
    expect(rbac).not.toMatch(/getByRole\("heading", \{ name: \/modèle de bulletin\/i \}\)\.waitFor/);
    expect(rbac).toMatch(/created\.status, 403/);
  });
});
