import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { useCallback, useState } from "react";
import type { BackOfficeState, SessionUser, UserAccount } from "../../types";
import type { SchoolStudent } from "../../lib/studentsApi";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOGIN_A = "CD-IN-26-001";
const LEFTOVER_A = "CD-2026-0001";

function pgStudent(index: number, overrides: Partial<SchoolStudent> = {}): SchoolStudent {
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

const store = vi.hoisted(() => ({
  students: [] as SchoolStudent[],
  users: [] as UserAccount[],
  teachers: [] as Record<string, unknown>[],
  classes: [] as Record<string, unknown>[],
  relations: [] as Record<string, unknown>[],
  assignments: [] as Record<string, unknown>[],
  scopeError: null as string | null,
  user: {
    id: "admin-nuru",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    schoolPublicCode: "CD-IN-26-001",
    schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    permissions: ["Élèves:READ", "Élèves:DELETE", "Utilisateurs:READ", "Classes:READ", "Enseignants:READ", "Relations:READ"],
  } as SessionUser,
}));

const listMock = vi.hoisted(() => vi.fn(async () => store.students));
const archiveMock = vi.hoisted(() =>
  vi.fn(async (studentCode: string) => {
    store.students = store.students.filter((row) => row.studentCode !== studentCode);
    return { status: "archived" };
  }),
);
const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ session: { user: store.user, permissions: store.user.permissions } }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: store.user,
    activeSchoolCode: store.user.schoolCode,
  }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: store.user,
    rolePermissions: { "Admin School": store.user.permissions },
  }),
}));

vi.mock("../../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    canReadView: () => true,
    getEntityFeaturePermissions: () => ({ ...permissions }),
  };
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
      state: {
        students,
        users: store.users,
        teachers: store.teachers,
        classes: store.classes,
        relations: store.relations,
        assignments: store.assignments,
        schools: [],
        countries: [],
        contacts: [],
        subscriptions: [],
        notifications: [],
        payments: [],
        studentFees: [],
        presences: [],
        notes: [],
        rolePermissions: {},
      } as unknown as BackOfficeState,
      refresh,
      loading: false,
      error: null,
      scopeError: store.scopeError,
      ensureDomains: vi.fn(),
      invalidateDomains: vi.fn(),
    };
  },
}));

import { StudentsListPage } from "./StudentsListPage";
import { EtablissementOverviewPage } from "./EtablissementOverviewPage";

function tileCount(label: string): string {
  const heading = screen.getByRole("heading", { name: label });
  const link = heading.closest("a");
  return link?.querySelector(".text-3xl")?.textContent?.trim() ?? "";
}

function seedFifteen() {
  store.students = Array.from({ length: 15 }, (_, index) => pgStudent(index));
  store.classes = [{ id: "cls-1", name: "6ème A", schoolCode: LEFTOVER_A, schoolId: SCHOOL_ID_A }];
  store.users = [];
  store.teachers = [];
  store.relations = [];
  store.scopeError = null;
  listMock.mockImplementation(async () => store.students);
}

describe("convergence canonique Élèves — annuaire + vue d'ensemble", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canDelete = true;
    archiveMock.mockClear();
    listMock.mockClear();
    seedFifteen();
  });

  it("1. GET /students 15 → annuaire=15 et vue d'ensemble=15", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <StudentsListPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Nom1")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Dossier" })).toHaveLength(15);
    unmount();

    render(
      <MemoryRouter>
        <EtablissementOverviewPage />
      </MemoryRouter>,
    );
    expect(tileCount("Élèves")).toBe("15");
  });

  it("2. Actualiser l'annuaire recharge le snapshot DataContext", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <StudentsListPage />
      </MemoryRouter>,
    );
    await screen.findByText("Nom1");
    store.students = store.students.slice(0, 12);
    await user.click(screen.getByRole("button", { name: "Actualiser" }));
    expect(listMock).toHaveBeenCalled();
    expect(screen.getAllByRole("link", { name: "Dossier" })).toHaveLength(12);
  });

  it("3. Archivage → annuaire N-1 et vue d'ensemble N-1 après refresh", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter>
        <StudentsListPage />
      </MemoryRouter>,
    );
    await screen.findByText("Nom1");
    await user.click(screen.getAllByRole("button", { name: "Archiver" })[0]);
    expect(archiveMock).toHaveBeenCalledWith("CD-IN-EL-26-00001");
    expect(screen.queryByText("Nom1")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Dossier" })).toHaveLength(14);
    unmount();

    render(
      <MemoryRouter>
        <EtablissementOverviewPage />
      </MemoryRouter>,
    );
    expect(tileCount("Élèves")).toBe("14");
  });

  it("4. Navigation vue-ensemble → élèves → vue-ensemble conserve le même nombre", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/etablissement/vue-ensemble"]}>
        <Link to="/etablissement/vue-ensemble">Aller vue-ensemble</Link>
        <Routes>
          <Route path="/etablissement/vue-ensemble" element={<EtablissementOverviewPage />} />
          <Route path="/etablissement/eleves" element={<StudentsListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(tileCount("Élèves")).toBe("15");
    await user.click(screen.getByRole("link", { name: /Élèves/ }));
    expect(await screen.findByText("Nom1")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Dossier" })).toHaveLength(15);
    await user.click(screen.getByRole("link", { name: "Aller vue-ensemble" }));
    expect(tileCount("Élèves")).toBe("15");
  });

  it("5. Remount page seule (useData mocké) n'est pas un hard reload — voir EtablissementOverviewPage.bootstrap.test.tsx", () => {
    const { unmount } = render(
      <MemoryRouter>
        <EtablissementOverviewPage />
      </MemoryRouter>,
    );
    expect(tileCount("Élèves")).toBe("15");
    unmount();
    render(
      <MemoryRouter>
        <EtablissementOverviewPage />
      </MemoryRouter>,
    );
    expect(tileCount("Élèves")).toBe("15");
    expect(listMock).not.toHaveBeenCalled();
  });
});
