import { describe, expect, it } from "vitest";
import type { UserAccount } from "../types";
import { canManageUserAccount, getUserEstablishmentLabel } from "./userAccounts";

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

describe("canManageUserAccount — identité établissement canonique", () => {
  it("autorise le même schoolId malgré leftover JWT SCH-* et login_code CD-*", () => {
    const actor = {
      role: "Admin School",
      schoolId: "11111111-1111-4111-8111-111111111111",
      schoolCode: "SCH-986520F354F0461B9122",
      schoolPublicCode: "CD-ITS-26-001",
    } as UserAccount;
    const target = {
      role: "Enseignant",
      schoolId: actor.schoolId,
      schoolCode: "CD-ITS-26-001",
      schoolPublicCode: "CD-ITS-26-001",
    } as UserAccount;

    expect(actor.schoolCode).not.toBe(target.schoolCode);
    expect(canManageUserAccount(actor, target, "UPDATE")).toBe(true);
  });

  it("refuse deux établissements différents même si leur code public est identique", () => {
    const actor = {
      role: "Admin School",
      schoolId: "11111111-1111-4111-8111-111111111111",
      schoolPublicCode: "CD-ITS-26-001",
    } as UserAccount;
    const target = {
      role: "Enseignant",
      schoolId: "22222222-2222-4222-8222-222222222222",
      schoolPublicCode: "CD-ITS-26-001",
    } as UserAccount;

    expect(canManageUserAccount(actor, target, "UPDATE")).toBe(false);
  });

  it("reste fail-closed lorsque le schoolId membership manque", () => {
    const actor = {
      role: "Admin School",
      schoolCode: "SCH-986520F354F0461B9122",
    } as UserAccount;
    const target = {
      role: "Enseignant",
      schoolCode: "SCH-986520F354F0461B9122",
    } as UserAccount;

    expect(canManageUserAccount(actor, target, "UPDATE")).toBe(false);
  });
});
