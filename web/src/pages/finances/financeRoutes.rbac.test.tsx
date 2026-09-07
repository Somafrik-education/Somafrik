import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionUser } from "../../types";
import { getInternalRoleDefaults } from "../../lib/internalRoleDefaults";

const authState = vi.hoisted(() => ({
  session: {
    user: {
      id: "admin-1",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      permissions: [] as string[],
    } as SessionUser,
    accessToken: "test-token",
  },
  permissionsReady: true,
  permissionsBootstrap: "ready" as const,
  permissionsBootstrapError: null as string | null,
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: authState.session,
    permissionsReady: authState.permissionsReady,
    permissionsBootstrap: authState.permissionsBootstrap,
    permissionsBootstrapError: authState.permissionsBootstrapError,
  }),
}));

import { PermissionRoute } from "../../components/PermissionRoute";
import { FinanceIndexRedirect, FinancesLayout } from "./FinancesLayout";

function PathProbe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}</div>;
}

function renderFinanceRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/etablissement" element={<div>HOME_ETABLISSEMENT</div>} />
        <Route path="/parametres/finances" element={<Navigate to="/finances/frais" replace />} />
        <Route
          path="/finances"
          element={
            <PermissionRoute view={["payments", "fees", "unpaid"]}>
              <FinancesLayout />
            </PermissionRoute>
          }
        >
          <Route index element={<FinanceIndexRedirect />} />
          <Route
            path="paiements"
            element={
              <PermissionRoute view="payments">
                <div>PAIEMENTS_OK</div>
              </PermissionRoute>
            }
          />
          <Route
            path="frais"
            element={
              <PermissionRoute view="fees">
                <div>FRAIS_OK</div>
              </PermissionRoute>
            }
          />
          <Route
            path="impayes"
            element={
              <PermissionRoute view="unpaid">
                <div>IMPAYES_OK</div>
              </PermissionRoute>
            }
          />
        </Route>
      </Routes>
      <PathProbe />
    </MemoryRouter>,
  );
}

function asUser(role: string, permissions: string[]) {
  authState.session.user.role = role;
  authState.session.user.permissions = permissions;
}

describe("P1 RBAC Finances — Frais & tarifs sans Paiements", () => {
  beforeEach(() => {
    asUser("Admin School", ["Frais & tarifs:READ", "Frais & tarifs:UPDATE"]);
  });

  it("utilisateur établissement Frais:READ sans Paiements:READ atteint /finances/frais", () => {
    renderFinanceRoutes("/finances/frais");
    expect(screen.getByText("FRAIS_OK")).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/finances/frais");
    expect(screen.queryByText("HOME_ETABLISSEMENT")).not.toBeInTheDocument();
  });

  it("/parametres/finances redirige vers /finances/frais", () => {
    renderFinanceRoutes("/parametres/finances");
    expect(screen.getByText("FRAIS_OK")).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/finances/frais");
  });

  it("/finances/paiements reste interdit sans Paiements:READ", () => {
    renderFinanceRoutes("/finances/paiements");
    expect(screen.queryByText("PAIEMENTS_OK")).not.toBeInTheDocument();
    expect(screen.getByText("HOME_ETABLISSEMENT")).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/etablissement");
  });

  it("/finances index atterrit sur frais si seul Frais est autorisé", () => {
    renderFinanceRoutes("/finances");
    expect(screen.getByText("FRAIS_OK")).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/finances/frais");
  });

  it("B. Frais seul : onglet Impayés masqué et /finances/impayes refusé", () => {
    const { unmount } = renderFinanceRoutes("/finances/frais");
    expect(screen.getByRole("link", { name: "Frais & tarifs" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Impayés" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Paiements" })).not.toBeInTheDocument();
    unmount();
    renderFinanceRoutes("/finances/impayes");
    expect(screen.queryByText("IMPAYES_OK")).not.toBeInTheDocument();
    expect(screen.getByText("HOME_ETABLISSEMENT")).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/etablissement");
  });
});

describe("P1 RBAC Finances — Impayés:READ seul", () => {
  beforeEach(() => {
    asUser("Admin School", ["Impayés:READ"]);
  });

  it("A. /finances et /finances/impayes accessibles, index atterrit sur impayés", () => {
    const { unmount } = renderFinanceRoutes("/finances");
    expect(screen.getByText("IMPAYES_OK")).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/finances/impayes");
    expect(screen.getByRole("link", { name: "Impayés" })).toBeInTheDocument();
    unmount();
    renderFinanceRoutes("/finances/impayes");
    expect(screen.getByText("IMPAYES_OK")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Impayés" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Frais & tarifs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Paiements" })).not.toBeInTheDocument();
  });
});

describe("P1 RBAC Finances — Paiements:READ seul", () => {
  beforeEach(() => {
    asUser("Admin School", ["Paiements:READ"]);
  });

  it("C. Paiements seul : /finances/paiements OK, Frais et Impayés refusés", () => {
    const first = renderFinanceRoutes("/finances/paiements");
    expect(screen.getByText("PAIEMENTS_OK")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Paiements" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Frais & tarifs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Impayés" })).not.toBeInTheDocument();
    first.unmount();
    const index = renderFinanceRoutes("/finances");
    expect(screen.getByTestId("path")).toHaveTextContent("/finances/paiements");
    index.unmount();
    renderFinanceRoutes("/finances/frais");
    expect(screen.queryByText("FRAIS_OK")).not.toBeInTheDocument();
    expect(screen.getByText("HOME_ETABLISSEMENT")).toBeInTheDocument();
  });
});

describe("P1 RBAC Finances — pas de régression Admin School / Comptable", () => {
  it("Admin School standard atteint Frais et Paiements", () => {
    asUser("Admin School", getInternalRoleDefaults("Admin School"));
    const { unmount } = renderFinanceRoutes("/finances/frais");
    expect(screen.getByText("FRAIS_OK")).toBeInTheDocument();
    unmount();
    renderFinanceRoutes("/finances/paiements");
    expect(screen.getByText("PAIEMENTS_OK")).toBeInTheDocument();
  });

  it("Comptable standard atteint Frais et Paiements", () => {
    asUser("Comptable", getInternalRoleDefaults("Comptable"));
    const { unmount } = renderFinanceRoutes("/finances/frais");
    expect(screen.getByText("FRAIS_OK")).toBeInTheDocument();
    unmount();
    renderFinanceRoutes("/finances/paiements");
    expect(screen.getByText("PAIEMENTS_OK")).toBeInTheDocument();
  });

  it("App.tsx garde le shell OU et les vues enfants", () => {
    const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../App.tsx"), "utf8");
    expect(app).toMatch(/view=\{\["payments", "fees", "unpaid"\]\}/);
    expect(app).toMatch(/path="frais"[\s\S]{0,180}?PermissionRoute view="fees"/);
    expect(app).toMatch(/path="paiements"[\s\S]{0,180}?PermissionRoute view="payments"/);
    expect(app).toMatch(/path="impayes"[\s\S]{0,180}?PermissionRoute view="unpaid"/);
    expect(app).toMatch(/path="finances"[\s\S]{0,250}?Navigate to="\/finances\/frais"/);
  });
});
