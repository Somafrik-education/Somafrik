import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DASHBOARD_KPI_INTERVAL_MS, DASHBOARD_METRIC_DOMAINS, dashboardDataIsStale, mutationRefreshesDashboard } from "./dashboardSync";
import { domainsForPath } from "./routeDomainMap";
import type { PermissionContext } from "./permissions";

describe("synchronisation tableau de bord", () => {
  it("rafraîchit les cinq écritures métier et ignore la lecture", () => {
    expect(mutationRefreshesDashboard("POST", "/classes")).toBe(true);
    expect(mutationRefreshesDashboard("POST", "/classes/CLS-1/students")).toBe(true);
    expect(mutationRefreshesDashboard("POST", "/presences")).toBe(true);
    expect(mutationRefreshesDashboard("PATCH", "/course-schedules/slot-1")).toBe(true);
    expect(mutationRefreshesDashboard("POST", "/payments")).toBe(true);
    expect(mutationRefreshesDashboard("GET", "/payments")).toBe(false);
    expect(mutationRefreshesDashboard("POST", "/finance/payment-methods")).toBe(false);
  });

  it("les indicateurs historiques ne sont plus rechargés par le tableau de bord", () => {
    expect(DASHBOARD_METRIC_DOMAINS).toEqual([
      "students",
      "teachers",
      "classes",
      "presences",
      "payments",
      "studentFees",
    ]);
    const overview = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../pages/OverviewPage.tsx"), "utf8");
    expect(overview).not.toContain("DASHBOARD_METRIC_DOMAINS");
    expect(overview).toContain("useSchoolDashboardKpis");
    expect(DASHBOARD_KPI_INTERVAL_MS).toBe(60_000);
    const ctx: PermissionContext = {
      user: {
        role: "Admin School",
        schoolCode: "CD-IN-26-001",
        permissions: ["Paiements:READ", "Élèves:READ", "Présences:READ", "Classes:READ", "Enseignants:READ"],
      },
      rolePermissions: {},
    };
    const domains = domainsForPath("/tableau-de-bord", ctx);
    for (const domain of DASHBOARD_METRIC_DOMAINS) {
      expect(domains).not.toContain(domain);
    }
  });

  it("le retour au premier plan n'actualise que des données périmées", () => {
    expect(dashboardDataIsStale(null, 1_000, 60_000)).toBe(true);
    expect(dashboardDataIsStale(1_000, 30_000, 60_000)).toBe(false);
    expect(dashboardDataIsStale(1_000, 61_000, 60_000)).toBe(true);
  });
});
