import { describe, expect, it } from "vitest";
import { demoBlockingRouteDomains, tracksDomainRouteHydration } from "./DomainRouteBootstrap";

describe("DEMO-DATA — hydratation de route non bloquante", () => {
  it("la vue Scolarité reste suivie par l'hydratation de route", () => {
    expect(tracksDomainRouteHydration("/etablissement/vue-ensemble")).toBe(true);
  });

  it("relations, users et notifications ne bloquent pas la vue Scolarité", () => {
    expect(
      demoBlockingRouteDomains([
        "classes",
        "students",
        "teachers",
        "assignments",
        "relations",
        "users",
        "notifications",
      ]),
    ).toEqual(["classes", "students", "teachers", "assignments"]);
  });
});
