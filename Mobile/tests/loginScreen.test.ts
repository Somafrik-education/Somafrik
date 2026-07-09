import { describe, it, expect } from "vitest";

import {
  ROLE_SELECTION_COPY,
  LOGIN_SCREEN_COPY,
  MIN_TOUCH_TARGET,
  ERROR_MESSAGES,
  canSubmitLogin,
  mapKeyboardToInputMode,
  mapLoginApiError,
  mapSchoolCodeError,
  isUserFriendlyErrorMessage,
  resolveIdentifierKeyboardType,
  resolveSecretKeyboardType,
} from "../src/lib/loginScreenSpec";

describe("loginScreenSpec", () => {
  it("définit des consignes de connexion compréhensibles", () => {
    expect(ROLE_SELECTION_COPY.description).toContain("code");
    expect(LOGIN_SCREEN_COPY.identifierHint).toMatch(/téléphone|email|identifiant/i);
  });

  it("choisit le clavier téléphone pour un numéro", () => {
    expect(resolveIdentifierKeyboardType("+243 820 123456")).toBe("phone-pad");
    expect(mapKeyboardToInputMode("phone-pad")).toBe("numeric");
  });

  it("choisit le clavier email pour une adresse email", () => {
    expect(resolveIdentifierKeyboardType("prof@ecole.app")).toBe("email-address");
    expect(mapKeyboardToInputMode("email-address")).toBe("email");
  });

  it("utilise un clavier numérique pour le PIN parent/élève", () => {
    expect(resolveSecretKeyboardType("parent_student")).toBe("number-pad");
    expect(resolveSecretKeyboardType("teacher")).toBe("default");
  });

  it("désactive la connexion si champs obligatoires vides", () => {
    expect(canSubmitLogin({ role: "parent_student" }, "", "1234", false)).toBe(false);
    expect(canSubmitLogin({ role: "parent_student" }, "+243820", "", false)).toBe(false);
    expect(canSubmitLogin(null, "+243820", "1234", false)).toBe(false);
    expect(canSubmitLogin({ role: "teacher" }, "ENS-1", "1234", true)).toBe(false);
    expect(canSubmitLogin({ role: "teacher" }, "ENS-1", "1234", false)).toBe(true);
  });

  it("fixe une cible tactile minimale", () => {
    expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  });

  it("traduit les erreurs API en messages simples", () => {
    expect(mapLoginApiError("Identifiant ou mot de passe incorrect.", "parent_student")).toBe(
      ERROR_MESSAGES.invalidPin,
    );
    expect(mapSchoolCodeError("Établissement introuvable (404)")).toBe(ERROR_MESSAGES.invalidSchoolCode);
    expect(
      mapLoginApiError("fetch failed\n\nAPI : http://127.0.0.1:5000/api\nBackend attendu", "teacher"),
    ).toBe(ERROR_MESSAGES.invalidCredentials);
  });

  it("rejette les messages techniques pour l'utilisateur", () => {
    expect(isUserFriendlyErrorMessage("PIN incorrect.")).toBe(true);
    expect(isUserFriendlyErrorMessage("JWT expired on /api/login")).toBe(false);
  });
});
