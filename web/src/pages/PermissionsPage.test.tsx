import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const catalog = {
  modules: [{ moduleKey: "students", moduleName: "Élèves", appliesWeb: true, appliesMobile: true }],
  roles: [
    {
      id: "role-prefet",
      roleCode: "PREFET_ETUDES",
      roleName: "Préfet des études",
      scope: "school",
      displayOrder: 1,
      status: "active",
      schoolAssignable: true,
      activeUserCount: 2,
      updatedAt: "2026-08-16T10:00:00.000Z",
    },
  ],
  protectedRoleKeys: ["SUPER_ADMIN"],
};

const patchMock = vi.fn(async () => ({ updatedAt: "2026-08-16T11:00:00.000Z" }));
const getConfiguredMock = vi.fn(async () => ({
  roleKey: "PREFET_ETUDES",
  roleName: "Préfet des études",
  scopeType: "school",
  updatedAt: "2026-08-16T10:00:00.000Z",
  modules: [
    {
      moduleKey: "students",
      moduleName: "Élèves",
      canCreate: false,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    },
  ],
}));

vi.mock("../lib/rbacApi", () => ({
  rbacApi: {
    getCatalog: vi.fn(async () => catalog),
    getConfigured: (...args: unknown[]) => getConfiguredMock(...args),
    patchPermissions: (...args: unknown[]) => patchMock(...args),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    archiveRole: vi.fn(),
  },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { id: "u1", role: "Super Administrateur Somafrik", schoolCode: "*" },
    },
  }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: {
      countries: [{ code: "CD", name: "RDC" }],
      schools: [{ code: "CD-2026-0001", name: "INSTITUT NURU", country: "RDC", countryCode: "CD" }],
    },
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: { role: "Super Administrateur Somafrik" },
    rolePermissions: {},
  }),
}));

vi.mock("../lib/permissions", () => ({
  canManageRolePermissions: () => true,
}));

const showToast = vi.hoisted(() => vi.fn());

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

import { PermissionsPage } from "./PermissionsPage";

describe("PermissionsPage — matrice CRUD Superadmin", () => {
  beforeEach(() => {
    patchMock.mockClear();
    getConfiguredMock.mockClear();
  });

  it("enregistre uniquement le delta CRUD du module sélectionné", async () => {
    render(<PermissionsPage />);
    await screen.findByText("Rôles & permissions");
    fireEvent.change(document.getElementById("rbac-country") as HTMLSelectElement, { target: { value: "CD" } });
    await waitFor(() => {
      const schoolSelect = document.getElementById("rbac-school") as HTMLSelectElement;
      expect(schoolSelect.disabled).toBe(false);
      expect([...schoolSelect.options].some((option) => option.value === "CD-2026-0001")).toBe(true);
    });
    fireEvent.change(document.getElementById("rbac-school") as HTMLSelectElement, {
      target: { value: "CD-2026-0001" },
    });
    await waitFor(() => {
      expect((document.getElementById("rbac-role") as HTMLSelectElement).disabled).toBe(false);
    });
    fireEvent.change(document.getElementById("rbac-role") as HTMLSelectElement, {
      target: { value: "PREFET_ETUDES" },
    });
    await waitFor(() => expect(getConfiguredMock).toHaveBeenCalled());
    fireEvent.change(document.getElementById("rbac-module") as HTMLSelectElement, {
      target: { value: "students" },
    });
    const deleteBox = await screen.findByLabelText("Élèves DELETE");
    fireEvent.click(deleteBox);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    expect(patchMock.mock.calls[0][0].grants).toEqual([
      {
        moduleKey: "students",
        canCreate: false,
        canRead: true,
        canUpdate: true,
        canDelete: false,
      },
    ]);
  });
});
