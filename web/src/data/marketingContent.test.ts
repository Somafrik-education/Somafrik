import { describe, expect, it } from "vitest";
import {
  marketingAudiences,
  marketingAudiencesSection,
  marketingBusinessProofs,
  marketingFinalCta,
  marketingHero,
  marketingHeroVisual,
  marketingLegalRoutes,
  marketingLogin,
  marketingMobileVisuals,
  marketingNav,
  marketingProduct,
  marketingProductVisual,
  marketingSecurity,
  marketingSeo,
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

  it("sépare le visuel marketing Hero du visuel Produit", () => {
    expect(marketingHeroVisual.src).toMatch(/marketing\/somafrik-dashboard-hero\.webp$/);
    expect(marketingHeroVisual.alt).toBe(
      "Tableau de bord Somafrik présentant la scolarité, les paiements, les présences et le suivi pédagogique d’un établissement.",
    );
    expect(marketingHeroVisual.caption).toBe(
      "Visuel marketing du tableau de bord Somafrik, basé sur l’interface produit.",
    );
    expect(marketingHeroVisual.width).toBe(1760);
    expect(marketingHeroVisual.height).toBe(1400);
    expect(marketingHeroVisual.src).not.toBe(marketingProductVisual.src);
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

  it("décrit quatre preuves métier runtime, dont la saisie des notes", () => {
    expect(marketingBusinessProofs.id).toBe("preuves");
    expect(marketingBusinessProofs.items).toHaveLength(4);
    expect(marketingBusinessProofs.items.map((item) => item.id)).toEqual([
      "finance",
      "presences",
      "pedagogie",
      "notes",
    ]);
    expect(marketingBusinessProofs.items.every((item) => item.src.includes("/marketing/proofs/"))).toBe(true);
    expect(marketingBusinessProofs.items.every((item) => !item.src.includes("/docs/"))).toBe(true);
    expect(marketingBusinessProofs.items[2]?.title).toBe("Organiser les évaluations");
    expect(marketingBusinessProofs.items[2]?.caption).toBe("Évaluations");
    expect(marketingBusinessProofs.items[3]?.title).toBe("Saisir les notes des élèves");
    expect(marketingBusinessProofs.items[3]?.description).toBe(
      "L’enseignant saisit les résultats d’une évaluation directement depuis l’application.",
    );
    expect(marketingBusinessProofs.items[3]?.src).toMatch(/somafrik-notes-saisie\.webp$/);
  });

  it("présente les quatre audiences et une sécurité vérifiable", () => {
    expect(marketingAudiencesSection.eyebrow).toBe("Pour qui ?");
    expect(marketingAudiences.map((item) => item.title)).toEqual([
      "Direction",
      "Administration",
      "Enseignants",
      "Parents",
    ]);
    expect(marketingSecurity.items).toHaveLength(3);
    expect(marketingSecurity.items.map((item) => item.title)).toEqual([
      "Authentification",
      "Séparation des établissements",
      "Accès selon les responsabilités",
    ]);
    const securityText = [marketingSecurity.title, marketingSecurity.intro, ...marketingSecurity.items.flatMap((item) => [item.title, item.text])].join(" ");
    expect(securityText).not.toMatch(/ISO|SOC 2|99,99|souverain|chiffrement certifié/i);
  });

  it("décrit le SEO public sans inventer de domaine ni de conformité", () => {
    expect(marketingSeo.title).toBe("Somafrik — Pilotez votre établissement scolaire");
    expect(marketingSeo.description.length).toBeGreaterThan(80);
    expect(marketingSeo.description.length).toBeLessThan(200);
    expect(marketingSeo.ogImage).toMatch(/marketing\/somafrik-dashboard-etablissement\.webp$/);
    expect(marketingSeo.ogLocale).toBe("fr_FR");
    expect(`${marketingSeo.title} ${marketingSeo.description} ${marketingSeo.ogDescription}`).not.toMatch(
      /ISO|SOC 2|Demander une démo|Nous contacter/i,
    );
  });
});
