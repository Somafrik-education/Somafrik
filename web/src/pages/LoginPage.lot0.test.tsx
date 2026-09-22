import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  isAuthenticated: true,
  session: {
    accessToken: "token",
    user: { mustChangePassword: true, role: "Admin School" },
  },
  login: vi.fn(),
  changePassword: vi.fn(),
  setSession: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { LoginPage } from "./LoginPage";

describe("LOT 0 — PARITY-011 LoginPage session restreinte", () => {
  it("réouvre la modal de changement de mot de passe si la session l'exige encore", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("dialog", { name: /nouveau mot de passe/i })).toBeInTheDocument();
  });
  it("affiche puis masque le mot de passe de connexion sans perdre la valeur", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    const input = screen.getByTestId("login-password");
    await user.type(input, "Secret#123");
    expect(input).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Afficher le mot de passe de connexion" }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("Secret#123");

    await user.click(screen.getByRole("button", { name: "Masquer le mot de passe de connexion" }));
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveValue("Secret#123");
  });

  it("gère indépendamment le nouveau mot de passe et sa confirmation", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    const nextPassword = screen.getByTestId("login-new-password");
    const confirmation = screen.getByTestId("login-confirm-password");
    expect(nextPassword).toHaveAttribute("type", "password");
    expect(confirmation).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Afficher le nouveau mot de passe" }));
    expect(nextPassword).toHaveAttribute("type", "text");
    expect(confirmation).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Afficher la confirmation du mot de passe" }));
    expect(confirmation).toHaveAttribute("type", "text");
  });
});
