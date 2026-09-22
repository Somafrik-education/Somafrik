import { describe, expect, it } from "vitest";
import {
  demoBlockingRouteDomains,
  shouldForceDemoDomain,
  tracksDomainRouteHydration,
} from "./DomainRouteBootstrap";

describe("DEMO-DATA — hydratation de route non bloquante", () => {
  it("la vue Scolarité reste suivie par l'hydratation de route", () => {
    expect(tracksDomainRouteHydration("/etablissement/vue-ensemble")).toBe(true);
  });

  it("relations, users et notifications restent non bloquants hors vue d'ensemble", () => {
    expect(
      demoBlockingRouteDomains("/notes", [
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

  it("le planning est suivi et force une lecture fraîche des créneaux", () => {
    expect(tracksDomainRouteHydration("/planning/emploi-du-temps/calendrier")).toBe(true);
    expect(
      shouldForceDemoDomain("/planning/emploi-du-temps/calendrier", "courseSchedules"),
    ).toBe(true);
    expect(shouldForceDemoDomain("/planning/emploi-du-temps/calendrier", "classes")).toBe(false);
    expect(shouldForceDemoDomain("/notes", "courseSchedules")).toBe(false);
  });
});
