import { describe, expect, it } from "vitest";
import { canReadView } from "./permissions";
import { VIEW_PERMISSION_FEATURES } from "./constants";
import { canReadFinanceModule, firstAllowedFinanceLeaf } from "./financeRouteAccess";
import { getInternalRoleDefaults } from "./internalRoleDefaults";
import { canAccessUnpaidModule } from "./unpaidPermissions";
import type { PermissionContext } from "./permissions";

function ctx(role: string, permissions: string[]): PermissionContext {
  return {
    user: { id: "u1", role, permissions } as never,
    rolePermissions: {},
    permissionsReady: true,
    permissionsBootstrap: "ready",
  };
}

describe("financeRouteAccess — Frais indépendant de Paiements", () => {
  const feesOnly = ctx("Admin School", ["Frais & tarifs:READ", "Frais & tarifs:UPDATE"]);
  const paymentsOnly = ctx("Admin School", ["Paiements:READ"]);
  const unpaidOnly = ctx("Admin School", ["Impayés:READ"]);
  const schoolAdmin = ctx("Admin School", getInternalRoleDefaults("Admin School"));
  const comptable = ctx("Comptable", getInternalRoleDefaults("Comptable"));

  it("aligne payments / fees / unpaid sur les features métier", () => {
    expect(VIEW_PERMISSION_FEATURES.payments).toBe("Paiements");
    expect(VIEW_PERMISSION_FEATURES.fees).toBe("Frais & tarifs");
    expect(VIEW_PERMISSION_FEATURES.unpaid).toBe("Impayés");
  });

  it("Frais & tarifs:READ sans Paiements:READ → module + feuille frais, pas paiements", () => {
    expect(canReadView(feesOnly, "fees")).toBe(true);
    expect(canReadView(feesOnly, "payments")).toBe(false);
    expect(canReadView(feesOnly, "unpaid")).toBe(false);
    expect(canReadFinanceModule(feesOnly)).toBe(true);
    expect(firstAllowedFinanceLeaf(feesOnly)).toBe("frais");
  });

  it("Paiements:READ sans Frais → module + feuille paiements, pas frais", () => {
    expect(canReadView(paymentsOnly, "payments")).toBe(true);
    expect(canReadView(paymentsOnly, "fees")).toBe(false);
    expect(canReadView(paymentsOnly, "unpaid")).toBe(false);
    expect(canReadFinanceModule(paymentsOnly)).toBe(true);
    expect(firstAllowedFinanceLeaf(paymentsOnly)).toBe("paiements");
  });

  it("Impayés:READ seul → module + feuille impayés, aligné canAccessUnpaidModule", () => {
    expect(canReadView(unpaidOnly, "unpaid")).toBe(true);
    expect(canReadView(unpaidOnly, "fees")).toBe(false);
    expect(canReadView(unpaidOnly, "payments")).toBe(false);
    expect(canAccessUnpaidModule(unpaidOnly)).toBe(true);
    expect(canReadFinanceModule(unpaidOnly)).toBe(true);
    expect(firstAllowedFinanceLeaf(unpaidOnly)).toBe("impayes");
  });

  it("Admin School standard et Comptable conservent Paiements et Frais", () => {
    expect(canReadView(schoolAdmin, "payments")).toBe(true);
    expect(canReadView(schoolAdmin, "fees")).toBe(true);
    expect(firstAllowedFinanceLeaf(schoolAdmin)).toBe("paiements");

    expect(canReadView(comptable, "payments")).toBe(true);
    expect(canReadView(comptable, "fees")).toBe(true);
    expect(firstAllowedFinanceLeaf(comptable)).toBe("paiements");
  });

  it("sans permission finance → module fermé", () => {
    const empty = ctx("Admin School", ["Élèves:READ"]);
    expect(canReadFinanceModule(empty)).toBe(false);
    expect(firstAllowedFinanceLeaf(empty)).toBeNull();
  });
});
