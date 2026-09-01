import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { useCallback, useState } from "react";
import type { SchoolStudent } from "../../lib/studentsApi";

const SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const permissions = vi.hoisted(() => ({ canRead: true, canCreate: true, canUpdate: true, canDelete: true }));
const store = vi.hoisted(() => ({
  students: [] as SchoolStudent[],
}));
const archiveMock = vi.hoisted(() =>
  vi.fn(async (studentCode: string) => {
    store.students = store.students.filter((row) => row.studentCode !== studentCode);
    return { status: "archived" };
  }),
);
const listMock = vi.hoisted(() => vi.fn(async () => store.students));

function fixtureStudents(): SchoolStudent[] {
  return [
    {
      id: "CD-IN-DA-26-00001", publicId: "CD-IN-DA-26-00001", studentCode: "CD-IN-DA-26-00001",
      matricule: "CD-IN-DA-26-00001", loginCode: "CD-IN-DA-26-00001", identifier: "CD-IN-DA-26-00001",
      firstName: "Awa", lastName: "Diop", name: "Awa Diop", gender: "Féminin", birthDate: "12-04-2012",
      className: "6ème A", classCode: "CLS-1", schoolId: SCHOOL_ID, schoolCode: "CD-IN-26-001",
      parentPhone: "", parentEmail: "",
      status: "active", enrollmentId: "enr-1", enrollmentDate: "01-09-2025", academicYearName: "2025-2026",
    },
    {
      id: "CD-IN-FI-26-00002", publicId: "CD-IN-FI-26-00002", studentCode: "CD-IN-FI-26-00002",
      matricule: "CD-IN-FI-26-00002", loginCode: "CD-IN-FI-26-00002", identifier: "CD-IN-FI-26-00002",
      firstName: "Ibrahima", lastName: "Fall", name: "Ibrahima Fall", gender: "Masculin", birthDate: "01-01-2011",
      className: "5ème B", classCode: "CLS-2", schoolId: SCHOOL_ID, schoolCode: "CD-IN-26-001",
      parentPhone: "", parentEmail: "",
      status: "active", enrollmentId: "enr-2", enrollmentDate: "01-09-2025", academicYearName: "2025-2026",
    },
  ];
}

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "u1",
        role: "Admin School",
        schoolCode: "CD-2026-0001",
        schoolPublicCode: "CD-IN-26-001",
        schoolId: SCHOOL_ID,
        name: "Admin",
      },
    },
  }),
}));
vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: {
      id: "u1",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      schoolPublicCode: "CD-IN-26-001",
      schoolId: SCHOOL_ID,
    },
    activeSchoolCode: "CD-2026-0001",
  }),
}));
vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: { role: "Admin School", schoolCode: "CD-2026-0001", schoolId: SCHOOL_ID },
  }),
}));
vi.mock("../../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/permissions")>();
  return { ...actual, getEntityFeaturePermissions: () => ({ ...permissions }) };
});
vi.mock("../../lib/studentsApi", () => ({
  studentsApi: { list: listMock, get: vi.fn(), update: vi.fn(), archive: archiveMock },
}));
vi.mock("../../context/DataContext", () => ({
  useData: () => {
    const [students, setStudents] = useState(store.students);
    const refresh = useCallback(async () => {
      const next = await listMock();
      store.students = Array.isArray(next) ? next : [];
      setStudents(store.students);
    }, []);
    return {
      state: { students, schools: [], users: [], teachers: [], classes: [], assignments: [], rolePermissions: {} },
      refresh,
      loading: false,
      error: null,
      scopeError: null,
    };
  },
}));

import { StudentsListPage } from "./StudentsListPage";

function renderPage() {
  return render(<MemoryRouter><StudentsListPage /></MemoryRouter>);
}

describe("StudentsListPage — snapshot DataContext et archivage", () => {
  beforeEach(() => {
    permissions.canRead = true; permissions.canCreate = true; permissions.canUpdate = true; permissions.canDelete = true;
    store.students = fixtureStudents();
    listMock.mockImplementation(async () => store.students);
    listMock.mockClear(); archiveMock.mockClear();
  });

  it("affiche l'annuaire depuis le snapshot DataContext canonique", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 2, name: "Élèves" })).toBeInTheDocument();
    expect(await screen.findByText("Diop")).toBeInTheDocument();
    expect(screen.getByText("Fall")).toBeInTheDocument();
  });

  it("n'expose aucun bouton Ajouter ni Modifier", async () => {
    renderPage(); await screen.findByText("Diop");
    expect(screen.queryByRole("button", { name: "Ajouter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Dossier" }).length).toBe(2);
  });

  it("lie le dossier via le matricule général", async () => {
    renderPage(); await screen.findByText("Diop");
    expect(screen.getAllByRole("link", { name: "Dossier" })[0]).toHaveAttribute(
      "href",
      "/etablissement/eleves/CD-IN-DA-26-00001",
    );
  });

  it("filtre la liste en local sans persistance locale", async () => {
    const user = userEvent.setup(); renderPage(); await screen.findByText("Diop");
    await user.type(screen.getByRole("searchbox", { name: /Rechercher dans élèves/i }), "Diop");
    expect(screen.getByText("Diop")).toBeInTheDocument();
    expect(screen.queryByText("Fall")).not.toBeInTheDocument();
  });

  it("affiche Forbidden si lecture refusée", () => {
    permissions.canRead = false; renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Accès non autorisé");
  });

  it("masque Archiver sans droit delete", async () => {
    permissions.canDelete = false; renderPage(); await screen.findByText("Diop");
    expect(screen.queryByRole("button", { name: "Archiver" })).not.toBeInTheDocument();
  });

  it("archive via le backend puis converge DataContext", async () => {
    const user = userEvent.setup(); renderPage(); await screen.findByText("Diop");
    await user.click(screen.getAllByRole("button", { name: "Archiver" })[0]);
    expect(archiveMock).toHaveBeenCalledWith("CD-IN-DA-26-00001");
    expect(listMock).toHaveBeenCalled();
    expect(screen.queryByText("Diop")).not.toBeInTheDocument();
  });

  it("Actualiser recharge le domaine students du DataContext", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Diop");
    await user.click(screen.getByRole("button", { name: "Actualiser" }));
    expect(listMock).toHaveBeenCalled();
  });
});
