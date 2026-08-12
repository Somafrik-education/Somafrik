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

const listMock = vi.hoisted(() =>
  vi.fn(async () => [
    {
      id: "ELE-SCH-001-000001",
      publicId: "ELE-SCH-001-000001",
      studentCode: "ELE-SCH-001-000001",
      matricule: "ELE-SCH-001-000001",
      firstName: "Awa",
      lastName: "Diop",
      name: "Awa Diop",
      gender: "Féminin",
      birthDate: "12-04-2012",
      className: "6ème A",
      classCode: "CLS-1",
      schoolCode: "SCH-001",
      parentPhone: "",
      parentEmail: "",
      status: "active",
      enrollmentId: "enr-1",
      enrollmentDate: "01-09-2025",
      academicYearName: "2025-2026",
    },
    {
      id: "ELE-SCH-001-000002",
      publicId: "ELE-SCH-001-000002",
      studentCode: "ELE-SCH-001-000002",
      matricule: "ELE-SCH-001-000002",
      firstName: "Ibrahima",
      lastName: "Fall",
      name: "Ibrahima Fall",
      gender: "Masculin",
      birthDate: "01-01-2011",
      className: "5ème B",
      classCode: "CLS-2",
      schoolCode: "SCH-001",
      parentPhone: "",
      parentEmail: "",
      status: "active",
      enrollmentId: "enr-2",
      enrollmentDate: "01-09-2025",
      academicYearName: "2025-2026",
    },
  ]),
);

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

vi.mock("../../lib/studentsApi", () => ({
  studentsApi: {
    list: listMock,
    get: vi.fn(),
    update: vi.fn(),
  },
}));

import { StudentsListPage } from "./StudentsListPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <StudentsListPage />
    </MemoryRouter>,
  );
}

describe("StudentsListPage — annuaire PostgreSQL lecture seule", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    listMock.mockClear();
  });

  it("rend le chrome liste et charge via /api/students", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 2, name: "Élèves" })).toBeInTheDocument();
    expect(await screen.findByText("Diop")).toBeInTheDocument();
    expect(screen.getByText("Fall")).toBeInTheDocument();
    expect(listMock).toHaveBeenCalled();
  });

  it("n'expose aucun bouton Ajouter / Ajouter depuis un contact / Modifier", async () => {
    renderPage();
    await screen.findByText("Diop");
    expect(screen.queryByRole("button", { name: "Ajouter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ajouter depuis un contact/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Dossier" }).length).toBe(2);
  });

  it("lie le dossier via studentCode", async () => {
    renderPage();
    await screen.findByText("Diop");
    const link = screen.getAllByRole("link", { name: "Dossier" })[0];
    expect(link).toHaveAttribute("href", "/etablissement/eleves/ELE-SCH-001-000001");
  });

  it("filtre la liste en local", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Diop");
    const search = screen.getByRole("searchbox", { name: /Rechercher dans élèves/i });
    await user.type(search, "Diop");
    expect(screen.getByText("Diop")).toBeInTheDocument();
    expect(screen.queryByText("Fall")).not.toBeInTheDocument();
  });

  it("affiche Forbidden si lecture refusée", () => {
    permissions.canRead = false;
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Accès non autorisé");
  });

  it("affiche EmptyState si liste vide", async () => {
    listMock.mockResolvedValueOnce([]);
    renderPage();
    expect(await screen.findByText("Liste vide")).toBeInTheDocument();
  });
});
