import { describe, expect, it } from "vitest";
import type { School, UserAccount } from "../types";
import { getUserEstablishmentLabel } from "./userAccounts";

describe("getUserEstablishmentLabel", () => {
  const school = {
    code: "CD-2026-0001",
    publicId: "CD-IN-26-001",
    name: "INSTITUT NURU",
    country: "RDC",
    countryCode: "CD",
  } as School;

  const user = {
    schoolCode: "CD-2026-0001",
    role: "Secrétaire",
  } as UserAccount;

  it("affiche le code public canonique sans exposer le code interne historique", () => {
    const label = getUserEstablishmentLabel(user, [school]);

    expect(label).toBe("INSTITUT NURU (CD-IN-26-001)");
    expect(label).not.toContain("CD-2026-0001");
  });

  it("conserve le code interne comme fallback si aucun code public n'existe", () => {
    const label = getUserEstablishmentLabel(user, [{ ...school, publicId: undefined }]);

    expect(label).toBe("INSTITUT NURU (CD-2026-0001)");
  });
});
