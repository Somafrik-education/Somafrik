import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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
      { id: "cls-1", name: "6ème A", schoolCode: "SCH-001" },
      { id: "cls-2", name: "5ème B", schoolCode: "SCH-001" },
    ],
    students: [
      {
        id: "stu-1",
        name: "Diop",
        firstName: "Awa",
        matricule: "MAT-001",
        className: "6ème A",
        schoolStatus: "Inscrit",
        schoolCode: "SCH-001",
      },
      {
        id: "stu-2",
        name: "Fall",
        firstName: "Ibrahima",
        matricule: "MAT-002",
        className: "5ème B",
        schoolStatus: "Inscrit",
        schoolCode: "SCH-001",
      },
    ],
    teachers: [],
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

import { ClassStudentsPage } from "./ClassStudentsPage";

function renderPage(className = "6ème A") {
  const encoded = encodeURIComponent(className);
  return render(
    <MemoryRouter initialEntries={[`/etablissement/classes/${encoded}/eleves`]}>
      <Routes>
        <Route path="/etablissement/classes" element={<div>Liste classes</div>} />
        <Route
          path="/etablissement/classes/:className/eleves"
          element={<ClassStudentsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ClassStudentsPage (D3.2c — membres / conso D2.7)", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    permissions.canDelete = true;
    dataState.current = {
      ...dataState.current,
      students: [
        {
          id: "stu-1",
          name: "Diop",
          firstName: "Awa",
          matricule: "MAT-001",
          className: "6ème A",
          schoolStatus: "Inscrit",
          schoolCode: "SCH-001",
        },
        {
          id: "stu-2",
          name: "Fall",
          firstName: "Ibrahima",
          matricule: "MAT-002",
          className: "5ème B",
          schoolStatus: "Inscrit",
          schoolCode: "SCH-001",
        },
      ],
    };
  });

  it("rend le chrome D2.7 (ListLayout) avec titre de classe et orientation", () => {
    renderPage("6ème A");

    expect(screen.getByRole("heading", { level: 2, name: "Élèves — 6ème A" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Orientation" })).toHaveTextContent(
      "← Retour aux classes",
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtres et recherche")).toBeInTheDocument();
    expect(screen.getByLabelText("Liste")).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: /Rechercher dans élèves/i }),
    ).toBeInTheDocument();
  });

  it("affiche uniquement les élèves de la classe (classScope)", () => {
    renderPage("6ème A");

    const list = screen.getByLabelText("Liste");
    expect(within(list).getByText("Diop")).toBeInTheDocument();
    expect(within(list).queryByText("Fall")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Dossier" }).length).toBeGreaterThan(0);
  });

  it("filtre via EntityListSearch dans le périmètre de la classe", async () => {
    dataState.current = {
      ...dataState.current,
      students: [
        {
          id: "stu-1",
          name: "Diop",
          firstName: "Awa",
          matricule: "MAT-001",
          className: "6ème A",
          schoolStatus: "Inscrit",
          schoolCode: "SCH-001",
        },
        {
          id: "stu-3",
          name: "Sow",
          firstName: "Fatou",
          matricule: "MAT-003",
          className: "6ème A",
          schoolStatus: "Inscrit",
          schoolCode: "SCH-001",
        },
      ],
    };
    const user = userEvent.setup();
    renderPage("6ème A");

    const search = screen.getByRole("searchbox", { name: /Rechercher dans élèves/i });
    await user.type(search, "Diop");

    expect(screen.getByText("Diop")).toBeInTheDocument();
    expect(screen.queryByText("Sow")).not.toBeInTheDocument();
  });

  it("affiche EmptyState DS lorsque la classe n’a aucun élève", () => {
    dataState.current = {
      ...dataState.current,
      students: [
        {
          id: "stu-2",
          name: "Fall",
          firstName: "Ibrahima",
          matricule: "MAT-002",
          className: "5ème B",
          schoolStatus: "Inscrit",
          schoolCode: "SCH-001",
        },
      ],
    };
    renderPage("6ème A");

    const empty = screen.getByRole("status");
    expect(empty).toHaveTextContent("Liste vide");
    expect(empty).toHaveTextContent("Aucun élément à afficher dans élèves.");
  });

  it("affiche ForbiddenState si accès élèves refusé", () => {
    permissions.canRead = false;
    renderPage("6ème A");

    expect(screen.getByRole("status")).toHaveTextContent("Accès non autorisé");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Vous n'avez pas l'autorisation de consulter élèves.",
    );
    expect(screen.queryByRole("heading", { name: /Élèves —/ })).not.toBeInTheDocument();
  });

  it("conserve les actions secondaires d’export", () => {
    renderPage("6ème A");
    expect(screen.getByRole("button", { name: "Exporter CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exporter Excel" })).toBeInTheDocument();
  });

  it("redirige vers la liste Classes si className vide", () => {
    render(
      <MemoryRouter initialEntries={["/etablissement/classes/%20/eleves"]}>
        <Routes>
          <Route path="/etablissement/classes" element={<div>Liste classes</div>} />
          <Route
            path="/etablissement/classes/:className/eleves"
            element={<ClassStudentsPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Liste classes")).toBeInTheDocument();
  });
});
