import { describe, it, expect } from "vitest";

import {
  validatePasswordPolicy,
  validatePinPolicy,
  findDuplicateLoginIdentifier,
  isUserAccountDeleted,
} from "../src/lib/userAccountRules";
import {
  validateUserAccount,
  generateUserIdentifier,
  getRoleDefaults,
} from "../src/lib/userAccounts";
import type { UserAccount } from "../src/types";

function baseUser(overrides: Partial<UserAccount> = {}): UserAccount {
  const role = overrides.role ?? "Enseignant";
  const schoolCode = overrides.schoolCode ?? "SCH1";
  const defaults = getRoleDefaults(role, schoolCode);
  return {
    id: "USR-NEW",
    identifier: "ENS-0009",
    firstName: "Paul",
    lastName: "Mukendi",
    role,
    schoolCode,
    scopeLevel: defaults.scopeLevel,
    accessChannel: defaults.accessChannel,
    status: "Actif",
    ...overrides,
  };
}

describe("userAccountRules — validateurs", () => {
  it("accepte un mot de passe valide", () => {
    expect(validatePasswordPolicy("Secret123")).toBeNull();
  });

  it("rejette un mot de passe faible", () => {
    expect(validatePasswordPolicy("abc")).toMatch(/8 caractères/i);
    expect(validatePasswordPolicy("abcdefgh")).toMatch(/chiffre/i);
  });

  it("accepte un PIN de 6 chiffres", () => {
    expect(validatePinPolicy("123456")).toBeNull();
  });

  it("rejette un PIN invalide", () => {
    expect(validatePinPolicy("12345")).toMatch(/6 chiffres/i);
    expect(validatePinPolicy("12AB56")).toMatch(/6 chiffres/i);
    expect(validatePinPolicy("")).toMatch(/6 chiffres/i);
  });

  it("détecte un identifiant déjà utilisé", () => {
    const users = [baseUser({ id: "USR-1", identifier: "ENS-0001" })];
    const duplicate = findDuplicateLoginIdentifier(users, {
      identifier: "ENS-0001",
      schoolCode: "SCH1",
    });
    expect(duplicate?.id).toBe("USR-1");
  });
});

describe("userAccounts — création et validation", () => {
  it("génère un identifiant utilisateur avec préfixe rôle", () => {
    const users = [baseUser({ identifier: "ENS-0003" })];
    expect(generateUserIdentifier(users, "Enseignant")).toBe("ENS-0004");
    expect(generateUserIdentifier(users, "Parent")).toBe("PAR-0001");
  });

  it("valide un compte utilisateur correct", () => {
    const user = baseUser();
    expect(validateUserAccount(user, [], ["Enseignant", "Secrétaire"])).toBeNull();
  });

  it("rejette un email/identifiant vide", () => {
    const user = baseUser({ identifier: "" });
    expect(validateUserAccount(user, [], ["Enseignant"])).toMatch(/identifiant/i);
  });

  it("rejette un rôle manquant", () => {
    const user = baseUser({ role: "" });
    expect(validateUserAccount(user, [], ["Enseignant"])).toMatch(/rôle/i);
  });

  it("rejette un établissement manquant pour un rôle local", () => {
    const user = baseUser({ schoolCode: "" });
    expect(validateUserAccount(user, [], ["Enseignant"])).toMatch(/établissement/i);
  });

  it("rejette un identifiant déjà utilisé", () => {
    const existing = baseUser({ id: "USR-1", identifier: "ENS-0001" });
    const candidate = baseUser({ identifier: "ENS-0001" });
    expect(validateUserAccount(candidate, [existing], ["Enseignant"])).toMatch(/déjà utilisé/i);
  });

  it("marque un compte inactif comme non supprimé mais désactivé", () => {
    expect(isUserAccountDeleted({ status: "Inactif" })).toBe(false);
    expect(isUserAccountDeleted({ status: "Supprimé" })).toBe(true);
  });
});
