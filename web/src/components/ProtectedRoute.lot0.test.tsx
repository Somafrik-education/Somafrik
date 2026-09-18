import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtectedRoute } from "./ProtectedRoute";

const authState = vi.hoisted(() => ({
  isAuthenticated: false,
  session: null as {
    accessToken?: string;
    user?: { mustChangePassword?: boolean };
  } | null,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={["/tableau-de-bord"]}>
      <Routes>
        <Route path="/connexion" element={<div>PAGE LOGIN</div>} />
        <Route
          path="/tableau-de-bord"
          element={
            <ProtectedRoute>
              <div>SHELL METIER</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LOT 0 — PARITY-011 ProtectedRoute mustChangePassword", () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.session = null;
  });

  it("redirige vers /connexion sans session", () => {
    renderGuard();
    expect(screen.getByText("PAGE LOGIN")).toBeInTheDocument();
    expect(screen.queryByText("SHELL METIER")).not.toBeInTheDocument();
  });

  it("laisse passer une session authentifiée sans changement de mot de passe", () => {
    authState.isAuthenticated = true;
    authState.session = { accessToken: "token", user: { mustChangePassword: false } };
    renderGuard();
    expect(screen.getByText("SHELL METIER")).toBeInTheDocument();
    expect(screen.queryByText("PAGE LOGIN")).not.toBeInTheDocument();
  });

  it("bloque le shell métier tant que mustChangePassword est vrai, sans détruire la session", () => {
    authState.isAuthenticated = true;
    authState.session = { accessToken: "token", user: { mustChangePassword: true } };
    renderGuard();
    expect(screen.getByText("PAGE LOGIN")).toBeInTheDocument();
    expect(screen.queryByText("SHELL METIER")).not.toBeInTheDocument();
    expect(authState.isAuthenticated).toBe(true);
    expect(authState.session?.accessToken).toBe("token");
  });
});
