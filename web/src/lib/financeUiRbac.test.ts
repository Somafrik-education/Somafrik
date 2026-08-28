import { describe, expect, it } from "vitest";
import { canAccessUnpaidModule, canSendUnpaidReminder } from "./unpaidPermissions";
import { canCreateFees, canReadFees, canUpdateFees } from "./feePermissions";
import type { PermissionContext } from "./permissions";

function ctx(permissions: string[], role = "Comptable"): PermissionContext {
  return {
    user: { id: "u1", role, permissions } as never,
    rolePermissions: {},
  };
}

describe("permissions Finance UI — pas de rôle hardcodé", () => {
  it("Impayés READ seul → consultation, pas de relance", () => {
    const read = ctx(["Impayés:READ"]);
    expect(canAccessUnpaidModule(read)).toBe(true);
    expect(canSendUnpaidReminder(read)).toBe(false);
  });

  it("Impayés CREATE → relance visible", () => {
    expect(canSendUnpaidReminder(ctx(["Impayés:CREATE"]))).toBe(true);
  });

  it("rôle Comptable sans permission → refusé", () => {
    expect(canAccessUnpaidModule(ctx([], "Comptable"))).toBe(false);
    expect(canReadFees(ctx([], "Admin School"))).toBe(false);
    expect(canCreateFees(ctx([], "Admin School"))).toBe(false);
    expect(canUpdateFees(ctx([], "Admin School"))).toBe(false);
  });
});
