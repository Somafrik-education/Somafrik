import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    session: null,
    login: vi.fn(),
    changePassword: vi.fn(),
  }),
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { LoginPage } from "./LoginPage";

describe("LoginPage — HELP-V1B absent", () => {
  it("n’affiche pas le bouton d’aide sur /connexion", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: /ouvrir l.aide/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/besoin d.aide/i)).not.toBeInTheDocument();
  });
});
