import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
});
