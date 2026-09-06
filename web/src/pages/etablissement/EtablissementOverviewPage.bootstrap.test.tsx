import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionUser } from "../../types";
import { SCHOOL_ADMIN_ROLE } from "../../lib/orgHierarchy";
import { getInternalRoleDefaults } from "../../lib/internalRoleDefaults";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOGIN_A = "CD-IN-26-001";
const LEFTOVER_A = "CD-2026-0001";

const store = vi.hoisted(() => ({
  students: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  classes: [] as Record<string, unknown>[],
  teachers: [] as Record<string, unknown>[],
  assignments: [] as Record<string, unknown>[],
  relations: [] as Record<string, unknown>[],
}));

const asyncState = vi.hoisted(() => ({
  assignmentsPromise: null as Promise<unknown> | null,
}));

const apiGetMock = vi.hoisted(() =>
  vi.fn(async (path: string): Promise<unknown> => {
    void path;
    return [];
  }),
);
const apiDeleteMock = vi.hoisted(() =>
  vi.fn(async (path: string): Promise<{ status: string }> => {
    void path;
    return { status: "archived" };
  }),
);

const schoolAdminUser = {
  id: "admin-nuru",
  firstName: "Admin",
  lastName: "Nuru",
  role: SCHOOL_ADMIN_ROLE,
  schoolCode: LEFTOVER_A,
  schoolPublicCode: LOGIN_A,
  schoolId: SCHOOL_ID_A,
  identifier: "admin-nuru",
  permissions: getInternalRoleDefaults(SCHOOL_ADMIN_ROLE),
} as SessionUser;

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: schoolAdminUser,
      accessToken: "test-access-token",
      scope: { label: "Établissement", hint: LEFTOVER_A },
      permissions: schoolAdminUser.permissions,
    },
    permissionsReady: true,
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: schoolAdminUser,
    activeSchoolCode: LEFTOVER_A,
    isSuperAdmin: false,
    ready: true,
  }),
}));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getAccessToken: () => "test-access-token",
    api: {
      ...actual.api,
      get: (...args: unknown[]) => apiGetMock(...(args as [string])),
      delete: (...args: unknown[]) => apiDeleteMock(...(args as [string])),
    },
  };
});

import { DataProvider } from "../../context/DataContext";
import { DomainRouteBootstrap } from "../../components/DomainRouteBootstrap";
import { EtablissementOverviewPage } from "./EtablissementOverviewPage";
import { StudentsListPage } from "./StudentsListPage";

function pgStudent(index: number, overrides: Record<string, unknown> = {}) {
  const seq = String(index + 1).padStart(5, "0");
  return {
    id: `CD-IN-EL-26-${seq}`,
    publicId: `CD-IN-EL-26-${seq}`,
    studentCode: `CD-IN-EL-26-${seq}`,
    matricule: `CD-IN-EL-26-${seq}`,
    loginCode: `CD-IN-EL-26-${seq}`,
    identifier: `CD-IN-EL-26-${seq}`,
    firstName: `Prenom${index + 1}`,
    lastName: `Nom${index + 1}`,
    name: `Prenom${index + 1} Nom${index + 1}`,
    gender: "Masculin",
    birthDate: "01-01-2012",
    className: "6ème A",
    classCode: "CLS-1",
    schoolId: SCHOOL_ID_A,
    schoolCode: LOGIN_A,
    schoolPublicCode: LOGIN_A,
    parentPhone: "",
    parentEmail: "",
    status: "active",
    enrollmentId: `enr-${index + 1}`,
    enrollmentDate: "01-09-2025",
    academicYearName: "2025-2026",
    ...overrides,
  };
}

function seedFifteen() {
  store.students = Array.from({ length: 15 }, (_, index) => pgStudent(index));
  store.classes = [{ id: "cls-1", name: "6ème A", classCode: "CLS-1", schoolCode: LEFTOVER_A, schoolId: SCHOOL_ID_A }];
  store.users = [];
  store.teachers = [];
  store.assignments = [];
  store.relations = [];
}

function studentGetCalls(): number {
  return apiGetMock.mock.calls.filter(([path]) => String(path) === "/students").length;
}

function tileCount(label: string): string {
  const heading = screen.getByRole("heading", { name: label });
  const link = heading.closest("a");
  return link?.querySelector(".text-3xl")?.textContent?.trim() ?? "";
}

function renderEstablishmentTree(initialPath: string) {
  return render(
    <DataProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <DomainRouteBootstrap />
        <nav>
          <Link to="/etablissement/vue-ensemble">Aller vue-ensemble</Link>
          <Link to="/etablissement/eleves">Aller eleves</Link>
        </nav>
        <Routes>
          <Route path="/etablissement/vue-ensemble" element={<EtablissementOverviewPage />} />
          <Route path="/etablissement/eleves" element={<StudentsListPage />} />
        </Routes>
      </MemoryRouter>
    </DataProvider>,
  );
}

