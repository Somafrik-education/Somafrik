import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  RbacCatalog,
  RbacConfiguredMatrix,
  RbacConfiguredQuery,
  RbacCrudGrant,
  RbacPatchPermissionsPayload,
} from "../lib/rbacApi";

const { catalog, patchMock, getConfiguredMock } = vi.hoisted(() => {
  const catalog: RbacCatalog = {
    modules: [
      {
        moduleKey: "students",
        moduleName: "Élèves",
        appliesWeb: true,
        appliesMobile: true,
        actions: ["create", "read", "update", "delete"],
        dependencies: { create: ["read"], update: ["read"], delete: ["read"] },
      },
      {
        moduleKey: "users",
        moduleName: "Utilisateurs",
        appliesWeb: true,
        appliesMobile: true,
        actions: ["create", "read", "update", "delete"],
        dependencies: { create: ["read"], update: ["read"], delete: ["read"] },
      },
    ],
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
      {
        id: "role-super",
        roleCode: "SUPER_ADMIN",
        roleName: "Super Administrateur Somafrik",
        scope: "platform",
        displayOrder: 0,
        status: "active",
        schoolAssignable: false,
        activeUserCount: 1,
        updatedAt: "2026-08-16T10:00:00.000Z",
      },
    ],
    protectedRoleKeys: ["SUPER_ADMIN"],
    mandatoryByRole: {
      SUPER_ADMIN: {
        users: { create: true, read: true, update: true, delete: true },
      },
      SCHOOL_ADMIN: {},
      COUNTRY_ADMIN: {},
    },
  };
  const getConfiguredMock = vi.fn(async (query: RbacConfiguredQuery): Promise<RbacConfiguredMatrix> => {
    if (query.roleKey === "SUPER_ADMIN") {
      return {
        roleKey: "SUPER_ADMIN",
        roleName: "Super Administrateur Somafrik",
        scopeType: "school",
        updatedAt: "2026-08-16T10:00:00.000Z",
        modules: [
          {
            moduleKey: "users",
            moduleName: "Utilisateurs",
            appliesWeb: true,
            appliesMobile: true,
            canCreate: true,
            canRead: true,
            canUpdate: true,
            canDelete: true,
          },
        ],
      };
    }
    return {
      roleKey: "PREFET_ETUDES",
      roleName: "Préfet des études",
      scopeType: "school",
      updatedAt: "2026-08-16T10:00:00.000Z",
      modules: [
        {
          moduleKey: "students",
          moduleName: "Élèves",
          appliesWeb: true,
          appliesMobile: true,
          canCreate: false,
          canRead: true,
          canUpdate: true,
          canDelete: true,
        },
      ],
    };
  });
  const patchMock = vi.fn(async (payload: RbacPatchPermissionsPayload) => {
    void payload;
    return { updatedAt: "2026-08-16T11:00:00.000Z" };
  });
  return { catalog, patchMock, getConfiguredMock };
});

vi.mock("../lib/rbacApi", () => ({
  rbacApi: {
    getCatalog: vi.fn(async (): Promise<RbacCatalog> => catalog),
    getConfigured: (query: RbacConfiguredQuery) => getConfiguredMock(query),
    patchPermissions: (payload: RbacPatchPermissionsPayload) => patchMock(payload),
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

const expectedGrant: RbacCrudGrant = {
  moduleKey: "students",
  canCreate: false,
  canRead: true,
  canUpdate: true,
  canDelete: false,
};

async function selectPath(roleKey: string, moduleKey: string) {
  render(<PermissionsPage />);
  await screen.findByText("Rôles et droits");
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
    target: { value: roleKey },
  });
  await waitFor(() => expect(getConfiguredMock).toHaveBeenCalled());
  fireEvent.change(document.getElementById("rbac-module") as HTMLSelectElement, {
    target: { value: moduleKey },
  });
}

describe("PermissionsPage — matrice CRUD Superadmin", () => {
  beforeEach(() => {
    patchMock.mockClear();
    getConfiguredMock.mockClear();
  });

  it("enregistre uniquement le delta CRUD du module sélectionné", async () => {
    await selectPath("PREFET_ETUDES", "students");
    const deleteBox = await screen.findByLabelText("Élèves Suppression");
    fireEvent.click(deleteBox);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    expect(patchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roleKey: "PREFET_ETUDES",
        countryCode: "CD",
        schoolCode: "CD-2026-0001",
        grants: [expectedGrant],
      }),
    );
  });

  it("verrouille READ tant que UPDATE/DELETE sont actifs (dépendance)", async () => {
    await selectPath("PREFET_ETUDES", "students");
    const readBox = await screen.findByLabelText("Élèves Lecture");
    expect(readBox).toBeChecked();
    expect(readBox).toBeDisabled();
    fireEvent.click(readBox);
    expect(readBox).toBeChecked();
  });

  it("cocher CREATE force et verrouille READ", async () => {
    await selectPath("PREFET_ETUDES", "students");
    const createBox = await screen.findByLabelText("Élèves Création");
    const readBox = await screen.findByLabelText("Élèves Lecture");
    expect(createBox).not.toBeDisabled();
    fireEvent.click(createBox);
    expect(createBox).toBeChecked();
    expect(readBox).toBeChecked();
    expect(readBox).toBeDisabled();
  });

  it("SUPER_ADMIN Utilisateurs : cases obligatoires checked + disabled", async () => {
    await selectPath("SUPER_ADMIN", "users");
    for (const action of ["Création", "Lecture", "Modification", "Suppression"]) {
      const box = await screen.findByLabelText(`Utilisateurs ${action}`);
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
  });
});
