import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UsersPage } from "./UsersPage";
import { clientsApi } from "../lib/clientsApi";
import { ApiError } from "../api/client";
import type { UserAccount } from "../types";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canSuspend: false,
}));

const showToast = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

const existingUser = {
  id: "usr-kanyosha",
  firstName: "Aline",
  lastName: "Ndayishimiye",
  publicId: "BI-IN-ALN-26-00001",
  identifier: "BI-IN-ALN-26-00001",
  userCode: "USR-2026-0009",
  role: "Admin School",
  roles: ["Admin School"],
  roleKeys: ["SCHOOL_ADMIN"],
  countryScope: "Burundi",
  schoolCode: "BI-2026-0001",
  schoolPublicCode: "BI-2026-0001",
  schoolName: "Ecole Kanyosha",
  status: "Actif",
  email: "aline.kanyosha@test.local",
} as UserAccount & { userCode?: string };

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
      schools: [
        { code: "CD-2026-0001", name: "Unikin", country: "RDC", countryCode: "CD" },
        { code: "BI-2026-0001", name: "Ecole Kanyosha", country: "Burundi", countryCode: "BI" },
      ],
      countries: [
        { code: "CD", name: "République démocratique du Congo" },
        { code: "BI", name: "Burundi" },
      ],
      teachers: [],
      rolePermissions: {},
    },
    refresh,
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
  usePrompt: () => ({ prompt: vi.fn() }),
}));

vi.mock("../lib/clientsApi", () => ({
  clientsApi: {
    listAssignableRoles: vi.fn(),
    grantUserRole: vi.fn(),
    revokeUserRole: vi.fn(),
    updateUser: vi.fn(),
    createUser: vi.fn(),
    reassignUserSchool: vi.fn(),
  },
  buildCreateUserPayload: (payload: Record<string, unknown>) => payload,
}));

describe("UsersPage — Modifier utilisateur / tenant readonly", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    showToast.mockReset();
    refresh.mockReset();
    refresh.mockResolvedValue(undefined);
    vi.mocked(clientsApi.updateUser).mockReset();
    vi.mocked(clientsApi.reassignUserSchool).mockReset();
    vi.mocked(clientsApi.updateUser).mockResolvedValue({ id: existingUser.id });
    vi.mocked(clientsApi.reassignUserSchool).mockResolvedValue({ id: existingUser.id, schoolCode: "CD-2026-0001" });
  });

  function openEdit() {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Modifier" })[0]);
  }

  it("affiche Pays et Établissement en lecture seule", () => {
    openEdit();
    const country = screen.getByLabelText(/Pays/i);
    const school = screen.getByLabelText(/^Établissement/i);
    expect(country.tagName).toBe("INPUT");
    expect(school.tagName).toBe("INPUT");
    expect(country).toHaveAttribute("readonly");
    expect(school).toHaveAttribute("readonly");
    expect((country as HTMLInputElement).value).toMatch(/Burundi/i);
    expect(screen.getByRole("button", { name: "Réaffecter l'établissement" })).toBeInTheDocument();
  });

  it("n'envoie que l'identité, sans userCode ni schoolCode", async () => {
    openEdit();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(clientsApi.updateUser).toHaveBeenCalled());
    const [, payload] = vi.mocked(clientsApi.updateUser).mock.calls[0];
    expect(payload).toMatchObject({
      firstName: "Aline",
      lastName: "Ndayishimiye",
      email: "aline.kanyosha@test.local",
    });
    expect(payload).not.toHaveProperty("userCode");
    expect(payload).not.toHaveProperty("schoolCode");
    expect(payload).not.toHaveProperty("countryCode");
    expect(payload).not.toHaveProperty("role");
    expect(showToast).not.toHaveBeenCalledWith("Échec de la synchronisation", "error");
  });

  it("affiche le code d'erreur réel, jamais Échec de la synchronisation", async () => {
    vi.mocked(clientsApi.updateUser).mockRejectedValue(
      new ApiError(
        "Champ interdit à la création/modification d'identité: userCode.",
        400,
        "CLIENT_IDENTITY_FIELD_FORBIDDEN",
      ),
    );
    openEdit();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith(
      "CLIENT_IDENTITY_FIELD_FORBIDDEN · Champ interdit à la création/modification d'identité: userCode.",
      "error",
    );
    expect(showToast).not.toHaveBeenCalledWith("Échec de la synchronisation", "error");
  });

  it("sépare la réaffectation tenant de l'enregistrement identité", async () => {
    openEdit();
    fireEvent.click(screen.getByRole("button", { name: "Réaffecter l'établissement" }));
    const dialog = screen.getByRole("dialog", { name: /Réaffecter l'établissement/i });
    fireEvent.change(within(dialog).getByLabelText(/Pays/i), { target: { value: "RDC" } });
    fireEvent.change(within(dialog).getByLabelText(/Nouvel établissement/i), { target: { value: "CD-2026-0001" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmer la réaffectation" }));
    await waitFor(() => expect(clientsApi.reassignUserSchool).toHaveBeenCalled());
    expect(clientsApi.reassignUserSchool).toHaveBeenCalledWith("usr-kanyosha", {
      schoolCode: "CD-2026-0001",
      countryCode: "CD",
    });
    expect(clientsApi.updateUser).not.toHaveBeenCalled();
  });
});