describe("EtablissementOverviewPage — bootstrap DataProvider + DomainRouteBootstrap", () => {
  beforeEach(() => {
    localStorage.clear();
    apiGetMock.mockReset();
    apiDeleteMock.mockReset();
    asyncState.assignmentsPromise = null;
    seedFifteen();
    apiGetMock.mockImplementation(async (path: string) => {
      const url = String(path);
      if (url === "/students") return store.students;
      if (url === "/backoffice/users") return store.users;
      if (url === "/classes") return store.classes;
      if (url === "/teachers") return store.teachers;
      if (url === "/assignments") {
        return asyncState.assignmentsPromise ?? store.assignments;
      }
      if (url === "/backoffice/relations") return store.relations;
      if (url.startsWith("/backoffice/establishments/")) {
        return {
          id: SCHOOL_ID_A,
          code: LEFTOVER_A,
          schoolCode: LEFTOVER_A,
          schoolId: SCHOOL_ID_A,
          name: "Complexe Scolaire Nuru",
        };
      }
      return [];
    });
    apiDeleteMock.mockImplementation(async (path: string) => {
      const studentCode = decodeURIComponent(String(path).replace(/^\/students\//, ""));
      store.students = store.students.filter((row) => String(row.studentCode) !== studentCode);
      return { status: "archived" };
    });
  });

  it("hard reload direct /etablissement/vue-ensemble → GET /students → tuile 15", async () => {
    const first = renderEstablishmentTree("/etablissement/vue-ensemble");

    await waitFor(() => {
      expect(studentGetCalls()).toBeGreaterThanOrEqual(1);
      expect(tileCount("Élèves")).toBe("15");
    });

    const callsAfterFirstMount = studentGetCalls();
    first.unmount();

    renderEstablishmentTree("/etablissement/vue-ensemble");

    await waitFor(() => {
      expect(studentGetCalls()).toBeGreaterThan(callsAfterFirstMount);
      expect(tileCount("Élèves")).toBe("15");
    });
  });

  it("connexion à froid : attend assignments avant KPI/alertes et ne rend jamais de fausse alerte", async () => {
    let resolveAssignments: (value: unknown) => void = () => undefined;
    asyncState.assignmentsPromise = new Promise((resolve) => {
      resolveAssignments = resolve;
    });
    store.teachers = [
      {
        id: "teacher-kilombo",
        publicId: "ENS-0001",
        identifier: "ENS-0001",
        firstName: "KILOMBO",
        lastName: "SEKE",
        name: "KILOMBO SEKE",
        schoolCode: LEFTOVER_A,
        schoolId: SCHOOL_ID_A,
      },
    ];
    store.assignments = [
      {
        id: "assignment-1",
        teacherId: "teacher-kilombo",
        teacherName: "KILOMBO SEKE",
        className: "6ème A",
        schoolCode: LEFTOVER_A,
        schoolId: SCHOOL_ID_A,
      },
    ];

    renderEstablishmentTree("/etablissement/vue-ensemble");

    expect(await screen.findByText("Chargement des données de l’établissement…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Enseignants" })).not.toBeInTheDocument();
    expect(screen.queryByText(/enseignant\(s\) sans affectation/i)).not.toBeInTheDocument();
    expect(apiGetMock).toHaveBeenCalledWith("/assignments");

    resolveAssignments(store.assignments);

    await waitFor(() => {
      expect(tileCount("Enseignants")).toBe("1");
      expect(screen.getByText("Aucune alerte. Les données sont cohérentes.")).toBeInTheDocument();
    });
    expect(screen.queryByText(/enseignant\(s\) sans affectation/i)).not.toBeInTheDocument();
  });

  it("archive + refresh students → N−1 sur l'annuaire et la vue d'ensemble", async () => {
    const user = userEvent.setup();
    renderEstablishmentTree("/etablissement/vue-ensemble");

    await waitFor(() => {
      expect(tileCount("Élèves")).toBe("15");
    });

    const elevesTile = screen.getByRole("heading", { name: "Élèves" }).closest("a");
    expect(elevesTile).toHaveAttribute("href", "/etablissement/eleves");
    fireEvent.click(elevesTile!);
    expect(await screen.findByText("Nom1")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Dossier" })).toHaveLength(15);

    await user.click(screen.getAllByRole("button", { name: "Archiver" })[0]);
    expect(apiDeleteMock).toHaveBeenCalledWith("/students/CD-IN-EL-26-00001");

    await waitFor(() => {
      expect(screen.queryByText("Nom1")).not.toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: "Dossier" })).toHaveLength(14);
    });

    fireEvent.click(screen.getByRole("link", { name: "Aller vue-ensemble" }));
    await waitFor(() => {
      expect(tileCount("Élèves")).toBe("14");
    });
  });
});
