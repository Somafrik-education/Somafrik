import { describe, expect, it } from "vitest";
import { dashboardDomainsForDemo } from "./dashboardDemoHydration";

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
  });
});
