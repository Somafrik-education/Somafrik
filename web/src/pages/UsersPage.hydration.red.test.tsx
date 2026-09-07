import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionUser, UserAccount } from "../types";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "../lib/orgHierarchy";
import { getInternalRoleDefaults } from "../lib/internalRoleDefaults";
import { deferred } from "../context/hydrationRedTestUtils";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOGIN_A = "CD-IN-26-001";
const LOGIN_B = "BI-EC-26-001";
const LEFTOVER_A = "CD-2026-0001";

const USER_COUNT_A = 4;

const store = vi.hoisted(() => ({
  users: [] as Record<string, unknown>[],
  schools: [] as Record<string, unknown>[],
  contacts: [] as Record<string, unknown>[],
  holdUsers: null as ReturnType<typeof deferred> | null,
}));

const apiGetMock = vi.hoisted(() =>
  vi.fn(async (path: string): Promise<unknown> => {
    void path;
    return [];
  }),
);

const sessionActor = vi.hoisted(() => ({
  user: {
    id: "admin-nuru",
    firstName: "Admin",
    lastName: "Nuru",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    schoolPublicCode: "CD-IN-26-001",
    schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    identifier: "admin-nuru",
    permissions: [] as string[],
  } as SessionUser,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: sessionActor.user,
      accessToken: "test-access-token",
      scope: { label: "Établissement", hint: sessionActor.user.schoolCode },
      permissions: sessionActor.user.permissions,
    },
    permissionsReady: true,
    logout: vi.fn(),
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: sessionActor.user,
    activeSchoolCode: sessionActor.user.schoolCode,
    isSuperAdmin: sessionActor.user.role === "Super Administrateur Somafrik",
    ready: true,
  }),
}));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getAccessToken: () => "test-access-token",
    api: {
      ...actual.api,
      get: (...args: unknown[]) => apiGetMock(...(args as [string])),
    },
  };
});

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../components/ui/PromptDialog", () => ({
  usePrompt: () => ({ prompt: vi.fn() }),
}));

import { DataProvider } from "../context/DataContext";
import { DomainRouteBootstrap } from "../components/DomainRouteBootstrap";
import { Topbar } from "../components/layout/Topbar";
import { UsersPage } from "./UsersPage";

function pgUser(
  index: number,
  schoolId: string,
  schoolCode: string,
  overrides: Partial<UserAccount> = {},
): UserAccount {
  const seq = String(index + 1).padStart(5, "0");
  return {
    id: `user-${schoolId}-${seq}`,
    firstName: `Prenom${seq}`,
    lastName: schoolId === SCHOOL_ID_A ? "Alpha" : "Bravo",
    publicId: `${schoolCode}-USR-${seq}`,
    identifier: `${schoolCode}-USR-${seq}`,
    role: SCHOOL_ADMIN_ROLE,
    schoolId,
    schoolCode,
    schoolPublicCode: schoolCode,
    countryScope: schoolCode.slice(0, 2),
    status: "Actif",
    ...overrides,
  };
}

function seedSchoolAUsers() {
  store.users = Array.from({ length: USER_COUNT_A }, (_, index) => pgUser(index, SCHOOL_ID_A, LOGIN_A));
  store.schools = [
    { id: SCHOOL_ID_A, code: LEFTOVER_A, name: "Complexe Scolaire Nuru", countryCode: "CD", status: "active" },
  ];
  store.contacts = [];
}

function seedTwoTenants() {
  seedSchoolAUsers();
  store.users = [
    ...store.users,
    pgUser(0, SCHOOL_ID_B, LOGIN_B, { firstName: "Leaked", lastName: "Echo" }),
    pgUser(1, SCHOOL_ID_B, LOGIN_B, { firstName: "Hidden", lastName: "Kilo" }),
  ];
  store.schools.push({
    id: SCHOOL_ID_B,
    code: LOGIN_B,
    name: "Ecole Bravo",
    countryCode: "BI",
    status: "active",
  });
}

function usersGetCalls(): number {
  return apiGetMock.mock.calls.filter(([path]) => String(path) === "/backoffice/users").length;
}

function asSchoolAdmin() {
  sessionActor.user = {
    id: "admin-nuru",
    firstName: "Admin",
    lastName: "Nuru",
    role: SCHOOL_ADMIN_ROLE,
    schoolCode: LEFTOVER_A,
    schoolPublicCode: LOGIN_A,
    schoolId: SCHOOL_ID_A,
    identifier: "admin-nuru",
    permissions: getInternalRoleDefaults(SCHOOL_ADMIN_ROLE),
  } as SessionUser;
}

function asSuperadmin() {
  sessionActor.user = {
    id: "super-1",
    firstName: "Super",
    lastName: "Admin",
    role: SUPER_ADMIN_ROLE,
    schoolCode: "*",
    identifier: "super-1",
    permissions: ["ALL_PRIVILEGES"],
  } as SessionUser;
}

function asCountryAdmin() {
  sessionActor.user = {
    id: "pays-1",
    firstName: "Admin",
    lastName: "Pays",
    role: COUNTRY_ADMIN_ROLE,
    schoolCode: "*",
    countryScope: "CD",
    identifier: "pays-1",
    permissions: ["Utilisateurs:READ", "Établissements:READ"],
  } as SessionUser;
}

