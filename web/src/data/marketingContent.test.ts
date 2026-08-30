import { describe, expect, it } from "vitest";
import {
  marketingFinalCta,
  marketingHero,
  marketingLegalRoutes,
  marketingLogin,
  marketingMobileVisuals,
  marketingNav,
  marketingProduct,
  marketingProductVisual,
  marketingSecurity,
  marketingWebMobile,
} from "./marketingContent";

describe("marketingContent", () => {
  it("aligne le CTA secondaire sur une section produit existante", () => {
    expect(marketingProduct.id).toBe("produit");
    expect(marketingHero.secondaryCta.href).toBe("#produit");
    expect(marketingNav.some((link) => link.href === "#produit")).toBe(true);
  });

  it("n’expose que Connexion comme action commerciale", () => {
    expect(marketingHero.primaryCta.href).toBe("/connexion");
    expect(marketingFinalCta.cta.href).toBe("/connexion");
    expect(marketingLogin.href).toBe("/connexion");
    expect(marketingLegalRoutes).toEqual([]);
  });

  it("garde des identifiants de section stables", () => {
    expect(marketingWebMobile.id).toBe("web-mobile");
    expect(marketingSecurity.id).toBe("securite");
  });

  it("pointe vers la capture locale du tableau de bord", () => {
    expect(marketingProductVisual.src).toMatch(/marketing\/somafrik-dashboard-etablissement\.webp$/);
    expect(marketingProductVisual.alt.length).toBeGreaterThan(20);
    expect(marketingProductVisual.width).toBe(1440);
    expect(marketingProductVisual.height).toBe(900);
  });

  it("décrit Web et mobile depuis la copie canonique", () => {
    expect(marketingWebMobile.web.text).toBe(
      "Pilotez et administrez votre établissement depuis un écran complet.",
    );
    expect(marketingWebMobile.mobile.text).toBe(
      "Retrouvez les opérations du quotidien directement dans l’application Somafrik.",
    );
    expect(marketingMobileVisuals).toHaveLength(3);
    expect(marketingMobileVisuals.every((visual) => visual.src.includes("/marketing/mobile/"))).toBe(true);
    expect(marketingMobileVisuals.every((visual) => !visual.src.includes("/docs/"))).toBe(true);
    expect(marketingMobileVisuals.map((visual) => visual.alt)).toEqual([
      "Application mobile Somafrik — liste des classes",
      "Application mobile Somafrik — liste des élèves",
      "Application mobile Somafrik — liste des enseignants",
    ]);
  });
});
