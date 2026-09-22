import { describe, expect, it } from "vitest";
import {
  demoBlockingRouteDomains,
  tracksDomainRouteHydration,
} from "./DomainRouteBootstrap";
import type { DomainKey } from "../lib/domainLoaders";

describe("DEMO runtime P0 hydration", () => {
  it("tracks every Finance leaf so zeroes are never rendered before canonical data is ready", () => {
    expect(tracksDomainRouteHydration("/finances/paiements")).toBe(true);
    expect(tracksDomainRouteHydration("/finances/frais")).toBe(true);
    expect(tracksDomainRouteHydration("/finances/impayes")).toBe(true);
  });

  it("keeps users and relations blocking on establishment overview KPIs", () => {
    const domains: DomainKey[] = ["students", "classes", "teachers", "users", "relations", "notifications"];
    expect(demoBlockingRouteDomains("/etablissement/vue-ensemble", domains)).toEqual([
      "students",
      "classes",
      "teachers",
      "users",
      "relations",
    ]);
  });

  it("preserves progressive non-blocking users/relations outside establishment overview", () => {
    const domains: DomainKey[] = ["students", "users", "relations", "notes"];
    expect(demoBlockingRouteDomains("/notes", domains)).toEqual(["students", "notes"]);
  });
});
