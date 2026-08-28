import { describe, expect, it } from "vitest";
import { resolveFinanceUiActions } from "./financeActionPermissions";
import type { PermissionContext } from "./permissions";

function ctx(permissions: string[], role = "Secrétaire"): PermissionContext {
  return {
    user: {
      id: "u1",
      role,
      permissions,
    } as never,
    rolePermissions: {},
  };
}

describe("resolveFinanceUiActions — F6 permissions, jamais le rôle", () => {
  it("READ seul : consultation OK, mutations absentes", () => {
    const actions = resolveFinanceUiActions(ctx(["Paiements:READ", "Impayés:READ", "Frais & tarifs:READ"]));
    expect(actions.canConsultPayments).toBe(true);
    expect(actions.canConsultBalances).toBe(true);
    expect(actions.canConsultFees).toBe(true);
    expect(actions.canConsultUnpaid).toBe(true);
    expect(actions.canExport).toBe(true);
    expect(actions.canCreatePayment).toBe(false);
    expect(actions.canCancelPayment).toBe(false);
    expect(actions.canCreateObligation).toBe(false);
    expect(actions.canSendReminder).toBe(false);
    expect(actions.canManageCatalog).toBe(false);
  });

  it("permission paiement CREATE → action visible", () => {
    const actions = resolveFinanceUiActions(ctx(["Paiements:READ", "Paiements:CREATE"]));
    expect(actions.canCreatePayment).toBe(true);
  });

  it("permission retirée → action non proposée, même pour Admin School", () => {
    const actions = resolveFinanceUiActions(ctx(["Paiements:READ"], "Admin School"));
    expect(actions.canCreatePayment).toBe(false);
    expect(actions.canCancelPayment).toBe(false);
  });

  it("Paiements:UPDATE → annulation proposée", () => {
    const actions = resolveFinanceUiActions(ctx(["Paiements:READ", "Paiements:UPDATE"]));
    expect(actions.canCancelPayment).toBe(true);
    expect(actions.canCreatePayment).toBe(false);
  });

  it("n'accorde rien sur le seul libellé Comptable", () => {
    const actions = resolveFinanceUiActions(ctx([], "Comptable"));
    expect(actions.canConsultPayments).toBe(false);
    expect(actions.canCreatePayment).toBe(false);
    expect(actions.canConsultUnpaid).toBe(false);
  });
});