function renderUsersTree(path: string, { bootstrap = true }: { bootstrap?: boolean } = {}) {
  return render(
    <DataProvider>
      <MemoryRouter initialEntries={[path]}>
        {bootstrap ? <DomainRouteBootstrap /> : null}
        <Topbar title="Comptes utilisateurs" />
        <Routes>
          <Route path="/etablissement/comptes-utilisateurs" element={<UsersPage />} />
          <Route path="/administration/utilisateurs" element={<UsersPage />} />
        </Routes>
      </MemoryRouter>
    </DataProvider>,
  );
}

describe("UsersPage — hydratation / hard refresh (RED)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    store.holdUsers = null;
    seedSchoolAUsers();
    asSchoolAdmin();
    apiGetMock.mockReset();
    apiGetMock.mockImplementation(async (path: string) => {
      const url = String(path);
      if (url === "/backoffice/users") {
        if (store.holdUsers) await store.holdUsers.promise;
        return store.users;
      }
      if (url === "/backoffice/contacts") return store.contacts;
      if (url === "/establishments" || url.startsWith("/backoffice/establishments")) {
        return store.schools;
      }
      return [];
    });
  });

  it("contrat source : UsersPage doit demander explicitement le domaine users", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "UsersPage.tsx"), "utf8");
    expect(source).toContain("useData()");
    expect(source).toContain("projectScopedUsers");
    const asksUsersDomain =
      /ensureDomains\s*\(\s*\[[^\]]*"users"/.test(source) || /refresh\s*\(\s*\[[^\]]*"users"/.test(source);
    expect(asksUsersDomain).toBe(true);
  });

  it("ouverture directe /etablissement/comptes-utilisateurs demande GET /backoffice/users", async () => {
    renderUsersTree("/etablissement/comptes-utilisateurs");

    await waitFor(() => {
      expect(usersGetCalls()).toBeGreaterThanOrEqual(1);
    });
  });

  it("hard refresh DataProvider : loadedDomains vide + users [] puis comptes du tenant visibles", async () => {
    const first = renderUsersTree("/etablissement/comptes-utilisateurs");
    await waitFor(() => {
      expect(screen.getByText(`${USER_COUNT_A} compte(s) accessibles.`)).toBeInTheDocument();
      expect(screen.getByText("Prenom00001 Alpha")).toBeInTheDocument();
    });
    first.unmount();

    const second = renderUsersTree("/etablissement/comptes-utilisateurs");
    await waitFor(() => {
      expect(screen.getByText(`${USER_COUNT_A} compte(s) accessibles.`)).toBeInTheDocument();
      expect(screen.getByText("Prenom00001 Alpha")).toBeInTheDocument();
    });
    second.unmount();
  });

  it("bouton Rafraîchir recharge users même si aucun domaine n'est encore marqué chargé", async () => {
    renderUsersTree("/etablissement/comptes-utilisateurs", { bootstrap: false });

    expect(usersGetCalls()).toBe(0);
    expect(screen.getByText("0 compte(s) accessibles.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Rafraîchir les données" }));

    await waitFor(() => {
      expect(usersGetCalls()).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(`${USER_COUNT_A} compte(s) accessibles.`)).toBeInTheDocument();
    });
  });

  it("Admin établissement A : après hydratation, A visible, B jamais présenté", async () => {
    seedTwoTenants();
    renderUsersTree("/etablissement/comptes-utilisateurs");

    await waitFor(() => {
      expect(screen.getByText("Prenom00001 Alpha")).toBeInTheDocument();
    });
    expect(screen.queryByText("Leaked Echo")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden Kilo")).not.toBeInTheDocument();
  });

  it("hard refresh : ne pas figer 0 compte comme état métier avant la fin du chargement", async () => {
    store.holdUsers = deferred();
    renderUsersTree("/etablissement/comptes-utilisateurs");

    await waitFor(() => {
      expect(usersGetCalls()).toBeGreaterThanOrEqual(1);
    });

    expect(screen.queryByText("0 compte(s) accessibles.")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 compte\(s\) visible\(s\)/)).not.toBeInTheDocument();

    store.holdUsers.resolve();
    await waitFor(() => {
      expect(screen.getByText(`${USER_COUNT_A} compte(s) accessibles.`)).toBeInTheDocument();
    });
  });

  it("superadmin /administration/utilisateurs hydrate le domaine users sans casser la vue globale", async () => {
    seedTwoTenants();
    asSuperadmin();
    renderUsersTree("/administration/utilisateurs");

    await waitFor(() => {
      expect(usersGetCalls()).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/compte\(s\) plateforme/)).toBeInTheDocument();
    });
    expect(screen.getByText("Prenom00001 Alpha")).toBeInTheDocument();
    expect(screen.getByText("Leaked Echo")).toBeInTheDocument();
  });

  it("admin pays hydrate users sans casser la vue multi-établissement du pays", async () => {
    seedTwoTenants();
    asCountryAdmin();
    renderUsersTree("/administration/utilisateurs");

    await waitFor(() => {
      expect(usersGetCalls()).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/administrateur\(s\) d.établissement/)).toBeInTheDocument();
    });
    expect(screen.getByText("Prenom00001 Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Leaked Echo")).not.toBeInTheDocument();
  });
});
