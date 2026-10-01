/**
 * AUDIT RBAC Administration — tests UI ROUGES volontaires.
 * Exclus de la suite Vitest CI (`*.audit.red.test.tsx`).
 * Affirment le contrat métier : après pays → établissement → rôle métier → module,
 * Superadmin voit et enregistre les droits effectifs (pas une matrice école vide).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  RbacCatalog,
  RbacConfiguredMatrix,
  RbacConfiguredQuery,
  RbacPatchPermissionsPayload,
} from "../lib/rbacApi";

const { catalog, patchMock, getConfiguredMock, getEffectiveMock } = vi.hoisted(() => {
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
    ],
    roles: [
      {
        id: "role-directeur",
        roleCode: "PRINCIPAL",
        roleName: "Directeur",
        scope: "school",
        displayOrder: 2,
        status: "active",
        schoolAssignable: true,
      },
    ],
    protectedRoleKeys: ["SUPER_ADMIN", "COUNTRY_ADMIN", "SCHOOL_ADMIN"],
    mandatoryByRole: {
      SUPER_ADMIN: {},
      SCHOOL_ADMIN: {},
      COUNTRY_ADMIN: {},
    },
  };
  const emptySchoolMatrix = (query: RbacConfiguredQuery): RbacConfiguredMatrix => ({
    roleKey: query.roleKey,
    roleName: "Directeur",
    scopeType: "school",
    countryCode: query.countryCode,
    schoolCode: query.schoolCode,
    updatedAt: null,
    modules: [
      {
        moduleKey: "students",
        moduleName: "Élèves",
        appliesWeb: true,
        appliesMobile: true,
        canCreate: false,
        canRead: false,
        canUpdate: false,
        canDelete: false,
        configured: false,
      },
    ],
  });
  const getConfiguredMock = vi.fn(async (query: RbacConfiguredQuery) => emptySchoolMatrix(query));
  const getEffectiveMock = vi.fn(async (_query: RbacConfiguredQuery) => ({
    roleKey: "PRINCIPAL",
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
  const patchMock = vi.fn(async (payload: RbacPatchPermissionsPayload) => {
    void payload;
    return { updatedAt: "2026-10-01T12:00:00.000Z" };
  });
  return { catalog, patchMock, getConfiguredMock, getEffectiveMock };
});

vi.mock("../lib/rbacApi", () => ({
  rbacApi: {
    getCatalog: vi.fn(async (): Promise<RbacCatalog> => catalog),
    getConfigured: (query: RbacConfiguredQuery) => getConfiguredMock(query),
    getEffective: (query: RbacConfiguredQuery) => getEffectiveMock(query),
    patchPermissions: (payload: RbacPatchPermissionsPayload) => patchMock(payload),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    archiveRole: vi.fn(),
  },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { id: "u-super", role: "Super Administrateur Somafrik", schoolCode: "*" },
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

async function selectBusinessPath() {
  render(<PermissionsPage />);
  await screen.findByText("Rôles et droits");
  fireEvent.change(document.getElementById("rbac-country") as HTMLSelectElement, { target: { value: "CD" } });
  await waitFor(() => {
    expect((document.getElementById("rbac-school") as HTMLSelectElement).disabled).toBe(false);
  });
  fireEvent.change(document.getElementById("rbac-school") as HTMLSelectElement, {
    target: { value: "CD-2026-0001" },
  });
  await waitFor(() => {
    expect((document.getElementById("rbac-role") as HTMLSelectElement).disabled).toBe(false);
  });
  fireEvent.change(document.getElementById("rbac-role") as HTMLSelectElement, {
    target: { value: "PRINCIPAL" },
  });
  await waitFor(() => expect(getConfiguredMock).toHaveBeenCalled());
  fireEvent.change(document.getElementById("rbac-module") as HTMLSelectElement, {
    target: { value: "students" },
  });
}

describe("PermissionsPage — AUDIT RED Superadmin rôles métier", () => {
  beforeEach(() => {
    patchMock.mockClear();
    getConfiguredMock.mockClear();
    getEffectiveMock.mockClear();
  });

  it("RED-01 UI : après le chemin complet, Lecture/Modification/Suppression effectives sont visibles", async () => {
    await selectBusinessPath();
    const readBox = await screen.findByLabelText("Élèves Lecture");
    const updateBox = screen.getByLabelText("Élèves Modification");
    const deleteBox = screen.getByLabelText("Élèves Suppression");
    expect(getEffectiveMock).toHaveBeenCalled();
    expect(readBox).toBeChecked();
    expect(updateBox).toBeChecked();
    expect(deleteBox).toBeChecked();
  });

  it("RED-01b UI : Enregistrer sans toggle n'envoie pas un DENY école", async () => {
    await selectBusinessPath();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    expect(patchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roleKey: "PRINCIPAL",
        countryCode: "CD",
        schoolCode: "CD-2026-0001",
        grants: [
          {
            moduleKey: "students",
            canCreate: false,
            canRead: true,
            canUpdate: true,
            canDelete: true,
          },
        ],
      }),
    );
  });

  it("RED-03 UI : Création reste actionnable pour un rôle métier (pas un cadenas invariant)", async () => {
    await selectBusinessPath();
    const createBox = await screen.findByLabelText("Élèves Création");
    expect(createBox).not.toBeDisabled();
    fireEvent.click(createBox);
    expect(createBox).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    const grant = patchMock.mock.calls[0][0].grants[0];
    expect(grant.canCreate).toBe(true);
    expect(grant.canRead).toBe(true);
    expect(grant.canUpdate).toBe(true);
    expect(grant.canDelete).toBe(true);
  });
});
