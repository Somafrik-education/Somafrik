import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
}));

const classesApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

const apiGetMock = vi.hoisted(() => vi.fn());
const academicYearsApiMock = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn() }));

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
    getEntityFeaturePermissions: () => ({ ...permissions }),
  };
});

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../lib/classesApi", () => ({
  classesApi: classesApiMock,
}));

vi.mock("../../lib/academicYearsApi", () => ({ academicYearsApi: academicYearsApiMock }));

vi.mock("../../api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  api: {
    get: apiGetMock,
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

import { ClassesListPage } from "./ClassesListPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <ClassesListPage />
    </MemoryRouter>,
  );
}

describe("ClassesListPage (CRUD /api/classes)", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    permissions.canDelete = true;
    classesApiMock.list.mockResolvedValue([
      {
        id: "CLS-1",
        publicId: "CLS-1",
        classCode: "CLS-1",
        name: "6ème A",
        level: "6ème",
        section: "A",
        track: "A",
        status: "active",
        schoolCode: "SCH-001",
        academicYearId: "ay-1",
        academicYearName: "2025-2026",
        schoolYear: "2025-2026",
        students: 2,
      },
      {
        id: "CLS-2",
        publicId: "CLS-2",
        classCode: "CLS-2",
        name: "5ème B",
        level: "5ème",
        section: "B",
        track: "B",
        status: "active",
        schoolCode: "SCH-001",
        academicYearId: "ay-1",
        academicYearName: "2025-2026",
        schoolYear: "2025-2026",
        students: 0,
      },
    ]);
    classesApiMock.create.mockReset();
    classesApiMock.update.mockReset();
    academicYearsApiMock.list.mockResolvedValue([{ id: "ay-1", name: "2025-2026", schoolCode: "SCH-001", isCurrent: true }]);
    academicYearsApiMock.create.mockReset();
    academicYearsApiMock.update.mockReset();
  });

  it("rend le chrome D2.7 et les classes chargées depuis l'API", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 2, name: "Classes" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtres et recherche")).toBeInTheDocument();
    expect(screen.getByLabelText("Liste")).toBeInTheDocument();
    expect(await screen.findByText("6ème A")).toBeInTheDocument();
    expect(screen.getByText("5ème B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeInTheDocument();
  });

  it("filtre la liste via EntityListSearch", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("6ème A");
    const search = screen.getByRole("searchbox", { name: /Rechercher dans classes/i });
    await user.type(search, "6ème");
    expect(screen.getByText("6ème A")).toBeInTheDocument();
    expect(screen.queryByText("5ème B")).not.toBeInTheDocument();
  });

  it("affiche EmptyState lorsque l'API renvoie une liste vide", async () => {
    classesApiMock.list.mockResolvedValueOnce([]);
    renderPage();
    const empty = await screen.findByRole("status");
    expect(empty).toHaveTextContent("Liste vide");
    expect(empty).toHaveTextContent("Aucun élément à afficher dans classes.");
  });

  it("affiche ForbiddenState si accès refusé", () => {
    permissions.canRead = false;
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Accès non autorisé");
    expect(screen.queryByRole("heading", { name: "Classes" })).not.toBeInTheDocument();
  });

  it("crée une classe via POST /api/classes", async () => {
    const user = userEvent.setup();
    classesApiMock.create.mockResolvedValue({
      id: "CLS-NEW",
      publicId: "CLS-NEW",
      classCode: "CLS-NEW",
      name: "4ème C",
      level: "4ème",
      section: "C",
      track: "C",
      status: "active",
      schoolCode: "SCH-001",
      academicYearId: "ay-1",
      academicYearName: "2025-2026",
      schoolYear: "2025-2026",
      students: 0,
    });

    renderPage();
    await screen.findByText("6ème A");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    await user.type(screen.getByLabelText(/Nom de classe/i), "4ème C");
    await user.selectOptions(screen.getByLabelText(/Année scolaire/i), "2025-2026");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      expect(classesApiMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "4ème C",
          academicYearName: "2025-2026",
          status: "active",
        }),
      );
    });
    expect(await screen.findByText("4ème C")).toBeInTheDocument();
  });

  it("oriente vers Paramètres quand aucune année n'est configurée", async () => {
    const user = userEvent.setup();
    academicYearsApiMock.list.mockResolvedValueOnce([]);
    renderPage();
    await screen.findByText("6ème A");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByText(/Aucune année scolaire n'est configurée/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Créer cette année scolaire" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Paramètres → Année scolaire/ })).toHaveAttribute(
      "href",
      "/parametres/annee-scolaire",
    );
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(academicYearsApiMock.create).not.toHaveBeenCalled();
  });
});
