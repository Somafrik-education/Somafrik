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
    expect(entity).toMatch(/Configurer un bulletin/);
    expect(entity).toMatch(/report-card-request-model-cta/);
    expect(entity).toMatch(/\/bulletins\/modele/);
    // BULLETIN-CATALOG-01 : le CTA mène à la galerie des modèles autorisés et à l'assistant.
    const school = readRel("web/src/pages/ReportCardCatalogSchoolPage.tsx");
    // Libellé contextualisé, tout en garantissant la présence du CTA de configuration.\n    expect(school).toMatch(/Configurer ce modèle pour une classe/);\n    expect(school).toMatch(/Créer la configuration de cette classe/);\n    expect(school).toMatch(/catalog-school-choose-/);
    expect(school).toMatch(/catalog-save/);
    expect(school).toMatch(/catalog-activate-confirm/);
    expect(existsSync(path.join(ROOT, "backend/scripts/verify-report-card-s1-e2e.js"))).toBe(true);
    const e2e = readRel("backend/scripts/verify-report-card-s1-e2e.js");
    expect(e2e).toMatch(/e2e-report-card-catalog-superadmin-country-availability/);
    expect(e2e).toMatch(/e2e-report-card-catalog-school-configure-save-activate/);
    expect(e2e).toMatch(/e2e-report-card-catalog-rbac-fail-closed/);
    expect(e2e).toMatch(/e2e-report-card-catalog-other-country-and-cross-tenant/);
    // La migration du catalogue est appliquée par le test, jamais au démarrage du serveur.
    expect(e2e).toMatch(/REPORT_CARD_CATALOG_SQL/);
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

    const rbacStart = e2e.indexOf("e2e-report-card-catalog-rbac-fail-closed");
    const rbacEnd = e2e.indexOf("e2e-report-card-catalog-other-country-and-cross-tenant");
    expect(rbacStart).toBeGreaterThan(-1);
    expect(rbacEnd).toBeGreaterThan(rbacStart);
    const rbac = e2e.slice(rbacStart, rbacEnd);
    expect(rbac).toMatch(/page\.goto\(`\$\{WEB_URL\}\/bulletins\/modele`/);
    expect(rbac).toMatch(/waitForURL\(\/\\\/bulletins\\\/\?\$/);
    expect(rbac).not.toMatch(/getByRole\("heading", \{ name: \/modèle de bulletin\/i \}\)\.waitFor/);
    expect(rbac).toMatch(/saved\.status, 403/);
    expect(rbac).toMatch(/activated\.status, 403/);
  });
});
