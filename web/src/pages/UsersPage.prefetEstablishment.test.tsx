import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UsersPage } from "./UsersPage";
import type { UserAccount } from "../types";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: false,
  canUpdate: false,
  canSuspend: false,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "prefet-1",
        role: "Préfet des études",
        schoolCode: "CD-2026-0001",
        schoolPublicCode: "CD-IN-26-001",
        schoolId: "school-nuru",
        permissions: ["Utilisateurs:READ"],
      },
      permissions: ["Utilisateurs:READ"],
    },
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: {
      id: "prefet-1",
      role: "Préfet des études",
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
      users: [
        {
          id: "usr-jpk",
          firstName: "JEAN PIERRE",
          lastName: "KIMWEMWE",
          publicId: "CD-IN-JPK-26-00004",
          identifier: "CD-IN-JPK-26-00004",
          role: "Préfet des études",
          roles: ["Préfet des études"],
          schoolCode: "CD-IN-26-001",
          schoolPublicCode: "CD-IN-26-001",
          schoolId: "school-nuru",
          schoolName: "INSTITUT NURU",
          status: "Actif",
          email: "prefet@nuru.test",
        } satisfies UserAccount,
      ],
      schools: [],
      countries: [],
      teachers: [],
      rolePermissions: {},
    },
    refresh: vi.fn(),
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: {
      role: "Préfet des études",
      schoolCode: "CD-2026-0001",
      schoolPublicCode: "CD-IN-26-001",
      schoolId: "school-nuru",
      permissions: ["Utilisateurs:READ"],
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
  },
}));

describe("UsersPage — Préfet / code établissement public", () => {
  beforeEach(() => {
    permissions.canRead = true;
  });

  it("ouvre la fiche et affiche CD-IN-26-001 sans le code historique", async () => {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("JEAN PIERRE KIMWEMWE"));

    expect(screen.getByText("Établissement")).toBeInTheDocument();
    expect(screen.getByText("INSTITUT NURU (CD-IN-26-001)")).toBeInTheDocument();
    expect(screen.queryByText("CD-2026-0001")).not.toBeInTheDocument();
  });
});
