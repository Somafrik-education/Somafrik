import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "../api/client";
import type {
  RbacCatalog,
  RbacConfiguredMatrix,
  RbacConfiguredQuery,
  RbacModule,
  RbacPatchPermissionsPayload,
  RbacResetOverridePayload,
} from "../lib/rbacApi";

function moduleRow(
  moduleKey: string,
  moduleName: string,
  displayOrder: number,
  flags: Partial<RbacModule> = {},
): RbacModule {
  return {
    moduleKey,
    moduleName,
    displayOrder,
    appliesWeb: true,
    appliesMobile: true,
    canCreate: false,
    canRead: false,
    canUpdate: false,
    canDelete: false,
    configured: false,
    source: "none",
    inherited: false,
    actions: ["create", "read", "update", "delete"],
    dependencies: { create: ["read"], update: ["read"], delete: ["read"] },
    ...flags,
  };
}

const { catalog, patchMock, getConfiguredMock, resetMock } = vi.hoisted(() => {
  const catalog: RbacCatalog = {
    modules: [
      moduleRow("users", "Utilisateurs", 60, { canRead: true, canUpdate: true, canDelete: true, source: "global" }),
      moduleRow("classes", "Classes", 90, { canCreate: true, canRead: true, canUpdate: true, canDelete: true, source: "global" }),
      moduleRow("students", "Élèves", 100, { canRead: true, canUpdate: true, canDelete: true, source: "global" }),
      moduleRow("audit", "Audit", 300, { source: "none" }),
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
        roleKey: "PREFET_ETUDES",
        defaultLabel: "Préfet des études",
        displayLabel: "Directeur pédagogique",
        effectiveLabel: "Directeur pédagogique",
      },
      {
        id: "role-school",
        roleCode: "SCHOOL_ADMIN",
        roleName: "Admin School",
        scope: "school",
        displayOrder: 2,
        status: "active",
        schoolAssignable: false,
        roleKey: "SCHOOL_ADMIN",
        defaultLabel: "Admin School",
        displayLabel: null,
        effectiveLabel: "Admin School",
      },
      {
        id: "role-super",
        roleCode: "SUPER_ADMIN",
        roleName: "Super Administrateur Somafrik",
        scope: "platform",
        displayOrder: 0,
        status: "active",
        schoolAssignable: false,
        roleKey: "SUPER_ADMIN",
        defaultLabel: "Super Administrateur Somafrik",
        displayLabel: null,
        effectiveLabel: "Super Administrateur Somafrik",
      },
    ],
    protectedRoleKeys: ["SUPER_ADMIN", "SCHOOL_ADMIN"],
    mandatoryByRole: {
      SUPER_ADMIN: {
        users: { create: true, read: true, update: true, delete: true },
      },
      SCHOOL_ADMIN: {},
      PREFET_ETUDES: {},
    },
  };

  const prefetMatrix = (): RbacConfiguredMatrix => ({
    roleKey: "PREFET_ETUDES",
    roleName: "Préfet des études",
    scopeType: "school",
    updatedAt: "2026-10-04T10:00:00.000Z",
    modules: [
      moduleRow("audit", "Audit", 300, { source: "none" }),
      moduleRow("users", "Utilisateurs", 60, {
        canRead: true,
        canUpdate: true,
        canDelete: true,
        source: "global",
        inherited: true,
      }),
      moduleRow("students", "Élèves", 100, {
        canRead: true,
        canUpdate: true,
        canDelete: true,
        source: "country",
        inherited: true,
      }),
      moduleRow("classes", "Classes", 90, {
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: true,
        configured: true,
        source: "school",
        inherited: false,
      }),
    ],
  });

  const getConfiguredMock = vi.fn(async (query: RbacConfiguredQuery): Promise<RbacConfiguredMatrix> => {
    void query;
    return prefetMatrix();
  });
  const patchMock = vi.fn(async (payload: RbacPatchPermissionsPayload) => {
    void payload;
    return { updatedAt: "2026-10-04T11:00:00.000Z" };
  });
  const resetMock = vi.fn(async (payload: RbacResetOverridePayload) => {
    void payload;
    const next = prefetMatrix();
    next.modules = next.modules.map((module) =>
      module.moduleKey === "classes"
        ? {
            ...module,
            configured: false,
            source: "global",
            inherited: true,
            canCreate: false,
            canRead: true,
            canUpdate: true,
            canDelete: true,
          }
        : module,
    );
    next.updatedAt = "2026-10-04T11:30:00.000Z";
    return next;
  });
  return { catalog, patchMock, getConfiguredMock, resetMock };
});

