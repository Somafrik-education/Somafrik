import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UsersPage } from "./UsersPage";
import type { UserAccount } from "../types";

const SCHOOL_ID_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID_B = "22222222-2222-4222-8222-222222222222";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: false,
  canUpdate: false,
  canSuspend: false,
}));

const dataState = vi.hoisted(() => ({
  users: [] as UserAccount[],
  error: null as string | null,
  usersScopeTrace: null as { error?: string | null } | null,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "admin-a",
        role: "Admin School",
        schoolCode: "CD-2026-0001",
        schoolId: SCHOOL_ID_A,
        schoolPublicCode: "CD-IN-26-001",
        permissions: ["Utilisateurs:READ"],
      },
      permissions: ["Utilisateurs:READ"],
    },
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: {
      id: "admin-a",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      schoolId: SCHOOL_ID_A,
      schoolPublicCode: "CD-IN-26-001",
    },
    activeSchoolCode: "CD-IN-26-001",
  }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: {
      users: dataState.users,
      schools: [
        {
          id: SCHOOL_ID_A,
          code: "CD-IN-26-001",
          loginCode: "CD-IN-26-001",
          name: "Institut Nuru",
          city: "Kinshasa",
        },
      ],
      countries: [],
      teachers: [],
      rolePermissions: {},
    },
    refresh: vi.fn(),
    error: dataState.error,
    usersScopeTrace: dataState.usersScopeTrace,
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: {
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      schoolId: SCHOOL_ID_A,
      schoolPublicCode: "CD-IN-26-001",
      permissions: ["Utilisateurs:READ"],
    },
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

function renderPage() {
  return render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  );
}

describe("UsersPage — SCHOOL_ADMIN préprod-like", () => {
  it("A — affiche les comptes renvoyés par l'API malgré leftover JWT", () => {
    dataState.error = null;
    dataState.users = [
      {
        id: "usr-1",
        firstName: "Ada",
        lastName: "Lovelace",
        role: "Secrétaire",
        status: "Actif",
        schoolCode: "CD-IN-26-001",
        schoolId: SCHOOL_ID_A,
        schoolPublicCode: "CD-IN-26-001",
      },
    ];
    renderPage();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("1 compte(s) accessibles.")).toBeInTheDocument();
    expect(screen.queryByText("0 compte(s) accessibles.")).not.toBeInTheDocument();
  });

  it("B — API vide → 0 réel", () => {
    dataState.error = null;
    dataState.users = [];
    renderPage();
    expect(screen.getByText("0 compte(s) accessibles.")).toBeInTheDocument();
    expect(screen.queryByText("Identité établissement canonique absente")).not.toBeInTheDocument();
  });

  it("C — autre école invisible", () => {
    dataState.error = null;
    dataState.users = [
      {
        id: "usr-b",
        firstName: "Foreign",
        lastName: "Tenant",
        role: "Secrétaire",
        status: "Actif",
        schoolCode: "BI-BUJ-26-001",
        schoolId: SCHOOL_ID_B,
        schoolPublicCode: "BI-BUJ-26-001",
      },
    ];
    renderPage();
    expect(screen.queryByText("Foreign Tenant")).not.toBeInTheDocument();
    expect(screen.queryByText("0 compte(s) accessibles.")).not.toBeInTheDocument();
    expect(screen.getByText(/Incohérence de périmètre établissement/i)).toBeInTheDocument();
  });
});
