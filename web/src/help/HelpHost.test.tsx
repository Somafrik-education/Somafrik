import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HelpHost } from "./HelpHost";

const authState = vi.hoisted(() => ({
  session: {
    accessToken: "token",
    user: {
      id: "u1",
      role: "Admin School",
      permissions: [
        "Classes:READ",
        "Classes:CREATE",
        "Élèves:READ",
        "Utilisateurs:READ",
        "Utilisateurs:CREATE",
        "Notes:READ",
        "Paiements:READ",
      ],
    },
  } as {
    accessToken?: string;
    permissions?: string[];
    user?: {
      id?: string;
      role?: string;
      permissions?: string[];
      mustChangePassword?: boolean;
    };
  } | null,
  isAuthenticated: true,
  permissionsReady: true,
  permissionsBootstrap: "ready" as "idle" | "loading" | "ready" | "error",
  permissionsBootstrapError: null as string | null,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => authState,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderHelp(path = "/etablissement/classes") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <HelpHost />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HelpHost — HELP-V1B Web", () => {
  beforeEach(() => {
    authState.isAuthenticated = true;
    authState.permissionsReady = true;
    authState.permissionsBootstrap = "ready";
    authState.session = {
      accessToken: "token",
      user: {
        id: "u1",
        role: "Admin School",
        permissions: [
          "Classes:READ",
          "Classes:CREATE",
          "Élèves:READ",
          "Utilisateurs:READ",
          "Utilisateurs:CREATE",
          "Notes:READ",
          "Paiements:READ",
        ],
      },
    };
  });

  it("shows the help trigger for an authenticated school session", () => {
    renderHelp();
    expect(screen.getByRole("button", { name: "Ouvrir l’aide" })).toBeInTheDocument();
    expect(screen.getByText("Besoin d’aide ?")).toBeInTheDocument();
  });

  it("hides the trigger while permissions are bootstrapping", () => {
    authState.permissionsBootstrap = "loading";
    authState.permissionsReady = false;
    renderHelp();
    expect(screen.queryByRole("button", { name: "Ouvrir l’aide" })).not.toBeInTheDocument();
  });

  it("hides the trigger when help is unavailable for the screen", () => {
    renderHelp("/");
    expect(screen.queryByRole("button", { name: "Ouvrir l’aide" })).not.toBeInTheDocument();
  });

  it("hides the trigger on /connexion even if HelpHost is mounted", () => {
    renderHelp("/connexion");
    expect(screen.queryByRole("button", { name: "Ouvrir l’aide" })).not.toBeInTheDocument();
  });

  it("hides the trigger while a password change is required", () => {
    authState.session = {
      accessToken: "token",
      user: { id: "u1", role: "Admin School", permissions: ["Classes:READ"], mustChangePassword: true },
    };
    renderHelp();
    expect(screen.queryByRole("button", { name: "Ouvrir l’aide" })).not.toBeInTheDocument();
  });

  it("hides the trigger when permissions bootstrap failed", () => {
    authState.permissionsBootstrap = "error";
    authState.permissionsReady = false;
    renderHelp();
    expect(screen.queryByRole("button", { name: "Ouvrir l’aide" })).not.toBeInTheDocument();
  });

  it("opens the panel, lists at most 3 suggestions, and closes with Escape restoring focus", async () => {
    const user = userEvent.setup();
    renderHelp();
    const trigger = screen.getByRole("button", { name: "Ouvrir l’aide" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Besoin d’aide ?" });
    expect(dialog).toBeInTheDocument();

    const suggestionSection = screen.getByRole("heading", { name: "Suggestions pour cet écran" }).closest("section");
    expect(suggestionSection).toBeTruthy();
    const suggestionButtons = within(suggestionSection as HTMLElement).getAllByRole("button");
    expect(suggestionButtons.length).toBeLessThanOrEqual(3);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it("searches locally without calling /api/help", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderHelp();
    await user.click(screen.getByRole("button", { name: "Ouvrir l’aide" }));
    await user.type(screen.getByPlaceholderText("Rechercher dans l’aide"), "classe");
    expect(await screen.findByRole("heading", { name: "Résultats" })).toBeInTheDocument();
    expect(screen.getByText("Consulter les classes")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("finds accent-insensitive search hits", async () => {
    const user = userEvent.setup();
    renderHelp();
    await user.click(screen.getByRole("button", { name: "Ouvrir l’aide" }));
    await user.type(screen.getByPlaceholderText("Rechercher dans l’aide"), "eleve");
    expect(await screen.findByText("Annuaire Élèves")).toBeInTheDocument();
  });

  it("does not show create-class when the session only has Classes:READ", async () => {
    authState.session = {
      accessToken: "token",
      user: { id: "u1", role: "Admin School", permissions: ["Classes:READ"] },
    };
    const user = userEvent.setup();
    renderHelp();
    await user.click(screen.getByRole("button", { name: "Ouvrir l’aide" }));
    expect(screen.getAllByText("Consulter les classes").length).toBeGreaterThan(0);
    expect(screen.queryByText("Créer une classe")).not.toBeInTheDocument();
  });

  it("never shows create-user to a teacher even with Utilisateurs:CREATE injected", async () => {
    authState.session = {
      accessToken: "token",
      user: {
        id: "t1",
        role: "Enseignant",
        permissions: ["Classes:READ", "Élèves:READ", "Présences:READ", "Utilisateurs:CREATE"],
      },
    };
    const user = userEvent.setup();
    renderHelp("/presences");
    await user.click(screen.getByRole("button", { name: "Ouvrir l’aide" }));
    await user.type(screen.getByPlaceholderText("Rechercher dans l’aide"), "utilisateur");
    expect(screen.queryByText("Créer un utilisateur")).not.toBeInTheDocument();
  });

  it("keeps Superadmin away from school operational write procedures", async () => {
    authState.session = {
      accessToken: "token",
      user: {
        id: "sa",
        role: "Super Administrateur Somafrik",
        permissions: ["ALL_PRIVILEGES"],
      },
    };
    const user = userEvent.setup();
    renderHelp("/tableau-de-bord");
    await user.click(screen.getByRole("button", { name: "Ouvrir l’aide" }));
    await user.type(screen.getByPlaceholderText("Rechercher dans l’aide"), "classe");
    expect(screen.queryByText("Créer une classe")).not.toBeInTheDocument();
    expect(screen.queryByText("Créer un utilisateur")).not.toBeInTheDocument();
  });

  it("offers Notes consultation and never the P1 write articles", async () => {
    authState.session = {
      accessToken: "token",
      user: {
        id: "t1",
        role: "Enseignant",
        permissions: ["Notes:READ", "Notes:CREATE", "Notes:UPDATE", "Classes:READ"],
      },
    };
    const user = userEvent.setup();
    renderHelp("/notes");
    await user.click(screen.getByRole("button", { name: "Ouvrir l’aide" }));
    expect(screen.getByText("Notes et évaluations")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Rechercher dans l’aide"), "saisir");
    expect(screen.queryByText("Créer une évaluation")).not.toBeInTheDocument();
    expect(screen.queryByText("Saisir les notes")).not.toBeInTheDocument();
  });

  it("navigates only when navigationIsAllowed and never exposes ACTION labels", async () => {
    const user = userEvent.setup();
    renderHelp();
    await user.click(screen.getByRole("button", { name: "Ouvrir l’aide" }));
    const suggestions = screen.getByRole("heading", { name: "Suggestions pour cet écran" }).closest("section");
    await user.click(within(suggestions as HTMLElement).getByRole("button", { name: /Consulter les classes/ }));
    expect(screen.getByRole("button", { name: "Ouvrir cet écran" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ouvrir cet écran" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/etablissement/classes");
    expect(screen.queryByRole("button", { name: /^(Créer|Modifier|Supprimer|Archiver|Enregistrer|Payer|Valider)$/ })).not.toBeInTheDocument();
  });

  it("does not offer a navigation control when the article has no gated webPath", async () => {
    authState.session = {
      accessToken: "token",
      user: { id: "u1", role: "Admin School", permissions: ["Classes:READ"] },
    };
    const user = userEvent.setup();
    renderHelp("/tableau-de-bord");
    await user.click(screen.getByRole("button", { name: "Ouvrir l’aide" }));
    const suggestions = screen.getByRole("heading", { name: "Suggestions pour cet écran" }).closest("section");
    await user.click(within(suggestions as HTMLElement).getByRole("button", { name: /Tableau de bord/ }));
    expect(screen.getByRole("heading", { name: "Tableau de bord" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ouvrir cet écran" })).not.toBeInTheDocument();
  });
});
