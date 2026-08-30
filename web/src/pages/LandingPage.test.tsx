import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  marketingBusinessProofs,
  marketingHero,
  marketingLegalRoutes,
  marketingLogin,
  marketingMobileVisuals,
  marketingNav,
  marketingProduct,
  marketingProductVisual,
  marketingWebMobile,
} from "../data/marketingContent";

const navigateMock = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  isAuthenticated: false,
  session: null as {
    accessToken?: string;
    user?: { role?: string; mustChangePassword?: boolean };
  } | null,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

import { LandingPage } from "./LandingPage";

const FORBIDDEN_PUBLIC_COPY = [
  /Super administrateur/i,
  /Administrateur pays/i,
  /Droits CRUD/i,
  /matrice de permissions/i,
  /socle MVP/i,
  /6 modules/i,
  /universit/i,
  /temps réel/i,
  /paiement en ligne/i,
  /hors ligne/i,
  /Play Store|App Store/i,
  /Demander une démo/i,
  /Réserver une démo/i,
  /Nous contacter/i,
  /\bERP\b/i,
  /\bRBAC\b/i,
];

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe("LandingPage — vitrine publique", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    authState.isAuthenticated = false;
    authState.session = null;
  });

  it("expose un seul H1 orienté établissement et le CTA de connexion", () => {
    renderLanding();
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(marketingHero.title);
    expect(screen.getAllByRole("link", { name: marketingHero.primaryCta.label }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: marketingHero.primaryCta.label })[0]).toHaveAttribute(
      "href",
      marketingLogin.href,
    );
  });

  it("active Voir le produit seulement parce que #produit existe", () => {
    const { container } = renderLanding();
    const product = container.querySelector("#produit");
    expect(product).not.toBeNull();
    expect(screen.getByRole("heading", { name: marketingProduct.title })).toBeInTheDocument();
    const secondary = screen.getByRole("link", { name: marketingHero.secondaryCta.label });
    expect(secondary).toHaveAttribute("href", "#produit");
  });

  it("n’affiche aucun jargon interdit ni CTA mort", () => {
    const { container } = renderLanding();
    const text = container.textContent ?? "";
    for (const pattern of FORBIDDEN_PUBLIC_COPY) {
      expect(text).not.toMatch(pattern);
    }
    expect(marketingLegalRoutes).toHaveLength(0);
    expect(screen.queryByRole("link", { name: /Mentions légales|Confidentialité|Conditions/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/support@somafrik\.app/i)).not.toBeInTheDocument();
  });

  it("n’utilise que des ancres publiques valides ou /connexion", () => {
    const { container } = renderLanding();
    const ids = new Set([...container.querySelectorAll("[id]")].map((node) => node.id));
    const hrefs = [...container.querySelectorAll("a[href]")].map((node) => node.getAttribute("href") ?? "");
    for (const href of hrefs) {
      if (href.startsWith("#")) {
        expect(ids.has(href.slice(1)), `ancre manquante : ${href}`).toBe(true);
      } else {
        expect(["/", "/connexion"]).toContain(href);
      }
    }
    for (const link of marketingNav) {
      expect(ids.has(link.href.slice(1))).toBe(true);
    }
  });

  it("redirige un utilisateur déjà connecté", () => {
    authState.isAuthenticated = true;
    authState.session = {
      accessToken: "token",
      user: { role: "Admin School", mustChangePassword: false },
    };
    renderLanding();
    expect(navigateMock).toHaveBeenCalledWith("/etablissement", { replace: true });
  });

  it("ne redirige pas un visiteur anonyme", () => {
    renderLanding();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("ouvre la navigation mobile sans créer de lien mort", async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getAllByRole("link", { name: "Produit" }).length).toBeGreaterThan(0);
  });

  it("garde un header collant sans casser le défilement de page", () => {
    const { container } = renderLanding();
    const header = container.querySelector("header");
    const shell = container.firstElementChild;
    expect(header?.className).toMatch(/\bsticky\b/);
    expect(shell?.className).toMatch(/overflow-x-clip/);
    expect(shell?.className).not.toMatch(/overflow-x-hidden/);
  });

  it("expose la navigation header canonique et le CTA Connexion", () => {
    renderLanding();
    for (const link of marketingNav) {
      const matches = screen.getAllByRole("link", { name: link.label });
      expect(matches.some((node) => node.getAttribute("href") === link.href)).toBe(true);
    }
    expect(screen.getAllByRole("link", { name: marketingLogin.label })[0]).toHaveAttribute(
      "href",
      marketingLogin.href,
    );
  });

  it("affiche la capture réelle et retire le placeholder VITRINE-01", () => {
    const { container } = renderLanding();
    const images = [...container.querySelectorAll("img")].filter((image) =>
      (image.getAttribute("src") ?? "").includes("somafrik-dashboard-etablissement.webp"),
    );
    expect(images.length).toBeGreaterThanOrEqual(2);
    expect(images[0]).toHaveAttribute("alt", marketingProductVisual.alt);
    expect(images[0]).not.toHaveAttribute("loading", "lazy");
    expect(images.some((image) => image.getAttribute("loading") === "lazy")).toBe(true);
    expect(screen.queryByText(/Emplacement réservé à une capture réelle/i)).not.toBeInTheDocument();
  });

  it("ferme le menu mobile après un clic de navigation", async () => {
    const user = userEvent.setup();
    renderLanding();
    await user.click(screen.getByRole("button", { name: /menu/i }));
    const mobileNav = screen.getByLabelText("Navigation vitrine mobile");
    await user.click(mobileNav.querySelector('a[href="#produit"]') as HTMLAnchorElement);
    expect(screen.queryByLabelText("Navigation vitrine mobile")).not.toBeInTheDocument();
  });

  it("démontre Web et l’application mobile native dans #web-mobile", () => {
    const { container } = renderLanding();
    const section = container.querySelector("#web-mobile");
    expect(section).not.toBeNull();
    expect(screen.getByRole("heading", { name: marketingWebMobile.title })).toBeInTheDocument();
    expect(section?.querySelector(`img[src="${marketingProductVisual.src}"]`)).not.toBeNull();
    const mobileImages = [...(section?.querySelectorAll("img") ?? [])].filter((image) =>
      (image.getAttribute("src") ?? "").includes("/marketing/mobile/"),
    );
    expect(mobileImages.length).toBeGreaterThanOrEqual(2);
    for (const visual of marketingMobileVisuals) {
      const image = mobileImages.find((node) => node.getAttribute("src") === visual.src);
      expect(image).toBeDefined();
      expect(image).toHaveAttribute("alt", visual.alt);
      expect(image).toHaveAttribute("loading", "lazy");
    }
    expect(section?.innerHTML).not.toMatch(/\/docs\//);
    expect(container.querySelector('img[src*="vitrine_02_hero_mobile"]')).toBeNull();
  });

  it("expose #preuves avec les trois captures métier, sans Notes", () => {
    const { container } = renderLanding();
    const section = container.querySelector("#preuves");
    expect(section).not.toBeNull();
    expect(screen.getByRole("heading", { name: marketingBusinessProofs.title })).toBeInTheDocument();
    expect(marketingBusinessProofs.items).toHaveLength(3);
    const images = [...(section?.querySelectorAll("img") ?? [])];
    expect(images).toHaveLength(3);
    for (const item of marketingBusinessProofs.items) {
      const image = images.find((node) => node.getAttribute("src") === item.src);
      expect(image).toBeDefined();
      expect(image).toHaveAttribute("alt", item.alt);
      expect(image).toHaveAttribute("loading", "lazy");
      expect(image).toHaveAttribute("decoding", "async");
    }
    expect(section?.innerHTML).not.toMatch(/\/docs\//);
    expect(section?.innerHTML).not.toMatch(/data:image\//);
    expect(section?.textContent).not.toMatch(/notes/i);
    expect(screen.queryByRole("heading", { name: /suivre les notes/i })).not.toBeInTheDocument();
  });

  it("conserve le Hero et Web et mobile de VITRINE-02", () => {
    const { container } = renderLanding();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(marketingHero.title);
    const heroImage = container.querySelector('img[src*="somafrik-dashboard-etablissement.webp"]');
    expect(heroImage).not.toHaveAttribute("loading", "lazy");
    expect(container.querySelector("#web-mobile")).not.toBeNull();
    expect(container.querySelectorAll("#web-mobile img[src*='/marketing/mobile/']")).toHaveLength(3);
    expect(marketingNav.some((link) => link.href === "#preuves")).toBe(false);
  });
});
