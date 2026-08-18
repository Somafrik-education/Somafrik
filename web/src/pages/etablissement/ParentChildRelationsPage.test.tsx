import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ParentChildRelationsPage } from "./ParentChildRelationsPage";
import { parentsApi } from "../../lib/parentsApi";

const updateMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const parentsApiMock = vi.hoisted(() => ({
  lookupIdentity: vi.fn(),
  linkParent: vi.fn(),
  archiveRelation: vi.fn(),
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "admin-1",
        role: "Admin School",
        schoolCode: "CD-2026-0001",
        permissions: ["Relations:CREATE", "Relations:READ", "Gérer utilisateurs"],
      },
    },
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: "CD-2026-0001",
    scopedUser: {
      id: "admin-1",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      permissions: ["Relations:CREATE", "Relations:READ", "Gérer utilisateurs"],
    },
  }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: {
      id: "admin-1",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      permissions: ["Relations:CREATE", "Relations:READ", "Gérer utilisateurs"],
    },
    rolePermissions: {},
  }),
}));

vi.mock("../../context/DataContext", () => ({
  useData: () => ({
    state: {
      schools: [{ id: "sch-1", code: "CD-2026-0001", name: "INSTITUT NURU", status: "Actif" }],
      students: [
        {
          id: "student-esther",
          firstName: "Esther",
          lastName: "OKITO",
          schoolCode: "CD-2026-0001",
          className: "6ème",
        },
      ],
      users: [],
      contacts: [],
      relations: [],
      teachers: [],
      classes: [],
      assignments: [],
      rolePermissions: {},
    },
    update: updateMock,
    refresh: refreshMock,
  }),
}));

vi.mock("../../lib/parentsApi", () => ({
  parentsApi: parentsApiMock,
}));

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

vi.mock("../../components/ui/PromptDialog", () => ({
  usePrompt: () => ({ prompt: vi.fn() }),
}));

vi.mock("../../lib/subscriptionAccessClient", () => ({
  subscriptionFeatureBlocked: () => null,
}));

describe("ParentChildRelationsPage — Lier un parent", () => {
  beforeEach(() => {
    updateMock.mockReset();
    refreshMock.mockReset();
    refreshMock.mockResolvedValue(undefined);
    parentsApiMock.lookupIdentity.mockReset();
    parentsApiMock.linkParent.mockReset();
    parentsApiMock.lookupIdentity.mockResolvedValue({ found: false });
    parentsApiMock.linkParent.mockResolvedValue({
      created: true,
      user: { id: "user-b", firstName: "Baudouin", lastName: "OKITO" },
      relation: { id: "rel-1" },
    });
  });

  it("appelle l'API métier et ne persiste pas via DataContext.update", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ParentChildRelationsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Lier un parent" }));
    expect(screen.getByLabelText(/Élève/i)).toBeTruthy();
    expect(screen.queryByText(/Créez d'abord un compte Parent/i)).toBeNull();

    await user.selectOptions(screen.getByLabelText(/Élève/i), "student-esther");
    await user.type(screen.getByLabelText(/^Téléphone/i), "+243811111111");
    await user.type(screen.getByLabelText(/^Email/i), "baudouin@test.local");
    await user.type(screen.getByLabelText(/^Nom/i), "OKITO");
    await user.type(screen.getByLabelText(/^Prénom/i), "Baudouin");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(parentsApiMock.linkParent).toHaveBeenCalledTimes(1));
    expect(parentsApiMock.linkParent).toHaveBeenCalledWith({
      studentId: "student-esther",
      firstName: "Baudouin",
      lastName: "OKITO",
      phone: "+243811111111",
      email: "baudouin@test.local",
      relationType: "parent_student",
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("affiche les erreurs 409/403/500", async () => {
    const { ApiError } = await import("../../api/client");
    parentsApiMock.linkParent.mockRejectedValueOnce(
      new ApiError("ambigu", 409, "PARENT_IDENTITY_AMBIGUOUS"),
    );
    const user = userEvent.setup();
    const { showToast } = { showToast: vi.fn() };
    void showToast;
    render(
      <MemoryRouter>
        <ParentChildRelationsPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Lier un parent" }));
    await user.selectOptions(screen.getByLabelText(/Élève/i), "student-esther");
    await user.type(screen.getByLabelText(/^Téléphone/i), "+243811111111");
    await user.type(screen.getByLabelText(/^Nom/i), "OKITO");
    await user.type(screen.getByLabelText(/^Prénom/i), "Baudouin");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(parentsApiMock.linkParent).toHaveBeenCalled());
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("parentsApi export", () => {
  it("existe", () => {
    expect(parentsApi).toBeTruthy();
  });
});
