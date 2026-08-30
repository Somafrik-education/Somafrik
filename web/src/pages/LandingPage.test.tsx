import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  marketingHero,
  marketingLegalRoutes,
  marketingLogin,
  marketingNav,
  marketingProduct,
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
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getAllByRole("link", { name: "Produit" }).length).toBeGreaterThan(0);
  });
});
