import { describe, expect, it } from "vitest";
import {
  dashboardCriticalDomainsForDemo,
  dashboardDeferredDomainsForDemo,
  dashboardDomainsForDemo,
} from "./dashboardDemoHydration";

describe("DEMO-3 — hydratation du tableau de bord", () => {
  it("charge tous les domaines nécessaires au dashboard établissement", () => {
    const domains = dashboardDomainsForDemo(true);

    expect(domains).toEqual(
      expect.arrayContaining([
        "schools",
        "users",
        "students",
        "teachers",
        "classes",
        "payments",
        "presences",
        "notes",
        "exams",
        "bulletins",
        "documents",
        "messages",
        "studentFees",
      ]),
    );
  });

  it("sépare documents/messages du batch KPI établissement", () => {
    const critical = dashboardCriticalDomainsForDemo(true);
    const deferred = dashboardDeferredDomainsForDemo(true);

    expect(critical).toEqual(
      expect.arrayContaining(["notes", "exams", "bulletins", "students", "payments", "presences"]),
    );
    expect(critical).not.toContain("messages");
    expect(critical).not.toContain("documents");
    expect(deferred).toEqual(["documents", "messages"]);
    expect(dashboardDomainsForDemo(true)).toEqual([...critical, ...deferred]);
  });

  it("ne charge que les agrégats plateforme nécessaires hors établissement", () => {
    expect(dashboardDomainsForDemo(false)).toEqual(
      expect.arrayContaining([
        "schools",
        "countries",
        "subscriptions",
        "users",
        "notifications",
        "dashboardChartConfig",
      ]),
    );
    expect(dashboardDeferredDomainsForDemo(false)).toEqual([]);
    expect(dashboardCriticalDomainsForDemo(false)).toEqual(dashboardDomainsForDemo(false));
  });
});
