import { describe, expect, it } from "vitest";
import { financePaymentsRouteMode } from "./FinancePaymentsEntryPage";
import { parentFinanceShellDecision } from "./FinancesLayout";

describe("P1-08 — routage Finance Parent", () => {
  it("envoie le rôle Parent vers la page dédiée", () => {
    expect(financePaymentsRouteMode("parent_student")).toBe("parent");
    expect(financePaymentsRouteMode("Parent")).toBe("parent");
  });

  it("préserve la page générique pour les rôles staff", () => {
    expect(financePaymentsRouteMode("Admin School")).toBe("staff");
    expect(financePaymentsRouteMode("Comptable")).toBe("staff");
  });

  it("autorise uniquement /finances/paiements au Parent avec Paiements:READ", () => {
    expect(
      parentFinanceShellDecision("parent_student", "/finances/paiements", true),
    ).toBe("content");
    expect(
      parentFinanceShellDecision("parent_student", "/finances", true),
    ).toBe("payments");
    expect(
      parentFinanceShellDecision("parent_student", "/finances/frais", true),
    ).toBe("payments");
    expect(
      parentFinanceShellDecision("parent_student", "/finances/impayes", true),
    ).toBe("payments");
  });

  it("fail-closed vers dashboard si Paiements:READ manque", () => {
    expect(
      parentFinanceShellDecision("parent_student", "/finances/paiements", false),
    ).toBe("dashboard");
    expect(
      parentFinanceShellDecision("Parent", "/finances/frais", false),
    ).toBe("dashboard");
  });

  it("ne change pas les routes Finance staff", () => {
    expect(
      parentFinanceShellDecision("Admin School", "/finances/frais", true),
    ).toBe("staff");
    expect(
      parentFinanceShellDecision("Comptable", "/finances/impayes", true),
    ).toBe("staff");
  });
});
