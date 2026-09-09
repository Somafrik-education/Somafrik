/**
 * P0 [RED] — LOT RED-2 / RED-7
 * Après connexion, une page autorisée (Paramètres, dashboard, établissement, notes)
 * ne doit pas devenir indisponible parce qu'un domaine sans rapport répond 403.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../context/AuthContext";
import { DataProvider } from "../context/DataContext";
import { ActiveSchoolProvider } from "../context/ActiveSchoolContext";
import { DomainRouteBootstrap } from "./DomainRouteBootstrap";
import { Topbar } from "./layout/Topbar";
import { ProtectedRoute } from "./ProtectedRoute";
import { SettingsHubPage } from "../pages/parametres/SettingsHubPage";
import { OverviewPage } from "../pages/OverviewPage";
import { EtablissementOverviewPage } from "../pages/etablissement/EtablissementOverviewPage";
import { StudentsListPage } from "../pages/etablissement/StudentsListPage";
import { GradesEvaluationsPage } from "../pages/GradesEvaluationsPage";
import { ParametresLayout } from "../pages/parametres/ParametresLayout";
import { SCHOOL_ADMIN_ROLE } from "../lib/orgHierarchy";
import { getInternalRoleDefaults } from "../lib/internalRoleDefaults";
import {
  createForbiddenFetchCtl,
  installForbiddenDomainFetch,
  sessionForRole,
  type ForbiddenFetchCtl,
} from "../context/forbiddenDomainRedTestUtils";

vi.mock("./ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("./ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn() }),
}));

function persistSession(session: ReturnType<typeof sessionForRole>) {
  sessionStorage.setItem("somafrik.web.session", JSON.stringify(session));
}

async function waitForForbiddenDomainCalls(ctl: ForbiddenFetchCtl) {
  await waitFor(
    () => {
      expect(
        ctl.calls.some((call) => call.path === "/backoffice/messages" && call.status === 403),
      ).toBe(true);
    },
    { timeout: 5000 },
  );
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>
        <ActiveSchoolProvider>{children}</ActiveSchoolProvider>
      </DataProvider>
    </AuthProvider>
  );
}

describe("P0 [RED] — pages globales bloquées par un 403 facultatif", () => {
  let ctl: ForbiddenFetchCtl;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    ctl = createForbiddenFetchCtl();
    ctl.permissions = getInternalRoleDefaults(SCHOOL_ADMIN_ROLE);
    ctl.domainStatus = { messages: 403, announcements: 403 };
    installForbiddenDomainFetch(ctl);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("[RED] RED-2 / RED-7 /parametres reste affichable, session intacte, pas de redirection Login", { timeout: 15000 }, async () => {
    persistSession(sessionForRole(SCHOOL_ADMIN_ROLE));

    render(
      <Providers>
        <MemoryRouter initialEntries={["/parametres"]}>
          <DomainRouteBootstrap />
          <Routes>
            <Route path="/connexion" element={<div>PAGE LOGIN</div>} />
            <Route
              element={
                <ProtectedRoute>
                  <>
                    <Topbar title="Paramètres" />
                    <ParametresLayout />
                  </>
                </ProtectedRoute>
              }
            >
              <Route path="/parametres" element={<SettingsHubPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Profil établissement" })).toBeInTheDocument();
    }, { timeout: 8000 });
    await waitForForbiddenDomainCalls(ctl);
    expect(screen.queryByText("PAGE LOGIN")).not.toBeInTheDocument();
    expect(screen.queryByText(/Impossible de charger/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/accès refusé pour ce domaine/i),
      "la barre d'erreur globale ne doit pas afficher les 403 messages/announcements",
    ).not.toBeInTheDocument();
  });

  it("[RED] RED-7 tableau de bord : un 403 messages/annonces ne masque pas le dashboard", { timeout: 15000 }, async () => {
    persistSession(sessionForRole(SCHOOL_ADMIN_ROLE));

    render(
      <Providers>
        <MemoryRouter initialEntries={["/tableau-de-bord"]}>
          <DomainRouteBootstrap />
          <Topbar title="Tableau de bord" />
          <OverviewPage />
        </MemoryRouter>
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/Rafraîchir les données/i)).toBeEnabled();
    }, { timeout: 5000 });
    await waitForForbiddenDomainCalls(ctl);
    expect(screen.queryByText("PAGE LOGIN")).not.toBeInTheDocument();
    expect(screen.queryByText(/Impossible de charger/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/accès refusé pour ce domaine/i)).not.toBeInTheDocument();
  });

  it("[RED] RED-7 /etablissement/vue-ensemble ne doit pas passer en ErrorState à cause de messages 403", { timeout: 15000 }, async () => {
    persistSession(sessionForRole(SCHOOL_ADMIN_ROLE));

    render(
      <Providers>
        <MemoryRouter initialEntries={["/etablissement/vue-ensemble"]}>
          <DomainRouteBootstrap />
          <Topbar title="Vue d'ensemble" />
          <EtablissementOverviewPage />
        </MemoryRouter>
      </Providers>,
    );

    await waitForForbiddenDomainCalls(ctl);
    await waitFor(() => {
      expect(screen.queryByText(/Chargement des données de l’établissement/i)).not.toBeInTheDocument();
    }, { timeout: 5000 });

    expect(screen.queryByText("Impossible de charger la vue d’ensemble.")).not.toBeInTheDocument();
    expect(screen.queryByText(/accès refusé pour ce domaine/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Élèves" })).toBeInTheDocument();
  });

  it("[RED] RED-7 page établissement /eleves reste utilisable si messages 403", { timeout: 15000 }, async () => {
    persistSession(sessionForRole(SCHOOL_ADMIN_ROLE));

    render(
      <Providers>
        <MemoryRouter initialEntries={["/etablissement/eleves"]}>
          <DomainRouteBootstrap />
          <StudentsListPage />
        </MemoryRouter>
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByText("Élèves")).toBeInTheDocument();
    }, { timeout: 5000 });
    await waitForForbiddenDomainCalls(ctl);
    expect(screen.queryByText(/accès refusé pour ce domaine/i)).not.toBeInTheDocument();
    expect(screen.getByText("Amina Nuru")).toBeInTheDocument();
  });

  it("[RED] RED-7 page Parent /notes : un 403 messages ne doit pas afficher une panne Notes", { timeout: 15000 }, async () => {
    persistSession(sessionForRole("Parent", "access-parent"));
    ctl.permissions = getInternalRoleDefaults("Parent");

    render(
      <Providers>
        <MemoryRouter initialEntries={["/notes"]}>
          <DomainRouteBootstrap />
          <GradesEvaluationsPage />
        </MemoryRouter>
      </Providers>,
    );

    await waitForForbiddenDomainCalls(ctl);
    expect(screen.queryByText(/Synchronisation Notes en échec/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/accès refusé pour ce domaine/i)).not.toBeInTheDocument();
  });
});
