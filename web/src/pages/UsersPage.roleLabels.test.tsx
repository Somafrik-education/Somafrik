import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UsersPage } from "./UsersPage";
import { clientsApi } from "../lib/clientsApi";
import { rbacApi } from "../lib/rbacApi";
import type { UserAccount } from "../types";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canSuspend: false,
}));

const dataState = vi.hoisted(() => ({
  users: [] as UserAccount[],
  refresh: vi.fn(async () => undefined),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "admin-nuru",
        role: "Admin School",
        roleKey: "SCHOOL_ADMIN",
        roleKeys: ["SCHOOL_ADMIN"],
        schoolCode: "CD-2026-0001",
        schoolPublicCode: "CD-IN-26-001",
        schoolId: "school-nuru",
        identifier: "admin-nuru",
        permissions: ["Utilisateurs:READ", "Utilisateurs:CREATE", "Utilisateurs:UPDATE"],
      },
      permissions: ["Utilisateurs:READ", "Utilisateurs:CREATE", "Utilisateurs:UPDATE"],
    },
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: {
      id: "admin-nuru",
      role: "Admin School",
      roleKey: "SCHOOL_ADMIN",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "CD-2026-0001",
      schoolPublicCode: "CD-IN-26-001",
      schoolId: "school-nuru",
    },
    activeSchoolCode: "CD-2026-0001",
  }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: {
      get users() {
        return dataState.users;
      },
      schools: [{ code: "CD-2026-0001", name: "INSTITUT NURU", country: "RDC", countryCode: "CD" }],
      countries: [{ code: "CD", name: "République démocratique du Congo" }],
      teachers: [],
      rolePermissions: {},
      academicConfigs: {},
    },
    refresh: dataState.refresh,
    ensureDomains: vi.fn(async () => undefined),
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: {
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      permissions: ["Utilisateurs:CREATE", "Utilisateurs:UPDATE"],
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
    createTeacherIdentity: vi.fn(),
  },
  buildCreateUserPayload: (payload: Record<string, unknown>) => payload,
}));

vi.mock("../lib/rbacApi", () => ({
  rbacApi: {
    listRoleDisplayLabels: vi.fn(),
  },
}));

const catalog = {
  items: [
    { roleKey: "TEACHER", defaultLabel: "Enseignant", displayLabel: "Professeur", effectiveLabel: "Professeur" },
    { roleKey: "SCHOOL_ADMIN", defaultLabel: "Admin School", displayLabel: "Directeur", effectiveLabel: "Directeur" },
    { roleKey: "STUDENT", defaultLabel: "Élève / Étudiant", displayLabel: "Étudiant", effectiveLabel: "Étudiant" },
    { roleKey: "PRINCIPAL", defaultLabel: "Directeur", displayLabel: "Directeur", effectiveLabel: "Directeur" },
    { roleKey: "PREFET_ETUDES", defaultLabel: "Préfet des études", displayLabel: null, effectiveLabel: "Préfet des études" },
  ],
};

