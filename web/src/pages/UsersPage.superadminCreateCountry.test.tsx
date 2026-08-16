import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UsersPage } from "./UsersPage";
import { clientsApi } from "../lib/clientsApi";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canSuspend: false,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "super-1",
        role: "Super Administrateur Somafrik",
        schoolCode: "*",
        identifier: "SUPER-ADMIN",
        permissions: ["Utilisateurs:READ", "Utilisateurs:CREATE"],
      },
      permissions: ["Utilisateurs:READ", "Utilisateurs:CREATE"],
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
      users: [],
      schools: [
        { code: "CD-2026-0001", name: "Unikin", country: "RDC", countryCode: "CD" },
        { code: "BI-2026-0001", name: "Lycée du Burundi", country: "Burundi", countryCode: "BI" },
      ],
      countries: [
        { code: "CD", name: "République démocratique du Congo" },
        { code: "BI", name: "Burundi" },
      ],
      teachers: [],
      rolePermissions: {},
    },
    refresh: vi.fn(),
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({
    user: { role: "Super Administrateur Somafrik", schoolCode: "*", permissions: ["Utilisateurs:CREATE"] },
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
  buildCreateUserPayload: (payload: Record<string, unknown>) => payload,
}));

describe("UsersPage — Superadmin création sans pays RDC par défaut", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    vi.mocked(clientsApi.createUser).mockReset();
    vi.mocked(clientsApi.provisionUser).mockReset();
    vi.mocked(clientsApi.grantUserRole).mockReset();
    sessionStorage.setItem("somafrik.activeSchoolCode", "CD-2026-0001");
  });

  function openCreateForm() {
    render(
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nouvel utilisateur" }));
  }

  it("A — pays vide et établissement désactivé à l'ouverture", () => {
    openCreateForm();
    const country = screen.getByLabelText(/Pays/i) as HTMLSelectElement;
    const school = screen.getByLabelText(/Établissement/i) as HTMLSelectElement;
    expect(country.value).toBe("");
    expect(school.value).toBe("");
    expect(school).toBeDisabled();
    expect(within(country).getByText("Choisir un pays...")).toBeInTheDocument();
  });

  it("B — pays CD et BI disponibles, sans auto-select countries[0]", () => {
    openCreateForm();
    const country = screen.getByLabelText(/Pays/i);
    expect(within(country).getByRole("option", { name: /République démocratique du Congo/i })).toBeInTheDocument();
    expect(within(country).getByRole("option", { name: /Burundi/i })).toBeInTheDocument();
    expect((country as HTMLSelectElement).value).toBe("");
  });

  it("C — BI n'affiche que les établissements burundais", () => {
    openCreateForm();
    fireEvent.change(screen.getByLabelText(/Pays/i), { target: { value: "BI" } });
    const school = screen.getByLabelText(/Établissement/i) as HTMLSelectElement;
    expect(school).not.toBeDisabled();
    expect(within(school).getByRole("option", { name: /Lycée du Burundi/ })).toBeInTheDocument();
    expect(within(school).queryByRole("option", { name: /Unikin/ })).not.toBeInTheDocument();
  });

  it("D — changer BI → RDC reset l'école sélectionnée", () => {
    openCreateForm();
    fireEvent.change(screen.getByLabelText(/Pays/i), { target: { value: "BI" } });
    fireEvent.change(screen.getByLabelText(/Établissement/i), { target: { value: "BI-2026-0001" } });
    expect((screen.getByLabelText(/Établissement/i) as HTMLSelectElement).value).toBe("BI-2026-0001");
    fireEvent.change(screen.getByLabelText(/Pays/i), { target: { value: "RDC" } });
    expect((screen.getByLabelText(/Établissement/i) as HTMLSelectElement).value).toBe("");
    expect(within(screen.getByLabelText(/Établissement/i)).queryByRole("option", { name: /Lycée du Burundi/ })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText(/Établissement/i)).getByRole("option", { name: /Unikin/ })).toBeInTheDocument();
  });

  it("F/G — Admin School exige une école ; soumission bloquée sans établissement", async () => {
    openCreateForm();
    fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: "Grace" } });
    fireEvent.change(screen.getByLabelText(/^Nom/i), { target: { value: "Ndayishimiye" } });
    fireEvent.change(screen.getByLabelText(/^Rôle/i), { target: { value: "Admin School" } });
    fireEvent.change(screen.getByLabelText(/Pays/i), { target: { value: "BI" } });
    fireEvent.submit(document.getElementById("user-form")!);
    expect(clientsApi.createUser).not.toHaveBeenCalled();
    expect(clientsApi.provisionUser).not.toHaveBeenCalled();
  });

  it("soumet BI + école BI + Admin School via provision, sans GRANT ni session CD", async () => {
    vi.mocked(clientsApi.provisionUser).mockResolvedValue({
      id: "user-bi-1",
      schoolCode: "BI-2026-0001",
      countryCode: "BI",
      roleKeys: ["SCHOOL_ADMIN"],
    });
    openCreateForm();
    fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: "Grace" } });
    fireEvent.change(screen.getByLabelText(/^Nom/i), { target: { value: "Ndayishimiye" } });
    fireEvent.change(screen.getByLabelText(/^Rôle/i), { target: { value: "Admin School" } });
    fireEvent.change(screen.getByLabelText(/Pays/i), { target: { value: "BI" } });
    fireEvent.change(screen.getByLabelText(/Établissement/i), { target: { value: "BI-2026-0001" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(clientsApi.provisionUser).toHaveBeenCalledTimes(1));
    expect(clientsApi.provisionUser).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Grace",
        lastName: "Ndayishimiye",
        schoolCode: "BI-2026-0001",
        countryCode: "BI",
        roleKey: "SCHOOL_ADMIN",
      }),
    );
    expect(clientsApi.createUser).not.toHaveBeenCalled();
    expect(clientsApi.grantUserRole).not.toHaveBeenCalled();
  });

  it("soumet Admin Pays BI via provision, sans établissement ni GRANT", async () => {
    vi.mocked(clientsApi.provisionUser).mockResolvedValue({
      id: "user-pays-bi-1",
      schoolCode: "*",
      countryCode: "BI",
      roleKeys: ["COUNTRY_ADMIN"],
    });
    openCreateForm();
    fireEvent.change(screen.getByLabelText(/^Prénom/i), { target: { value: "Amina" } });
    fireEvent.change(screen.getByLabelText(/^Nom/i), { target: { value: "Nshimirimana" } });
    fireEvent.change(screen.getByLabelText(/^Rôle/i), { target: { value: "Admin Pays" } });
    fireEvent.change(screen.getByLabelText(/Pays/i), { target: { value: "BI" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(clientsApi.provisionUser).toHaveBeenCalledTimes(1));
    expect(clientsApi.provisionUser).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Amina",
        lastName: "Nshimirimana",
        countryCode: "BI",
        roleKey: "COUNTRY_ADMIN",
      }),
    );
    expect(vi.mocked(clientsApi.provisionUser).mock.calls[0][0]).not.toHaveProperty("schoolCode");
    expect(clientsApi.createUser).not.toHaveBeenCalled();
    expect(clientsApi.grantUserRole).not.toHaveBeenCalled();
  });
});
