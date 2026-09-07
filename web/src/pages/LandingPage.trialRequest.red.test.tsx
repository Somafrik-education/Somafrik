import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const CTA_LABEL = "Demander 1 mois d'essai gratuit";
const TRIAL_PATH = "/demande-essai";

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

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe("LandingPage — CTA demande d'essai (RED)", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    authState.isAuthenticated = false;
    authState.session = null;
  });

  it("affiche le CTA « Demander 1 mois d'essai gratuit » vers /demande-essai", () => {
    renderLanding();
    const links = screen.getAllByRole("link", { name: CTA_LABEL });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", TRIAL_PATH);
    }
  });

  it("garde Se connecter pour les clients déjà équipés", () => {
    renderLanding();
    const loginLinks = screen.getAllByRole("link", { name: "Connexion" });
    expect(loginLinks.length).toBeGreaterThan(0);
    expect(loginLinks[0]).toHaveAttribute("href", "/connexion");
  });

  it("n'annonce pas de délai de rappel 48 h", () => {
    const { container } = renderLanding();
    expect(container.textContent ?? "").not.toMatch(/48\s*h/i);
  });

  it("n'utilise plus les CTA interdits Demander une démo / Nous contacter", () => {
    const { container } = renderLanding();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Demander une démo/i);
    expect(text).not.toMatch(/Réserver une démo/i);
    expect(text).not.toMatch(/Nous contacter/i);
  });

  it("redirige un utilisateur déjà authentifié hors de la vitrine (pas de CTA essai en session)", () => {
    authState.isAuthenticated = true;
    authState.session = {
      accessToken: "token",
      user: { role: "Admin School", mustChangePassword: false },
    };
    renderLanding();
    expect(navigateMock).toHaveBeenCalledWith("/etablissement", { replace: true });
  });
});
