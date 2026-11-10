import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UsersPage } from "./UsersPage";
import type { UserAccount } from "../types";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canSuspend: false,
}));

const showToast = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
const prompt = vi.hoisted(() => vi.fn());
const resetUserAccountPassword = vi.hoisted(() => vi.fn());

const existingUser = {
  id: "usr-reset-aline",
  firstName: "Aline",
  lastName: "Reset",
  publicId: "CD-IB-ALN-26-00001",
  identifier: "CD-IB-ALN-26-00001",
  role: "Admin School",
  roles: ["Admin School"],
  roleKeys: ["SCHOOL_ADMIN"],
  countryScope: "RDC",
  schoolCode: "CD-2026-0001",
  schoolPublicCode: "CD-IB-26-002",
  schoolName: "Institut Bukavu",
  status: "Actif",
  email: "aline.reset@test.local",
  mustChangePassword: false,
  hasTemporaryPassword: false,
} as UserAccount;

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "super-1",
        role: "Super Administrateur Somafrik",
        schoolCode: "*",
        identifier: "SUPER-ADMIN",
        permissions: ["Utilisateurs:READ", "Utilisateurs:UPDATE"],
      },
      permissions: ["Utilisateurs:READ", "Utilisateurs:UPDATE"],
    },
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: {
      id: "super-1",
      role: "Super Administrateur Somafrik",
      schoolCode: "*",
    },
    activeSchoolCode: "CD-2026-0001",
  }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: {
      users: [existingUser],
      schools: [{ code: "CD-2026-0001", name: "Institut Bukavu", country: "RDC", countryCode: "CD" }],
      countries: [{ code: "CD", name: "République démocratique du Congo" }],
      teachers: [],
      rolePermissions: {},
    },
    refresh,
    ensureDomains: vi.fn(async () => undefined),
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: { role: "Super Administrateur Somafrik", schoolCode: "*", permissions: ["Utilisateurs:UPDATE"] },
    rolePermissions: {},
  }),
  useFeaturePermissions: () => permissions,
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../components/ui/PromptDialog", () => ({
  usePrompt: () => ({ prompt }),
}));

vi.mock("../lib/userAccounts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/userAccounts")>();
  return {
    ...actual,
    resetUserAccountPassword,
  };
});

vi.mock("../lib/clientsApi", () => ({
  clientsApi: {
    listAssignableRoles: vi.fn(),
    grantUserRole: vi.fn(),
    revokeUserRole: vi.fn(),
    updateUser: vi.fn(),
    createUser: vi.fn(),
    provisionUser: vi.fn(),
    reassignUserSchool: vi.fn(),
  },
  buildCreateUserPayload: (payload: Record<string, unknown>) => payload,
}));

describe("UsersPage — reset password rehydrate", () => {
  beforeEach(() => {
    showToast.mockReset();
    refresh.mockReset();
    refresh.mockResolvedValue(undefined);
    prompt.mockReset();
    prompt.mockResolvedValue("Soma1234");
    resetUserAccountPassword.mockReset();
    resetUserAccountPassword.mockResolvedValue("Soma1234");
  });

  it("U04 reset : persisté puis refresh users", async () => {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("Aline Reset"));
    fireEvent.click(screen.getByRole("button", { name: "Réinitialiser le mot de passe" }));

    await waitFor(() => expect(resetUserAccountPassword).toHaveBeenCalledWith(expect.objectContaining({ id: existingUser.id }), "Soma1234"));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith(["users"]));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Soma1234"), "success");
  });
});
