import { describe, it, expect } from "vitest";

import {
  WELCOME_SCREEN_COPY,
  WELCOME_TEST_IDS,
  MOBILE_VIEWPORTS,
  WELCOME_MAX_DISPLAY_MS,
  assertNoSiblingOverlap,
  boxWithinViewport,
  estimateWelcomeContentHeight,
  welcomeFitsViewport,
} from "../src/lib/welcomeScreenSpec";

describe("welcomeScreenSpec — contrat UI", () => {
  it("expose les libellés attendus par le scénario E2E", () => {
    expect(WELCOME_SCREEN_COPY.brandName).toBe("Somafrik");
    expect(WELCOME_SCREEN_COPY.loginButtonLabel).toBe("Se connecter");
    expect(WELCOME_SCREEN_COPY.subtitle).toContain("ERP scolaire");
  });

  it("définit des testID stables pour l'automatisation", () => {
    expect(WELCOME_TEST_IDS.logo).toBe("welcome-logo");
    expect(WELCOME_TEST_IDS.brand).toBe("welcome-brand");
    expect(WELCOME_TEST_IDS.loginButton).toBe("welcome-login-button");
  });

  it("estime une hauteur de contenu raisonnable", () => {
    const height = estimateWelcomeContentHeight();
    expect(height).toBeGreaterThan(300);
    expect(height).toBeLessThan(600);
  });

  it("s'adapte aux viewports mobiles courants sans scroll", () => {
    for (const viewport of MOBILE_VIEWPORTS) {
      expect(welcomeFitsViewport(viewport)).toBe(true);
    }
  });

  it("signale un viewport trop petit", () => {
    expect(welcomeFitsViewport({ width: 320, height: 400 })).toBe(false);
  });

  it("détecte les chevauchements entre blocs", () => {
    const overlap = assertNoSiblingOverlap([
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 50, y: 25, width: 100, height: 50 },
    ]);
    expect(overlap).toMatch(/Chevauchement/);

    const ok = assertNoSiblingOverlap([
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 0, y: 60, width: 100, height: 50 },
    ]);
    expect(ok).toBeNull();
  });

  it("valide qu'une boîte reste dans le viewport", () => {
    const viewport = { width: 390, height: 844 };
    expect(boxWithinViewport({ x: 10, y: 20, width: 100, height: 40 }, viewport)).toBe(true);
    expect(boxWithinViewport({ x: 300, y: 820, width: 100, height: 40 }, viewport)).toBe(false);
  });

  it("fixe un délai d'affichage acceptable (animation incluse)", () => {
    expect(WELCOME_MAX_DISPLAY_MS).toBeGreaterThanOrEqual(900);
    expect(WELCOME_MAX_DISPLAY_MS).toBeLessThanOrEqual(3000);
  });
});
