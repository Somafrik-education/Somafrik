import { describe, expect, it } from "vitest";
import {
  applyMandatoryOverlay,
  describeActionLock,
  mandatoryFlagsForModule,
  toggleCrudFlag,
} from "./rbacLocks";

describe("rbacLocks — contrat catalogue", () => {
  const mandatoryByRole = {
    SUPER_ADMIN: {
      users: { create: true, read: true, update: true, delete: true },
    },
  };

  it("SUPER_ADMIN users READ est un invariant de rôle", () => {
    const mandatory = mandatoryFlagsForModule(mandatoryByRole, "SUPER_ADMIN", "users");
    const lock = describeActionLock({
      action: "read",
      flags: { canCreate: true, canRead: true, canUpdate: true, canDelete: true },
      mandatory,
    });
    expect(lock).toEqual({ locked: true, reason: "role_invariant" });
    const toggled = toggleCrudFlag(
      { canCreate: true, canRead: true, canUpdate: true, canDelete: true },
      "canRead",
      mandatory,
    );
    expect(toggled.canRead).toBe(true);
  });

  it("CREATE active verrouille READ (dépendance) puis le libère au retrait", () => {
    const mandatory = mandatoryFlagsForModule(mandatoryByRole, "PREFET_ETUDES", "attendance");
    const withCreate = toggleCrudFlag(
      { canCreate: false, canRead: false, canUpdate: false, canDelete: false },
      "canCreate",
      mandatory,
    );
    expect(withCreate).toEqual({ canCreate: true, canRead: true, canUpdate: false, canDelete: false });
    expect(
      describeActionLock({ action: "read", flags: withCreate, mandatory }),
    ).toEqual({ locked: true, reason: "dependency" });

    const withoutCreate = toggleCrudFlag(withCreate, "canCreate", mandatory);
    expect(withoutCreate.canCreate).toBe(false);
    expect(withoutCreate.canRead).toBe(true);
    expect(
      describeActionLock({ action: "read", flags: withoutCreate, mandatory }).locked,
    ).toBe(false);
  });

  it("overlay force les flags obligatoires à true", () => {
    expect(
      applyMandatoryOverlay(
        { canCreate: false, canRead: false, canUpdate: false, canDelete: false },
        { create: true, read: true, update: true, delete: false },
      ),
    ).toEqual({ canCreate: true, canRead: true, canUpdate: true, canDelete: false });
  });
});
