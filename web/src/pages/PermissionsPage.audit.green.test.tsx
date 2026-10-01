import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RbacCatalog } from "../lib/rbacApi";

const catalog: RbacCatalog = {
  modules: [],
  roles: [],
  protectedRoleKeys: ["SUPER_ADMIN", "COUNTRY_ADMIN", "SCHOOL_ADMIN"],
  mandatoryByRole: { SUPER_ADMIN: {}, SCHOOL_ADMIN: {}, COUNTRY_ADMIN: {} },
};

vi.mock("../lib/rbacApi", () => ({
  rbacApi: {
    getCatalog: vi.fn(async () => catalog),
    getConfigured: vi.fn(),
    patchPermissions: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    archiveRole: vi.fn(),
  },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: { id: "admin-nuru", role: "Admin School", schoolCode: "CD-2026-0001" },
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
    user: { role: "Admin School" },
    rolePermissions: {},
  }),
}));

vi.mock("../lib/permissions", () => ({
  canManageRolePermissions: () => false,
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { PermissionsPage } from "./PermissionsPage";

describe("PermissionsPage — AUDIT GREEN SCHOOL_ADMIN", () => {
  it("RED-09 UI : Admin School n'a pas Enregistrer et voit la consultation réservée", async () => {
    render(<PermissionsPage />);
    expect(await screen.findByText("Rôles et droits")).toBeInTheDocument();
    expect(
      screen.getByText("Consultation réservée. Seul le Super administrateur peut modifier les droits."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
  });
});