vi.mock("../lib/rbacApi", () => ({
  rbacApi: {
    getCatalog: vi.fn(async (): Promise<RbacCatalog> => catalog),
    getConfigured: (query: RbacConfiguredQuery) => getConfiguredMock(query),
    patchPermissions: (payload: RbacPatchPermissionsPayload) => patchMock(payload),
    resetOverride: (payload: RbacResetOverridePayload) => resetMock(payload),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    updateRoleDisplayLabel: vi.fn(),
    resetRoleDisplayLabel: vi.fn(),
    archiveRole: vi.fn(),
    getHistory: vi.fn(async () => ({ items: [], limit: 20, offset: 0, hasMore: false })),
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

async function selectPrefet() {
  render(<PermissionsPage />);
  await screen.findByText("Rôles et droits");
  fireEvent.change(document.getElementById("rbac-country") as HTMLSelectElement, { target: { value: "CD" } });
  await waitFor(() => expect((document.getElementById("rbac-school") as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(document.getElementById("rbac-school") as HTMLSelectElement, { target: { value: "CD-2026-0001" } });
  await waitFor(() => expect((document.getElementById("rbac-role") as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(document.getElementById("rbac-role") as HTMLSelectElement, { target: { value: "PREFET_ETUDES" } });
  await waitFor(() => expect(getConfiguredMock).toHaveBeenCalled());
  await screen.findByTestId("rbac-permissions-matrix");
}

function moduleKeysInTable() {
  return [...document.querySelectorAll("[data-module-key]")].map((row) => row.getAttribute("data-module-key"));
}

describe("PermissionsPage ADMIN-02C — matrice complète", () => {
  beforeEach(() => {
    patchMock.mockReset();
    patchMock.mockImplementation(async (payload: RbacPatchPermissionsPayload) => {
      void payload;
      return { updatedAt: "2026-10-04T11:00:00.000Z" };
    });
    getConfiguredMock.mockClear();
    resetMock.mockClear();
    showToast.mockClear();
  });

  it("MATRIX-01 aucun select Module fonctionnel", async () => {
    await selectPrefet();
    expect(screen.queryByText("Module fonctionnel")).toBeNull();
    expect(document.getElementById("rbac-module")).toBeNull();
    expect(document.getElementById("rbac-country")).toBeTruthy();
    expect(document.getElementById("rbac-school")).toBeTruthy();
    expect(document.getElementById("rbac-role")).toBeTruthy();
  });

  it("MATRIX-02 / MATRIX-03 / MATRIX-04 Pays + école + rôle → tous modules visibles", async () => {
    await selectPrefet();
    expect(screen.getByLabelText("Utilisateurs Lecture")).toBeInTheDocument();
    expect(screen.getByLabelText("Élèves Lecture")).toBeInTheDocument();
    expect(screen.getByLabelText("Classes Lecture")).toBeInTheDocument();
    expect(screen.getByLabelText("Audit Lecture")).toBeInTheDocument();
  });

  it("MATRIX-05 ordre displayOrder", async () => {
    await selectPrefet();
    expect(moduleKeysInTable()).toEqual(["users", "classes", "students", "audit"]);
  });

  it("MATRIX-06 / MATRIX-07 / MATRIX-08 un PATCH batch avec seulement les modules dirty", async () => {
    await selectPrefet();
    fireEvent.click(screen.getByLabelText("Utilisateurs Création"));
    fireEvent.click(screen.getByLabelText("Audit Lecture"));
    fireEvent.click(screen.getAllByRole("button", { name: "Enregistrer les droits" })[0]);
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    const payload = patchMock.mock.calls[0][0];
    expect(payload.grants).toHaveLength(2);
    expect(payload.grants.map((grant) => grant.moduleKey).sort()).toEqual(["audit", "users"]);
    expect(payload.grants.find((grant) => grant.moduleKey === "students")).toBeUndefined();
    expect(payload.grants.find((grant) => grant.moduleKey === "users")).toMatchObject({
      canCreate: true,
      canRead: true,
    });
    expect(payload.expectedUpdatedAt).toBe("2026-10-04T10:00:00.000Z");
  });

  it("MATRIX-09 CREATE force READ", async () => {
    await selectPrefet();
    fireEvent.click(screen.getByLabelText("Utilisateurs Création"));
    expect(screen.getByLabelText("Utilisateurs Création")).toBeChecked();
    expect(screen.getByLabelText("Utilisateurs Lecture")).toBeChecked();
    expect(screen.getByLabelText("Utilisateurs Lecture")).toBeDisabled();
  });

  it("MATRIX-10 UPDATE force READ", async () => {
    getConfiguredMock.mockImplementationOnce(async () => ({
      roleKey: "PREFET_ETUDES",
      roleName: "Préfet des études",
      scopeType: "school",
      updatedAt: "2026-10-04T10:00:00.000Z",
      modules: [moduleRow("audit", "Audit", 300, { source: "none" })],
    }));
    await selectPrefet();
    fireEvent.click(screen.getByLabelText("Audit Modification"));
    expect(screen.getByLabelText("Audit Modification")).toBeChecked();
    expect(screen.getByLabelText("Audit Lecture")).toBeChecked();
    expect(screen.getByLabelText("Audit Lecture")).toBeDisabled();
  });

  it("MATRIX-11 DELETE force READ", async () => {
    getConfiguredMock.mockImplementationOnce(async () => ({
      roleKey: "PREFET_ETUDES",
      roleName: "Préfet des études",
      scopeType: "school",
      updatedAt: "2026-10-04T10:00:00.000Z",
      modules: [moduleRow("audit", "Audit", 300, { source: "none" })],
    }));
    await selectPrefet();
    fireEvent.click(screen.getByLabelText("Audit Suppression"));
    expect(screen.getByLabelText("Audit Suppression")).toBeChecked();
    expect(screen.getByLabelText("Audit Lecture")).toBeChecked();
  });

  it("MATRIX-12 mandatory lock conservé", async () => {
    getConfiguredMock.mockImplementationOnce(async () => ({
      roleKey: "SUPER_ADMIN",
      roleName: "Super Administrateur Somafrik",
      scopeType: "school",
      updatedAt: "2026-10-04T10:00:00.000Z",
      modules: [
        moduleRow("users", "Utilisateurs", 60, {
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: true,
          source: "global",
        }),
      ],
    }));
    render(<PermissionsPage />);
    await screen.findByText("Rôles et droits");
    fireEvent.change(document.getElementById("rbac-country") as HTMLSelectElement, { target: { value: "CD" } });
    await waitFor(() => expect((document.getElementById("rbac-school") as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(document.getElementById("rbac-school") as HTMLSelectElement, { target: { value: "CD-2026-0001" } });
    await waitFor(() => expect((document.getElementById("rbac-role") as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(document.getElementById("rbac-role") as HTMLSelectElement, { target: { value: "SUPER_ADMIN" } });
    await waitFor(() => expect(getConfiguredMock).toHaveBeenCalled());
    for (const action of ["Création", "Lecture", "Modification", "Suppression"]) {
      const box = await screen.findByLabelText(`Utilisateurs ${action}`);
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
  });

  it("MATRIX-13 / MATRIX-14 / MATRIX-15 / MATRIX-16 sources affichées", async () => {
    await selectPrefet();
    const usersRow = document.querySelector('[data-module-key="users"]');
    const studentsRow = document.querySelector('[data-module-key="students"]');
    const classesRow = document.querySelector('[data-module-key="classes"]');
    const auditRow = document.querySelector('[data-module-key="audit"]');
    expect(usersRow?.textContent).toContain("Global");
    expect(studentsRow?.textContent).toContain("Pays");
    expect(classesRow?.textContent).toContain("Établissement");
    expect(auditRow?.textContent).toContain("Refus par défaut");
  });

  it("MATRIX-17 / MATRIX-18 reset d'une ligne recharge toute la matrice", async () => {
    await selectPrefet();
    expect(screen.getByRole("button", { name: "Réinitialiser Classes" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Réinitialiser Audit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Réinitialiser Classes" }));
    await waitFor(() => expect(resetMock).toHaveBeenCalledTimes(1));
    expect(resetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        roleKey: "PREFET_ETUDES",
        moduleKey: "classes",
        schoolCode: "CD-2026-0001",
      }),
    );
    await waitFor(() => {
      expect(document.querySelector('[data-module-key="classes"]')?.textContent).toContain("Global");
    });
    expect(screen.getByLabelText("Audit Lecture")).toBeInTheDocument();
    expect(screen.getByLabelText("Utilisateurs Lecture")).toBeInTheDocument();
  });

  it("MATRIX-19 409 ne perd pas silencieusement les données", async () => {
    patchMock.mockRejectedValueOnce(new ApiError("conflict", 409, "CONFLICT"));
    await selectPrefet();
    fireEvent.click(screen.getByLabelText("Audit Lecture"));
    fireEvent.click(screen.getAllByRole("button", { name: "Enregistrer les droits" })[0]);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      "Conflit : la matrice a été modifiée. Rechargez avant d'enregistrer.",
      "error",
    ));
    expect(screen.getByLabelText("Audit Lecture")).toBeChecked();
    expect(screen.getByTestId("rbac-dirty-count").textContent).toContain("1 module modifié");
  });

  it("MATRIX-20 0 dirty → bouton disabled", async () => {
    await selectPrefet();
    for (const button of screen.getAllByRole("button", { name: "Enregistrer les droits" })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByTestId("rbac-dirty-count").textContent).toContain("Aucun changement");
  });

  it("MATRIX-21 plusieurs dirty → compteur correct", async () => {
    await selectPrefet();
    fireEvent.click(screen.getByLabelText("Utilisateurs Création"));
    fireEvent.click(screen.getByLabelText("Audit Lecture"));
    fireEvent.click(screen.getByLabelText("Élèves Création"));
    expect(screen.getByTestId("rbac-dirty-count").textContent).toBe("3 modules modifiés");
  });

  it("MATRIX-22 changement rôle avec dirty → confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await selectPrefet();
    fireEvent.click(screen.getByLabelText("Audit Lecture"));
    fireEvent.change(document.getElementById("rbac-role") as HTMLSelectElement, {
      target: { value: "SCHOOL_ADMIN" },
    });
    expect(confirmSpy).toHaveBeenCalled();
    expect((document.getElementById("rbac-role") as HTMLSelectElement).value).toBe("PREFET_ETUDES");
    expect(screen.getByLabelText("Audit Lecture")).toBeChecked();
    confirmSpy.mockRestore();
  });

  it("MATRIX-23 display_label n'altère pas roleKey", async () => {
    await selectPrefet();
    expect(screen.getAllByText(/Directeur pédagogique/).length).toBeGreaterThan(0);
    expect((document.getElementById("rbac-role") as HTMLSelectElement).value).toBe("PREFET_ETUDES");
    fireEvent.click(screen.getByLabelText("Audit Lecture"));
    fireEvent.click(screen.getAllByRole("button", { name: "Enregistrer les droits" })[0]);
    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    expect(patchMock.mock.calls[0][0].roleKey).toBe("PREFET_ETUDES");
  });

  it("MATRIX-24 Audit:READ reste configurable", async () => {
    await selectPrefet();
    const read = screen.getByLabelText("Audit Lecture");
    expect(read).not.toBeChecked();
    expect(read).not.toBeDisabled();
    fireEvent.click(read);
    expect(read).toBeChecked();
  });
});
