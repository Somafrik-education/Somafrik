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
    classes: [
      {
        id: "cls-1",
        name: "6ème A",
        level: "6ème",
        track: "Général",
        status: "Active",
        schoolCode: "SCH-001",
      },
      {
        id: "cls-2",
        name: "5ème B",
        level: "5ème",
        track: "Général",
        status: "Active",
        schoolCode: "SCH-001",
      },
    ],
    students: [
      { id: "s1", className: "6ème A", schoolCode: "SCH-001" },
      { id: "s2", className: "6ème A", schoolCode: "SCH-001" },
    ],
    teachers: [],
    assignments: [],
    courses: [],
    contacts: [],
    relations: [],
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
      if (key === "students") {
        return { canRead: true, canCreate: true, canUpdate: true, canDelete: false };
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

import { ClassesListPage } from "./ClassesListPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <ClassesListPage />
    </MemoryRouter>,
  );
}

describe("ClassesListPage (D3.2b — consommation D2.7)", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    permissions.canDelete = true;
    dataState.current = {
      ...dataState.current,
      classes: [
        {
          id: "cls-1",
          name: "6ème A",
          level: "6ème",
          track: "Général",
          status: "Active",
          schoolCode: "SCH-001",
        },
        {
          id: "cls-2",
          name: "5ème B",
          level: "5ème",
          track: "Général",
          status: "Active",
          schoolCode: "SCH-001",
        },
      ],
      students: [
        { id: "s1", className: "6ème A", schoolCode: "SCH-001" },
        { id: "s2", className: "6ème A", schoolCode: "SCH-001" },
      ],
    };
  });

  it("rend le chrome D2.7 (ListLayout / EntityListShell) pour Classes", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 2, name: "Classes" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtres et recherche")).toBeInTheDocument();
    expect(screen.getByLabelText("Liste")).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: /Rechercher dans classes/i }),
    ).toBeInTheDocument();
  });

  it("affiche le tableau nominal avec colonnes et actions existantes", () => {
    renderPage();

    const list = screen.getByLabelText("Liste");
    expect(within(list).getByRole("columnheader", { name: /Nom/i })).toBeInTheDocument();
    expect(within(list).getByText("6ème A")).toBeInTheDocument();
    expect(within(list).getByText("5ème B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Élèves" }).length).toBeGreaterThan(0);
  });

  it("filtre la liste via EntityListSearch sans changer les données source", async () => {
    const user = userEvent.setup();
    renderPage();

    const search = screen.getByRole("searchbox", { name: /Rechercher dans classes/i });
    await user.type(search, "6ème");

    expect(screen.getByText("6ème A")).toBeInTheDocument();
    expect(screen.queryByText("5ème B")).not.toBeInTheDocument();
  });

  it("affiche EmptyState DS lorsque la liste est vide", () => {
    // scopedClasses synthétise aussi des classes depuis les élèves — vider les deux.
    dataState.current = { ...dataState.current, classes: [], students: [] };
    renderPage();

    const empty = screen.getByRole("status");
    expect(empty).toHaveTextContent("Aucune classe");
    expect(empty).toHaveTextContent("Aucune classe à afficher pour cet établissement.");
  });

  it("affiche ForbiddenState (EntityListForbidden) si accès refusé", () => {
    permissions.canRead = false;
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Accès non autorisé");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Vous n'avez pas l'autorisation de consulter classes.",
    );
    expect(screen.queryByRole("heading", { name: "Classes" })).not.toBeInTheDocument();
  });

  it("conserve les actions secondaires d’export", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Exporter CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exporter Excel" })).toBeInTheDocument();
  });
});
