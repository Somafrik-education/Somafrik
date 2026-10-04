import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RbacCatalog, RbacConfiguredMatrix, RbacConfiguredQuery } from "../lib/rbacApi";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

const { catalog, getConfiguredMock } = vi.hoisted(() => {
  const catalog: RbacCatalog = {
    modules: [
      {
        moduleKey: "audit",
        moduleName: "Audit",
        appliesWeb: true,
        appliesMobile: false,
        actions: ["create", "read", "update", "delete"],
        dependencies: { create: ["read"], update: ["read"], delete: ["read"] },
      },
      {
        moduleKey: "reports",
        moduleName: "Rapports",
        appliesWeb: true,
        appliesMobile: true,
        actions: ["create", "read", "update", "delete"],
        dependencies: { create: ["read"], update: ["read"], delete: ["read"] },
      },
    ],
    roles: [
      {
        id: "role-school",
        roleCode: "SCHOOL_ADMIN",
        roleName: "Admin School",
        scope: "school",
        displayOrder: 2,
        status: "active",
        schoolAssignable: false,
        activeUserCount: 1,
        updatedAt: "2026-10-04T10:00:00.000Z",
        roleKey: "SCHOOL_ADMIN",
        defaultLabel: "Admin School",
        displayLabel: null,
        effectiveLabel: "Admin School",
      },
    ],
    protectedRoleKeys: ["SUPER_ADMIN", "SCHOOL_ADMIN"],
    mandatoryByRole: {
      SUPER_ADMIN: {},
      SCHOOL_ADMIN: {},
      COUNTRY_ADMIN: {},
    },
  };
  const getConfiguredMock = vi.fn(async (query: RbacConfiguredQuery): Promise<RbacConfiguredMatrix> => {
    void query;
    return {
      roleKey: "SCHOOL_ADMIN",
      roleName: "Admin School",
      scopeType: "school",
      updatedAt: null,
      modules: [
        {
          moduleKey: "audit",
          moduleName: "Audit",
          appliesWeb: true,
          appliesMobile: false,
          canCreate: false,
          canRead: false,
          canUpdate: false,
          canDelete: false,
          configured: false,
          source: "none",
          inherited: false,
        },
      ],
    };
  });
  return { catalog, getConfiguredMock };
});

vi.mock("../lib/rbacApi", () => ({
  rbacApi: {
    getCatalog: vi.fn(async (): Promise<RbacCatalog> => catalog),
    getConfigured: (query: RbacConfiguredQuery) => getConfiguredMock(query),
    patchPermissions: vi.fn(),
    resetOverride: vi.fn(),
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

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { PermissionsPage } from "./PermissionsPage";

describe("PermissionsPage ADMIN-06C module Audit", () => {
  beforeEach(() => {
    getConfiguredMock.mockClear();
  });

  it("C06C-RBAC-06 expose le module Audit dans Rôles et droits", async () => {
    const catalogSrc = readFileSync(join(ROOT, "../../../backend/lib/functionalModulesCatalog.js"), "utf8");
    expect(catalogSrc).toContain('moduleKey: "audit"');
    expect(catalogSrc).toContain('moduleName: "Audit"');

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
      target: { value: "SCHOOL_ADMIN" },
    });
    await waitFor(() => expect(getConfiguredMock).toHaveBeenCalled());
    const moduleSelect = document.getElementById("rbac-module") as HTMLSelectElement;
    expect([...moduleSelect.options].some((option) => option.value === "audit" && option.textContent === "Audit")).toBe(
      true,
    );
    fireEvent.change(moduleSelect, { target: { value: "audit" } });
    expect(await screen.findByLabelText("Audit Lecture")).toBeInTheDocument();
    expect(screen.getByLabelText("Audit Création")).toBeInTheDocument();
    expect(screen.getByLabelText("Audit Modification")).toBeInTheDocument();
    expect(screen.getByLabelText("Audit Suppression")).toBeInTheDocument();
    expect(screen.getByLabelText("Audit Lecture")).not.toBeChecked();
  });
});
