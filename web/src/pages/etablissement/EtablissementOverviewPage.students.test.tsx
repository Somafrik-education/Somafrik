import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BackOfficeState, SessionUser, UserAccount } from "../../types";
import { SCHOOL_ADMIN_ROLE } from "../../lib/orgHierarchy";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOGIN_A = "CD-IN-26-001";
const LEFTOVER_A = "CD-2026-0001";

const schoolAdmin = vi.hoisted(() => ({
  user: {
    id: "admin-nuru",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    schoolPublicCode: "CD-IN-26-001",
    schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    permissions: [
      "Utilisateurs:READ",
      "Classes:READ",
      "Élèves:READ",
      "Enseignants:READ",
      "Relations:READ",
    ],
  } as SessionUser,
}));

const dataState = vi.hoisted(() => ({
  students: [] as Record<string, unknown>[],
  users: [] as UserAccount[],
  teachers: [] as Record<string, unknown>[],
  classes: [] as Record<string, unknown>[],
  relations: [] as Record<string, unknown>[],
  assignments: [] as Record<string, unknown>[],
  scopeError: null as string | null,
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ session: { user: schoolAdmin.user, permissions: schoolAdmin.user.permissions } }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: schoolAdmin.user,
    activeSchoolCode: schoolAdmin.user.schoolCode,
  }),
}));

vi.mock("../../context/DataContext", () => ({
  useData: () => ({
    state: {
      students: dataState.students,
      users: dataState.users,
      teachers: dataState.teachers,
      classes: dataState.classes,
      relations: dataState.relations,
      assignments: dataState.assignments,
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
    refresh: vi.fn(),
    error: null,
    scopeError: dataState.scopeError,
    loading: false,
  }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: schoolAdmin.user,
    rolePermissions: {
      "Admin School": [
        "Utilisateurs:READ",
        "Classes:READ",
        "Élèves:READ",
        "Enseignants:READ",
        "Relations:READ",
      ],
    },
  }),
}));

vi.mock("../../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/permissions")>();
  return { ...actual, canReadView: () => true };
});

import { EtablissementOverviewPage } from "./EtablissementOverviewPage";

function pgStudent(index: number, overrides: Record<string, unknown> = {}) {
  const seq = String(index + 1).padStart(5, "0");
  return {
    id: `CD-IN-EL-26-${seq}`,
    publicId: `CD-IN-EL-26-${seq}`,
    studentCode: `CD-IN-EL-26-${seq}`,
    matricule: `CD-IN-EL-26-${seq}`,
    firstName: `Prenom${index + 1}`,
    lastName: `Nom${index + 1}`,
    name: `Prenom${index + 1} Nom${index + 1}`,
    className: "6ème A",
    schoolId: SCHOOL_ID_A,
    schoolCode: LOGIN_A,
    schoolPublicCode: LOGIN_A,
    status: "active",
    ...overrides,
  };
}

function tileCount(label: string): string {
  const heading = screen.getByRole("heading", { name: label });
  const link = heading.closest("a");
  expect(link).toBeTruthy();
  const count = link?.querySelector(".text-3xl")?.textContent?.trim();
  expect(count).toBeTruthy();
  return count ?? "";
}

describe("EtablissementOverviewPage — payload PostgreSQL réel-like", () => {
  it("8. GET /students 15 (login_code V2 + schoolId) → tuile Élèves = 15 malgré leftover JWT", () => {
    schoolAdmin.user = {
      ...schoolAdmin.user,
      role: SCHOOL_ADMIN_ROLE,
      schoolCode: LEFTOVER_A,
      schoolPublicCode: LOGIN_A,
      schoolId: SCHOOL_ID_A,
    };
    dataState.scopeError = null;
    dataState.students = Array.from({ length: 15 }, (_, index) => pgStudent(index));
    dataState.users = [];
    dataState.teachers = [];
    dataState.classes = [{ id: "cls-1", name: "6ème A", schoolCode: LEFTOVER_A }];
    dataState.relations = [];

    render(
      <MemoryRouter>
        <EtablissementOverviewPage />
      </MemoryRouter>,
    );

    expect(tileCount("Élèves")).toBe("15");
    expect(screen.queryByText(/Périmètre établissement incomplet/i)).not.toBeInTheDocument();
  });

  it("6. SCHOOL_ADMIN A → aucun élève B dans la tuile", () => {
    schoolAdmin.user = {
      ...schoolAdmin.user,
      schoolId: SCHOOL_ID_A,
      schoolCode: LEFTOVER_A,
      schoolPublicCode: LOGIN_A,
    };
    dataState.scopeError = null;
    dataState.students = [
      pgStudent(0, { schoolId: SCHOOL_ID_B, schoolCode: "BI-EC-26-001", schoolPublicCode: "BI-EC-26-001" }),
    ];

    render(
      <MemoryRouter>
        <EtablissementOverviewPage />
      </MemoryRouter>,
    );

    expect(tileCount("Élèves")).toBe("0");
    expect(screen.getByText(/autre établissement/i)).toBeInTheDocument();
  });

  it("payload mixte : 14 élèves affichés + alerte scopeError (ligne sans schoolId déjà filtrée du state)", () => {
    schoolAdmin.user = {
      ...schoolAdmin.user,
      schoolId: SCHOOL_ID_A,
      schoolCode: LEFTOVER_A,
      schoolPublicCode: LOGIN_A,
    };
    dataState.students = Array.from({ length: 14 }, (_, index) => pgStudent(index));
    dataState.scopeError =
      "Incohérence de périmètre : des élèves n'ont pas l'identité canonique schoolId. Ces lignes sont masquées.";

    render(
      <MemoryRouter>
        <EtablissementOverviewPage />
      </MemoryRouter>,
    );

    expect(tileCount("Élèves")).toBe("14");
    expect(screen.getByText(/identité canonique schoolId/i)).toBeInTheDocument();
  });
});
