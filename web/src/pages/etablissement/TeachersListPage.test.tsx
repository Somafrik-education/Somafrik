import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
}));

const dataState = vi.hoisted(() => ({
  current: {
    schools: [{ code: "SCH-001", name: "Lycée Test" }],
    classes: [],
    students: [],
    teachers: [
      {
        id: "t1",
        name: "Ndiaye",
        firstName: "Aïssatou",
        publicId: "SN-2026-0001-ENS-0001",
        specialty: "Mathématiques",
        schoolCode: "SCH-001",
      },
      {
        id: "t2",
        name: "Ba",
        firstName: "Moussa",
        publicId: "SN-2026-0001-ENS-0002",
        specialty: "Français",
        schoolCode: "SCH-001",
      },
    ],
    assignments: [],
    courses: [],
    contacts: [],
    relations: [],
    users: [],
    academicConfigBySchool: {},
    auditLog: [],
  } as Record<string, unknown>,
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "u1",
        role: "Admin School",
        schoolCode: "SCH-001",
        name: "Admin",
      },
    },
  }),
}));

vi.mock("../../context/DataContext", () => ({
  useData: () => ({
    state: dataState.current,
    loading: false,
    error: null,
    update: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: "SCH-001",
    scopedUser: {
      id: "u1",
      role: "Admin School",
      schoolCode: "SCH-001",
      name: "Admin",
    },
  }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: { role: "Admin School", schoolCode: "SCH-001" } }),
}));

vi.mock("../../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    getEntityFeaturePermissions: (_ctx: unknown, key: string) => {
      if (key === "assignments") {
        return { canRead: true, canCreate: true, canUpdate: true, canDelete: false };
      }
      if (key === "students") {
        return { canRead: true, canCreate: false, canUpdate: false, canDelete: false };
      }
      return { ...permissions };
    },
  };
});

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));

vi.mock("../../components/ui/PromptDialog", () => ({
  usePrompt: () => ({ prompt: vi.fn() }),
}));

vi.mock("../../components/ui/PrintButton", () => ({
  PrintButton: () => <button type="button">Imprimer</button>,
}));

import { TeachersListPage } from "./TeachersListPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <TeachersListPage />
    </MemoryRouter>,
  );
}

describe("TeachersListPage (D3.3 — consommation D2.7)", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    permissions.canDelete = true;
    dataState.current = {
      ...dataState.current,
      teachers: [
        {
          id: "t1",
          name: "Ndiaye",
          firstName: "Aïssatou",
          publicId: "SN-2026-0001-ENS-0001",
          specialty: "Mathématiques",
          schoolCode: "SCH-001",
        },
        {
          id: "t2",
          name: "Ba",
          firstName: "Moussa",
          publicId: "SN-2026-0001-ENS-0002",
          specialty: "Français",
          schoolCode: "SCH-001",
        },
      ],
    };
  });

  it("rend le chrome D2.7 (ListLayout / EntityListShell) pour Enseignants", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 2, name: "Enseignants" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtres et recherche")).toBeInTheDocument();
    expect(screen.getByLabelText("Liste")).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: /Rechercher dans enseignants/i }),
    ).toBeInTheDocument();
  });

  it("affiche le tableau nominal avec colonnes et actions existantes", () => {
    renderPage();

    const list = screen.getByLabelText("Liste");
    expect(within(list).getByText("Ndiaye")).toBeInTheDocument();
    expect(within(list).getByText("Ba")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Modifier" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Supprimer" }).length).toBeGreaterThan(0);
  });

  it("filtre la liste via EntityListSearch sans changer les données source", async () => {
    const user = userEvent.setup();
    renderPage();

    const search = screen.getByRole("searchbox", { name: /Rechercher dans enseignants/i });
    await user.type(search, "Ndiaye");

    expect(screen.getByText("Ndiaye")).toBeInTheDocument();
    expect(screen.queryByText("Ba")).not.toBeInTheDocument();
  });

  it("affiche EmptyState DS lorsque la liste est vide", () => {
    dataState.current = { ...dataState.current, teachers: [] };
    renderPage();

    const empty = screen.getByRole("status");
    expect(empty).toHaveTextContent("Liste vide");
    expect(empty).toHaveTextContent("Aucun élément à afficher dans enseignants.");
  });

  it("affiche ForbiddenState (EntityListForbidden) si accès refusé", () => {
    permissions.canRead = false;
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Accès non autorisé");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Vous n'avez pas l'autorisation de consulter enseignants.",
    );
    expect(screen.queryByRole("heading", { name: "Enseignants" })).not.toBeInTheDocument();
  });

  it("conserve les actions secondaires d’export", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Exporter CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exporter Excel" })).toBeInTheDocument();
  });
});
