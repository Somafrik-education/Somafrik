/**
 * P0/P1 — LOT RED-2 / RED-7 devenu contrat de non-régression.
 * Après connexion, une page autorisée (Paramètres, dashboard, établissement, notes)
 * ne doit ni charger les listes Communication hors périmètre, ni devenir indisponible
 * à cause d'un domaine sans rapport.
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

async function waitForPathCall(ctl: ForbiddenFetchCtl, predicate: (path: string) => boolean) {
  await waitFor(
    () => {
      expect(ctl.calls.some((call) => call.method === "GET" && predicate(call.path))).toBe(true);
    },
    { timeout: 5000 },
  );
}

function expectNoGlobalCommunicationListFetch(ctl: ForbiddenFetchCtl) {
  expect(
    ctl.calls.filter(
      (call) =>
        call.method === "GET" &&
        (call.path === "/backoffice/messages" || call.path === "/backoffice/announcements"),
    ),
  ).toEqual([]);
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

describe("P0/P1 — pages globales indépendantes des domaines Communication", () => {
  let ctl: ForbiddenFetchCtl;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    ctl = createForbiddenFetchCtl();
    ctl.permissions = getInternalRoleDefaults(SCHOOL_ADMIN_ROLE);
    // Sentinelle : si une page hors Communication déclenche encore ces GET,
    // le backend répond 403 et le test doit le révéler.
    ctl.domainStatus = { messages: 403, announcements: 403 };
    installForbiddenDomainFetch(ctl);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("RED-2 / RED-7 /parametres reste affichable sans GET messages/announcements", { timeout: 15000 }, async () => {
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
    await waitForPathCall(ctl, (path) => path.includes("academic-config"));

    expectNoGlobalCommunicationListFetch(ctl);
    expect(screen.queryByText("PAGE LOGIN")).not.toBeInTheDocument();
    expect(screen.queryByText(/Impossible de charger/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/accès refusé pour ce domaine/i)).not.toBeInTheDocument();
  });

  it("RED-7 tableau de bord : pas de GET Communication parasite ni panne globale", { timeout: 15000 }, async () => {
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

    await waitForPathCall(ctl, (path) => path === "/students");
    await waitFor(() => {
      expect(screen.getByLabelText(/Rafraîchir les données/i)).toBeEnabled();
    }, { timeout: 5000 });

    expectNoGlobalCommunicationListFetch(ctl);
    expect(screen.queryByText("PAGE LOGIN")).not.toBeInTheDocument();
    expect(screen.queryByText(/Impossible de charger/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/accès refusé pour ce domaine/i)).not.toBeInTheDocument();
  });

  it("RED-7 /etablissement/vue-ensemble reste disponible sans GET Communication parasite", { timeout: 15000 }, async () => {
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

    await waitForPathCall(ctl, (path) => path === "/students");
    await waitFor(() => {
      expect(screen.queryByText(/Chargement des données de l’établissement/i)).not.toBeInTheDocument();
    }, { timeout: 5000 });

    expectNoGlobalCommunicationListFetch(ctl);
    expect(screen.queryByText("Impossible de charger la vue d’ensemble.")).not.toBeInTheDocument();
    expect(screen.queryByText(/accès refusé pour ce domaine/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Élèves" })).toBeInTheDocument();
  });

  it("RED-7 page établissement /eleves reste utilisable sans GET Communication parasite", { timeout: 15000 }, async () => {
    persistSession(sessionForRole(SCHOOL_ADMIN_ROLE));

    render(
      <Providers>
        <MemoryRouter initialEntries={["/etablissement/eleves"]}>
          <DomainRouteBootstrap />
          <StudentsListPage />
        </MemoryRouter>
      </Providers>,
    );

    await waitForPathCall(ctl, (path) => path === "/students");
    await waitFor(() => {
      expect(screen.getByText("Amina Nuru")).toBeInTheDocument();
    }, { timeout: 5000 });

    expectNoGlobalCommunicationListFetch(ctl);
    expect(screen.queryByText(/accès refusé pour ce domaine/i)).not.toBeInTheDocument();
  });

  it("RED-7 page Parent /notes : pas de GET Communication parasite ni fausse panne Notes", { timeout: 15000 }, async () => {
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

    await waitForPathCall(ctl, (path) => path === "/notes");

    expectNoGlobalCommunicationListFetch(ctl);
    expect(screen.queryByText(/Synchronisation Notes en échec/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/accès refusé pour ce domaine/i)).not.toBeInTheDocument();
  });

  it("GREEN HTTP Messages : Messages:READ charge bien /backoffice/messages sur /messages", { timeout: 15000 }, async () => {
    persistSession(sessionForRole(SCHOOL_ADMIN_ROLE));
    ctl.domainStatus.messages = 200;

    render(
      <Providers>
        <MemoryRouter initialEntries={["/messages"]}>
          <DomainRouteBootstrap />
          <div>PAGE MESSAGES AUTORISÉE</div>
        </MemoryRouter>
      </Providers>,
    );

    await waitForPathCall(ctl, (path) => path === "/backoffice/messages");

    expect(
      ctl.calls.some(
        (call) =>
          call.method === "GET" &&
          call.path === "/backoffice/messages" &&
          call.status === 200,
      ),
    ).toBe(true);
    expect(
      ctl.calls.some((call) => call.method === "GET" && call.path === "/backoffice/announcements"),
    ).toBe(false);
  });

  it("GREEN HTTP Messages : sans Messages:READ aucun GET /backoffice/messages", { timeout: 15000 }, async () => {
    ctl.permissions = getInternalRoleDefaults("Surveillant");
    persistSession(sessionForRole("Surveillant", "access-surveillant"));

    render(
      <Providers>
        <MemoryRouter initialEntries={["/messages"]}>
          <DomainRouteBootstrap />
          <div>PROBE SANS DROIT MESSAGES</div>
        </MemoryRouter>
      </Providers>,
    );

    await waitForPathCall(ctl, (path) => path === "/auth/effective-permissions");

    expect(
      ctl.calls.some((call) => call.method === "GET" && call.path === "/backoffice/messages"),
    ).toBe(false);
  });
});
