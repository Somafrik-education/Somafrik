import { describe, expect, it } from "vitest";
import type { UserAccount } from "../types";
import { getUserEstablishmentLabel } from "./userAccounts";

describe("getUserEstablishmentLabel", () => {
  const prefet = {
    schoolCode: "CD-2026-0001",
    schoolPublicCode: "CD-IN-26-001",
    schoolName: "INSTITUT NURU",
    role: "Préfet des études",
  } as UserAccount;

  it("affiche le code public depuis l'utilisateur sans domaine schools", () => {
    const label = getUserEstablishmentLabel(prefet);

    expect(label).toBe("INSTITUT NURU (CD-IN-26-001)");
    expect(label).not.toContain("CD-2026-0001");
  });

  it("n'utilise jamais schoolCode comme fallback visuel", () => {
    const label = getUserEstablishmentLabel(
      { schoolCode: "CD-2026-0001", role: "Préfet des études" } as UserAccount,
    );

    expect(label).toBe("—");
    expect(label).not.toContain("CD-2026-0001");
  });

  it("conserve les libellés globaux Super Admin / Admin Pays", () => {
    expect(
      getUserEstablishmentLabel({ schoolCode: "*", role: "Super Administrateur Somafrik" } as UserAccount),
    ).toBe("Tous les établissements (système Somafrik)");
    expect(
      getUserEstablishmentLabel({
        schoolCode: "*",
        role: "Admin Pays",
        countryScope: "RDC",
      } as UserAccount),
    ).toBe("Tous les établissements — RDC");
  });
});
