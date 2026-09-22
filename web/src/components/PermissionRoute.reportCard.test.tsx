import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { SessionUser } from "../types";

const authState = vi.hoisted(() => ({
  session: {
    user: {
      id: "user-1",
      role: "Secrétaire",
      schoolCode: "CD-2026-0001",
      permissions: ["Bulletins:READ"] as string[],
    } as SessionUser,
    accessToken: "test-token",
  },
  permissionsReady: true,
  permissionsBootstrap: "ready" as const,
  permissionsBootstrapError: null as string | null,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: authState.session,
    permissionsReady: authState.permissionsReady,
    permissionsBootstrap: authState.permissionsBootstrap,
    permissionsBootstrapError: authState.permissionsBootstrapError,
  }),
}));

import { PermissionRoute } from "./PermissionRoute";

function PathProbe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}</div>;
}

function renderBulletinRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/bulletins/modele"
          element={
            <PermissionRoute view="bulletins" action="CREATE" fallbackPath="/bulletins">
              <div>MODELE_OK</div>
            </PermissionRoute>
          }
        />
        <Route
          path="/bulletins"
          element={
            <PermissionRoute view="bulletins">
              <div>LISTE_OK</div>
            </PermissionRoute>
          }
        />
      </Routes>
      <PathProbe />
    </MemoryRouter>,
  );
}

function asUser(role: string, permissions: string[]) {
  authState.session.user.role = role;
  authState.session.user.permissions = permissions;
}

describe("P1-A PermissionRoute /bulletins/modele CREATE", () => {
  beforeEach(() => {
    asUser("Secrétaire", ["Bulletins:READ"]);
  });

  it("READ-only est redirigé hors de /bulletins/modele vers /bulletins", () => {
    renderBulletinRoutes("/bulletins/modele");
    expect(screen.queryByText("MODELE_OK")).not.toBeInTheDocument();
    expect(screen.getByText("LISTE_OK")).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/bulletins");
  });

  it("/bulletins liste reste ouverte en READ-only", () => {
    renderBulletinRoutes("/bulletins");
    expect(screen.getByText("LISTE_OK")).toBeInTheDocument();
    expect(screen.queryByText("MODELE_OK")).not.toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/bulletins");
  });

  it("Bulletins:CREATE ouvre /bulletins/modele", () => {
    asUser("Admin School", ["Bulletins:READ", "Bulletins:CREATE", "Bulletins:UPDATE"]);
    renderBulletinRoutes("/bulletins/modele");
    expect(screen.getByText("MODELE_OK")).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/bulletins/modele");
  });
});
