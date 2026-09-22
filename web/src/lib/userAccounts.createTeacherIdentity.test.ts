import { describe, expect, it } from "vitest";
import { isTeacherRoleLabel, toCreateTeacherIdentityPayload } from "./userAccounts";
import type { UserAccount } from "../types";

function draft(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    firstName: "Awa",
    lastName: "Ndiaye",
    role: "Enseignant",
    email: "awa@test.local",
    phone: "+243811000001",
    gender: "Féminin",
    birthDate: "1990-05-01",
    temporaryPassword: "TempPass12",
    schoolCode: "CD-2026-0001",
    status: "Actif",
    ...overrides,
  } as UserAccount;
}

describe("toCreateTeacherIdentityPayload", () => {
  it("distingue Enseignant du createUser+grant générique", () => {
    expect(isTeacherRoleLabel("Enseignant")).toBe(true);
    expect(isTeacherRoleLabel("Préfet des études")).toBe(false);
  });

  it("envoie l'identité civile + secret, sans rôle client forgé", () => {
    expect(toCreateTeacherIdentityPayload(draft())).toEqual({
      firstName: "Awa",
      lastName: "Ndiaye",
      email: "awa@test.local",
      phone: "+243811000001",
      gender: "Féminin",
      birthDate: "1990-05-01",
      temporaryPassword: "TempPass12",
      schoolCode: "CD-2026-0001",
    });
  });

  it("omet gender non renseigné et birthDate vide", () => {
    const payload = toCreateTeacherIdentityPayload(
      draft({ gender: "Non renseigné", birthDate: "" }),
    );
    expect(payload).not.toHaveProperty("gender");
    expect(payload).not.toHaveProperty("birthDate");
    expect(payload.temporaryPassword).toBe("TempPass12");
  });

  it("n'envoie pas le scope global comme établissement", () => {
    expect(toCreateTeacherIdentityPayload(draft({ schoolCode: "*" })).schoolCode).toBe("");
  });
});