describe("UsersPage ROLE-LABELS-WEB-01", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    dataState.users = [
      {
        id: "usr-teacher",
        firstName: "Awa",
        lastName: "Ndiaye",
        publicId: "USR-1",
        role: "Enseignant",
        roleKey: "TEACHER",
        roleKeys: ["TEACHER"],
        effectiveRoleLabel: "Professeur",
        status: "Actif",
        schoolCode: "CD-2026-0001",
        schoolPublicCode: "CD-IN-26-001",
        schoolId: "school-nuru",
      },
      {
        id: "usr-admin",
        firstName: "Grace",
        lastName: "Mwamba",
        publicId: "USR-2",
        role: "Admin School",
        roleKey: "SCHOOL_ADMIN",
        roleKeys: ["SCHOOL_ADMIN"],
        effectiveRoleLabel: "Directeur",
        status: "Actif",
        schoolCode: "CD-2026-0001",
        schoolPublicCode: "CD-IN-26-001",
        schoolId: "school-nuru",
      },
      {
        id: "usr-student",
        firstName: "Marc",
        lastName: "Rumba",
        publicId: "USR-3",
        role: "Élève / Étudiant",
        roleKey: "STUDENT",
        roleKeys: ["STUDENT"],
        effectiveRoleLabel: "Étudiant",
        accountKind: "student_login",
        status: "Actif",
        schoolCode: "CD-2026-0001",
        schoolPublicCode: "CD-IN-26-001",
        schoolId: "school-nuru",
      },
    ];
    vi.mocked(rbacApi.listRoleDisplayLabels).mockResolvedValue(catalog);
    vi.mocked(clientsApi.listAssignableRoles).mockResolvedValue({
      roles: [
        { roleKey: "TEACHER", roleName: "Enseignant" },
        { roleKey: "SCHOOL_ADMIN", roleName: "Admin School" },
        { roleKey: "PRINCIPAL", roleName: "Directeur" },
      ],
    });
    vi.mocked(clientsApi.grantUserRole).mockReset();
    vi.mocked(clientsApi.revokeUserRole).mockReset();
    vi.mocked(clientsApi.createTeacherIdentity).mockReset();
    vi.mocked(clientsApi.createTeacherIdentity).mockResolvedValue({
      user: { id: "usr-ens-1", roleKeys: ["TEACHER"] },
      credentials: { login: "USR-2026-00099", temporarySecret: "TempPass12" },
    });
  });

  function renderPage() {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );
  }

  it("affiche les labels effectifs et filtre par roleKey SCHOOL_ADMIN", async () => {
    renderPage();
    expect(await screen.findByText("Professeur")).toBeInTheDocument();
    expect(screen.getByText("Directeur")).toBeInTheDocument();
    expect(screen.getByText("Étudiant")).toBeInTheDocument();

    const roleFilter = await screen.findByLabelText("Filtrer par rôle");
    await waitFor(() => expect(within(roleFilter).getByRole("option", { name: "Directeur" })).toHaveValue("SCHOOL_ADMIN"));
    fireEvent.change(roleFilter, { target: { value: "SCHOOL_ADMIN" } });
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.queryByText("Awa")).not.toBeInTheDocument();
  });

  it("création : option Professeur value TEACHER", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Nouvel utilisateur" }));
    const roleSelect = await screen.findByLabelText(/^Rôle/i);
    await waitFor(() => expect(within(roleSelect).getByRole("option", { name: "Professeur" })).toBeInTheDocument());
    const professor = within(roleSelect).getByRole("option", { name: "Professeur" });
    expect(professor).toHaveValue("TEACHER");
    fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: "Awa" } });
    fireEvent.change(screen.getByLabelText(/^Nom/i), { target: { value: "Ndiaye" } });
    fireEvent.change(roleSelect, { target: { value: "TEACHER" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(clientsApi.createTeacherIdentity).toHaveBeenCalledTimes(1));
    expect(clientsApi.grantUserRole).not.toHaveBeenCalled();
  });

  it("attribution : Directeur value SCHOOL_ADMIN, grant envoie Admin School", async () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "Attribuer" })[0]);
    const checkboxes = await screen.findAllByRole("checkbox");
    const schoolAdminBox = checkboxes.find((box) => (box as HTMLInputElement).value === "SCHOOL_ADMIN");
    const principalBox = checkboxes.find((box) => (box as HTMLInputElement).value === "PRINCIPAL");
    expect(schoolAdminBox).toBeTruthy();
    expect(principalBox).toBeTruthy();
    expect(schoolAdminBox).toHaveValue("SCHOOL_ADMIN");
    expect(principalBox).toHaveValue("PRINCIPAL");
    fireEvent.click(schoolAdminBox!);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(clientsApi.grantUserRole).toHaveBeenCalled());
    expect(clientsApi.grantUserRole).toHaveBeenCalledWith("usr-teacher", "Admin School");
    expect(clientsApi.grantUserRole).not.toHaveBeenCalledWith("usr-teacher", "Directeur");
  });
});
