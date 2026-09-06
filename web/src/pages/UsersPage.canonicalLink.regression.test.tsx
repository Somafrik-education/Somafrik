import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    listUsers: vi.fn(),
    listContacts: vi.fn(),
    listRelations: vi.fn(),
    listMessages: vi.fn(),
    listAnnouncements: vi.fn(),
    listAssignableRoles: vi.fn(),
    grantUserRole: vi.fn(),
    revokeUserRole: vi.fn(),
    updateUser: vi.fn(),
    createUser: vi.fn(),
    provisionUser: vi.fn(),
  },
}));

const CODE_A = "CD-ITS-MR-26-00099";
const CODE_B = "CD-ITS-MR-26-00003";
const S1 = "22222222-2222-4222-8222-222222222222";

const divergedLinked: UserAccount = {
  id: "usr-student-div",
  firstName: "Marc",
  lastName: "Rumba",
  publicId: CODE_A,
  identifier: CODE_A,
  role: "",
  assignmentStatus: "",
  roles: [],
  roleKeys: [],
  accountKind: "student_login",
  businessProfileLabel: "Compte lié à un élève",
  linkedStudent: { studentId: S1, studentCode: CODE_B, status: "active" },
  schoolCode: "CD-IN-26-001",
  schoolPublicCode: "CD-IN-26-001",
  schoolId: "school-nuru",
  status: "Actif",
};

describe("W5 — GET /users → UsersPage codes divergents", () => {
  it("UsersPage : Type métier élève, Identifiant = CODE-A, Profil élève = CODE-B", async () => {
    schoolAdmin.user = {
      id: "admin-nuru",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      schoolPublicCode: "CD-IN-26-001",
      schoolId: "school-nuru",
      permissions: ["Utilisateurs:READ"],
    };
    dataState.scopeError = null;
    dataState.users = [divergedLinked];

    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Marc Rumba")).toBeInTheDocument();
    expect(screen.getAllByText("Compte lié à un élève").length).toBeGreaterThan(0);
    expect(screen.getAllByText(CODE_A).length).toBeGreaterThan(0);
    expect(screen.queryByText("Sans affectation")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Marc Rumba"));
    expect(screen.getByText("Profil élève")).toBeInTheDocument();
    expect(screen.getByText(CODE_B)).toBeInTheDocument();
    expect(screen.getAllByText("Identifiant").length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog")).toHaveTextContent(CODE_A);
    expect(screen.getByRole("dialog")).toHaveTextContent(CODE_B);
    expect(screen.getByRole("dialog")).toHaveTextContent("Compte lié à un élève");
    expect(screen.getByRole("dialog")).toHaveTextContent("Élève / Étudiant");
    expect(screen.getByRole("dialog")).toHaveTextContent("Verrouillés — profil élève");
  });

  it("P0 : Attribuer masqué, rôles verrouillés", async () => {
    permissions.canRead = true;
    permissions.canUpdate = true;
    schoolAdmin.user = {
      id: "admin-nuru",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      schoolPublicCode: "CD-IN-26-001",
      schoolId: "school-nuru",
      permissions: ["Utilisateurs:READ", "Utilisateurs:UPDATE"],
    };
    dataState.scopeError = null;
    dataState.users = [divergedLinked];

    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Attribuer" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Verrouillés — profil élève").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Élève / Étudiant").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Modifier" }));
    const editor = screen.getByRole("dialog", { name: /Modifier l'utilisateur/i });
    expect(editor).toHaveTextContent("Type métier");
    expect(within(editor).getByDisplayValue("Compte lié à un élève")).toBeInTheDocument();
    expect(editor).toHaveTextContent("Rôle d'accès");
    expect(within(editor).getByDisplayValue("Élève / Étudiant")).toBeInTheDocument();
    expect(within(editor).getByDisplayValue("Verrouillés — profil élève")).toBeInTheDocument();
    expect(editor).toHaveTextContent("Les rôles d'un compte lié à un élève ne peuvent pas être modifiés.");
    expect(within(editor).queryByText("Sans affectation (plus tard)")).not.toBeInTheDocument();
    await userEvent.click(within(editor).getByRole("button", { name: "Fermer" }));

    await userEvent.click(screen.getByText("Marc Rumba"));
    const detail = screen.getByRole("dialog", { name: /Marc Rumba/i });
    expect(detail).toHaveTextContent("Type métier");
    expect(detail).toHaveTextContent("Compte lié à un élève");
    expect(detail).toHaveTextContent("Rôle d'accès");
    expect(detail).toHaveTextContent("Élève / Étudiant");
    expect(detail).toHaveTextContent("Verrouillés — profil élève");
    expect(within(detail).queryByRole("button", { name: "Attribuer" })).not.toBeInTheDocument();
  });
});
