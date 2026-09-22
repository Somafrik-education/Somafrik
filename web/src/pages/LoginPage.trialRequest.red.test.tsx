import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const CTA_LABEL = "Demander 1 mois d'essai gratuit";
const TRIAL_PATH = "/demande-essai";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    session: null,
    login: vi.fn(),
    changePassword: vi.fn(),
    setSession: vi.fn(),
  }),
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { LoginPage } from "./LoginPage";

describe("LoginPage — CTA demande d'essai (RED)", () => {
  it("propose le CTA essai sous le formulaire, sans le mêler à la connexion", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /Connexion plateforme/i })).toBeInTheDocument();
    const trial = screen.getByRole("link", { name: CTA_LABEL });
    expect(trial).toHaveAttribute("href", TRIAL_PATH);
    expect(screen.getByRole("button", { name: /se connecter/i })).toBeInTheDocument();
  });

  it("n'affiche toujours pas l'aide produit sur /connexion", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: /ouvrir l.aide/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/besoin d.aide/i)).not.toBeInTheDocument();
  });
});
