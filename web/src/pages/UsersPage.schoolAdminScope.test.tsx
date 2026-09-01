import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UsersPage } from "./UsersPage";
import type { UserAccount } from "../types";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: false,
  canUpdate: false,
  canSuspend: false,
}));

const schoolAdmin = vi.hoisted(() => ({
  user: {
    id: "admin-nuru",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    schoolPublicCode: "CD-IN-26-001",
    schoolId: "school-nuru",
    permissions: ["Utilisateurs:READ"],
  },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: { user: schoolAdmin.user, permissions: ["Utilisateurs:READ"] },
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: schoolAdmin.user,
    activeSchoolCode: "CD-2026-0001",
  }),
}));

const dataState = vi.hoisted(() => ({
  users: [] as UserAccount[],
  scopeError: null as string | null,
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: {
      users: dataState.users,
      schools: [],
      countries: [],
      teachers: [],
      rolePermissions: {},
    },
    refresh: vi.fn(),
    error: null,
    scopeError: dataState.scopeError,
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: schoolAdmin.user,
    rolePermissions: {},
  }),
  useFeaturePermissions: () => permissions,
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../components/ui/PromptDialog", () => ({
  usePrompt: () => ({ prompt: vi.fn() }),
}));

vi.mock("../lib/clientsApi", () => ({
  clientsApi: {
    listAssignableRoles: vi.fn(),
    grantUserRole: vi.fn(),
    revokeUserRole: vi.fn(),
    updateUser: vi.fn(),
    createUser: vi.fn(),
    provisionUser: vi.fn(),
  },
}));

describe("UsersPage — SCHOOL_ADMIN périmètre canonique", () => {
  it("A. affiche les comptes renvoyés par l'API malgré leftover session", () => {
    schoolAdmin.user = {
      id: "admin-nuru",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      schoolPublicCode: "CD-IN-26-001",
      schoolId: "school-nuru",
      permissions: ["Utilisateurs:READ"],
    };
    dataState.scopeError = null;
    dataState.users = [
      {
        id: "usr-1",
        firstName: "Amina",
        lastName: "Mwamba",
        publicId: "CD-IN-AMW-26-00001",
        role: "Enseignant",
        schoolCode: "CD-IN-26-001",
        schoolPublicCode: "CD-IN-26-001",
        schoolId: "school-nuru",
        status: "Actif",
      } as UserAccount,
    ];

    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("1 compte(s) accessibles.")).toBeInTheDocument();
    expect(screen.getByText("Amina Mwamba")).toBeInTheDocument();
    expect(screen.queryByText(/Périmètre établissement incomplet/i)).not.toBeInTheDocument();
  });

  it("B. API vide → 0 réel, sans alerte de mismatch", () => {
    schoolAdmin.user = {
      id: "admin-nuru",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      schoolPublicCode: "CD-IN-26-001",
      schoolId: "school-nuru",
      permissions: ["Utilisateurs:READ"],
    };
    dataState.scopeError = null;
    dataState.users = [];

    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("0 compte(s) accessibles.")).toBeInTheDocument();
    expect(screen.queryByText(/Incohérence de périmètre/i)).not.toBeInTheDocument();
  });

  it("E. identité canonique absente → erreur observable, pas « 0 compte(s) accessibles »", () => {
    schoolAdmin.user = {
      id: "admin-nuru",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      schoolPublicCode: "",
      schoolId: "",
      permissions: ["Utilisateurs:READ"],
    };
    dataState.scopeError = null;
    dataState.users = [
      {
        id: "usr-hidden",
        firstName: "Hidden",
        lastName: "User",
        role: "Enseignant",
        schoolCode: "CD-IN-26-001",
        status: "Actif",
      } as UserAccount,
    ];

    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/identité canonique/i)).toBeInTheDocument();
    expect(screen.queryByText("0 compte(s) accessibles.")).not.toBeInTheDocument();
  });
});
