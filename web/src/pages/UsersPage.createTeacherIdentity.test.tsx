import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UsersPage } from "./UsersPage";
import { clientsApi } from "../lib/clientsApi";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canSuspend: false,
}));

const showToast = vi.hoisted(() => vi.fn());

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "admin-nuru",
        role: "Admin School",
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
      users: [],
      schools: [{ code: "CD-2026-0001", name: "INSTITUT NURU", country: "RDC", countryCode: "CD" }],
      countries: [{ code: "CD", name: "République démocratique du Congo" }],
      teachers: [],
      rolePermissions: {},
      academicConfigs: {},
    },
    refresh: vi.fn(async () => undefined),
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
  useToast: () => ({ showToast }),
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

describe("UsersPage — création Enseignant canonique (PARITY-028)", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    showToast.mockReset();
    vi.mocked(clientsApi.createUser).mockReset();
    vi.mocked(clientsApi.grantUserRole).mockReset();
    vi.mocked(clientsApi.provisionUser).mockReset();
    vi.mocked(clientsApi.createTeacherIdentity).mockReset();
    vi.mocked(clientsApi.createTeacherIdentity).mockResolvedValue({
      user: { id: "usr-ens-1", roleKeys: ["TEACHER"] },
      credentials: { login: "USR-2026-00099", temporarySecret: "TempPass12" },
    });
    sessionStorage.setItem("somafrik.activeSchoolCode", "CD-2026-0001");
  });

  function openCreateForm() {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nouvel utilisateur" }));
  }

  it("Enseignant → createTeacherIdentity, jamais createUser+grant ni POST /teachers", async () => {
    openCreateForm();
    fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: "Awa" } });
    fireEvent.change(screen.getByLabelText(/^Nom/i), { target: { value: "Ndiaye" } });
    fireEvent.change(screen.getByLabelText(/^Rôle/i), { target: { value: "Enseignant" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(clientsApi.createTeacherIdentity).toHaveBeenCalledTimes(1));
    expect(clientsApi.createTeacherIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Awa",
        lastName: "Ndiaye",
        schoolCode: "CD-2026-0001",
        temporaryPassword: expect.any(String),
      }),
    );
    expect(clientsApi.createUser).not.toHaveBeenCalled();
    expect(clientsApi.grantUserRole).not.toHaveBeenCalled();
    expect(clientsApi.provisionUser).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringMatching(/USR-2026-00099.*TempPass12|TempPass12.*USR-2026-00099/),
      "success",
    );
  });

  it("Préfet des études reste createUser + grant (hors contrat enseignant)", async () => {
    vi.mocked(clientsApi.createUser).mockResolvedValue({
      id: "usr-prefet-1",
      temporaryPassword: "PrefetPass12",
    });
    openCreateForm();
    fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: "Jean" } });
    fireEvent.change(screen.getByLabelText(/^Nom/i), { target: { value: "Kimwemwe" } });
    fireEvent.change(screen.getByLabelText(/^Rôle/i), { target: { value: "Préfet des études" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(clientsApi.createUser).toHaveBeenCalledTimes(1));
    expect(clientsApi.grantUserRole).toHaveBeenCalledWith("usr-prefet-1", "Préfet des études");
    expect(clientsApi.createTeacherIdentity).not.toHaveBeenCalled();
  });
});
