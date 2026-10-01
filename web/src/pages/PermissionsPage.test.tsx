import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  RbacCatalog,
  RbacConfiguredMatrix,
  RbacConfiguredQuery,
  RbacCrudGrant,
  RbacPatchPermissionsPayload,
  RbacResetOverridePayload,
} from "../lib/rbacApi";

const { catalog, patchMock, getConfiguredMock, resetMock, updateRoleMock, getHistoryMock } = vi.hoisted(() => {
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
            configured: false,
            source: "global",
            inherited: true,
        },
      ],
    };
  });
  const patchMock = vi.fn(async (payload: RbacPatchPermissionsPayload) => {
    void payload;
    return { updatedAt: "2026-08-16T11:00:00.000Z" };
  });
  const resetMock = vi.fn(async (payload: RbacResetOverridePayload) => {
    void payload;
    return {
      roleKey: "PREFET_ETUDES",
      roleName: "Préfet des études",
      scopeType: "school" as const,
      updatedAt: null,
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
          configured: false,
          source: "global" as const,
          inherited: true,
        },
      ],
    };
  });
  const updateRoleMock = vi.fn(async () => catalog.roles[0]);
  const getHistoryMock = vi.fn(async () => ({
    items: [
      {
        id: "aud-1",
        createdAt: "2026-10-01T10:00:00.000Z",
        actor: "superadmin",
        action: "ROLE_RENAME",
        role: "Préfet des études",
        roleKey: "PREFET_ETUDES",
        moduleKey: null,
        scope: "school",
        before: "Préfet des études",
        after: "Préfet pédagogique",
        summary: "Préfet des études → Préfet pédagogique",
      },
    ],
    limit: 20,
    offset: 0,
    hasMore: false,
  }));
  return { catalog, patchMock, getConfiguredMock, resetMock, updateRoleMock, getHistoryMock };
});

vi.mock("../lib/rbacApi", () => ({
  rbacApi: {
    getCatalog: vi.fn(async (): Promise<RbacCatalog> => catalog),
    getConfigured: (query: RbacConfiguredQuery) => getConfiguredMock(query),
    patchPermissions: (payload: RbacPatchPermissionsPayload) => patchMock(payload),
    resetOverride: (payload: RbacResetOverridePayload) => resetMock(payload),
    createRole: vi.fn(),
    updateRole: (roleId: string, payload: Record<string, unknown>) => updateRoleMock(roleId, payload),
    archiveRole: vi.fn(),
    getHistory: (query?: { limit?: number; offset?: number }) => getHistoryMock(query),
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
    resetMock.mockClear();
    updateRoleMock.mockClear();
    getHistoryMock.mockClear();
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

  it("hydrate l'héritage global et n'enregistre pas sans modification", async () => {
    await selectPath("PREFET_ETUDES", "students");
    expect(await screen.findByLabelText("Élèves Lecture")).toBeChecked();
    expect(screen.getByLabelText("Élèves Modification")).toBeChecked();
    expect(screen.getByLabelText("Élèves Suppression")).toBeChecked();
    expect(screen.getByLabelText("Élèves Création")).not.toBeChecked();
    expect(screen.getByText(/Hérité du catalogue global/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Réinitialiser à l'héritage" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("Réinitialiser à l'héritage appelle resetOverride", async () => {
    getConfiguredMock.mockImplementationOnce(async () => ({
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
          canUpdate: false,
          canDelete: false,
          configured: true,
          source: "school",
          inherited: false,
        },
      ],
    }));
    await selectPath("PREFET_ETUDES", "students");
    fireEvent.click(await screen.findByRole("button", { name: "Réinitialiser à l'héritage" }));
    await waitFor(() => expect(resetMock).toHaveBeenCalled());
    expect(resetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roleKey: "PREFET_ETUDES",
        schoolCode: "CD-2026-0001",
        moduleKey: "students",
      }),
    );
    await waitFor(() => expect(screen.getByText(/Hérité du catalogue global/)).toBeInTheDocument());
  });

  it("permet de renommer un rôle métier sans toucher au code technique", async () => {
    render(<PermissionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Rôles" }));
    expect(screen.getByText("PREFET_ETUDES")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Renommer" }));
    const input = await screen.findByLabelText("Libellé PREFET_ETUDES");
    fireEvent.change(input, { target: { value: "Préfet pédagogique" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le libellé" }));
    await waitFor(() => expect(updateRoleMock).toHaveBeenCalled());
    expect(updateRoleMock).toHaveBeenCalledWith("role-prefet", { roleName: "Préfet pédagogique" });
    expect(screen.queryByRole("button", { name: "Renommer" })).not.toBeNull();
    expect(screen.getAllByText("Protégé").length).toBeGreaterThan(0);
  });

  it("affiche l'historique paginé des modifications RBAC", async () => {
    render(<PermissionsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Historique" }));
    await waitFor(() => expect(getHistoryMock).toHaveBeenCalled());
    expect(getHistoryMock).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    expect(await screen.findByText("Historique des modifications")).toBeInTheDocument();
    expect(screen.getByText("ROLE_RENAME")).toBeInTheDocument();
    expect(screen.getByText("Préfet des études → Préfet pédagogique")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
  });
});
