import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionUser } from "../../types";
import { SCHOOL_ADMIN_ROLE } from "../../lib/orgHierarchy";
import { getInternalRoleDefaults } from "../../lib/internalRoleDefaults";
import { DOMAIN_KEYS } from "../../lib/domainLoaders";
import { domainsForPath } from "../../lib/routeDomainMap";
import { itemsForGrid, scopedSchoolFeeItems } from "../../lib/fees";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOGIN_A = "CD-IN-26-001";
const LOGIN_B = "BI-EC-26-001";
const LEFTOVER_A = "CD-2026-0001";
const LEFTOVER_B = "BI-2026-0001";
const CLASS_A = "1ère Primaire A";
const CLASS_ID_A = "class-a-1ere-primaire";
const ACADEMIC_YEAR = "2026-2027";
const GRID_A = "FEEGRID-A-1PA";
const GRID_B = "FEEGRID-B-6B";

type StoredGrid = {
  id: string;
  schoolId: string;
  schoolCode: string;
  classId: string;
  classCode: string;
  className: string;
  academicYear: string;
  periodName: string;
  currency: string;
  status: string;
};

type StoredItem = {
  id: string;
  feeGridId: string;
  schoolId: string;
  schoolCode: string;
  className: string;
  feeType: string;
  label: string;
  amount: number;
  mandatory: boolean;
  status: string;
};

const store = vi.hoisted(() => ({
  schools: [] as Record<string, unknown>[],
  students: [] as Record<string, unknown>[],
  feeGrids: [] as StoredGrid[],
  items: [] as StoredItem[],
  academicClassNames: ["1ère Primaire A"] as string[],
  seq: 0,
}));

const showToastMock = vi.hoisted(() => vi.fn());

const apiGetMock = vi.hoisted(() =>
  vi.fn(async (path: string): Promise<unknown> => {
    void path;
    return [];
  }),
);

const apiPostMock = vi.hoisted(() =>
  vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
    void path;
    void body;
    return {};
  }),
);

const apiPatchMock = vi.hoisted(() =>
  vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
    void path;
    void body;
    return {};
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

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: sessionActor.user,
      accessToken: "test-access-token",
      scope: { label: "Établissement", hint: sessionActor.user.schoolCode },
      permissions: sessionActor.user.permissions,
      academicConfigs: {
        [sessionActor.user.schoolCode]: {
          classNames: store.academicClassNames,
          academicYear: "2026-2027",
        },
      },
    },
    permissionsReady: true,
    logout: vi.fn(),
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: sessionActor.user,
    activeSchoolCode: sessionActor.user.schoolCode,
    activeSchool: {
      id: sessionActor.user.schoolId,
      code: sessionActor.user.schoolPublicCode,
      name:
        sessionActor.user.schoolId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
          ? "Complexe Scolaire Nuru"
          : "Ecole Bravo",
      currency: "CDF",
    },
    isSuperAdmin: false,
    ready: true,
  }),
}));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    getAccessToken: () => "test-access-token",
    api: {
      ...actual.api,
      get: (...args: unknown[]) => apiGetMock(...(args as [string])),
      post: (...args: unknown[]) => apiPostMock(...(args as [string, unknown])),
      patch: (...args: unknown[]) => apiPatchMock(...(args as [string, unknown])),
    },
  };
});

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock("../../components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn() }),
}));

import { DataProvider } from "../../context/DataContext";
import { DomainRouteBootstrap } from "../../components/DomainRouteBootstrap";
import { Topbar } from "../../components/layout/Topbar";
import { FinanceFeesPage } from "./FinanceFeesPage";

function actorSchoolId(): string {
  return String(sessionActor.user.schoolId ?? "");
}

function actorPublicCode(): string {
  return String(sessionActor.user.schoolPublicCode ?? "");
}

function asSchoolAdminA() {
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

function seedTenants() {
  store.schools = [
    {
      id: SCHOOL_ID_A,
      code: LOGIN_A,
      loginCode: LOGIN_A,
      schoolCode: LEFTOVER_A,
      name: "Complexe Scolaire Nuru",
      countryCode: "CD",
      currency: "CDF",
      status: "active",
    },
    {
      id: SCHOOL_ID_B,
      code: LOGIN_B,
      loginCode: LOGIN_B,
      schoolCode: LEFTOVER_B,
      name: "Ecole Bravo",
      countryCode: "BI",
      currency: "BIF",
      status: "active",
    },
  ];
  store.students = [];
  store.feeGrids = [];
  store.items = [];
  store.seq = 0;
  store.academicClassNames = [CLASS_A];
}

function mapItemForApi(item: StoredItem) {
  return {
    id: item.id,
    feeGridId: item.feeGridId,
    schoolId: item.schoolId,
    schoolCode: item.schoolCode,
    className: item.className,
    feeType: item.feeType,
    label: item.label,
    amount: item.amount,
    mandatory: item.mandatory,
    status: item.status,
  };
}

function tenantItems(schoolId: string, feeGridId?: string): StoredItem[] {
  return store.items.filter(
    (item) => item.schoolId === schoolId && (feeGridId ? item.feeGridId === feeGridId : true),
  );
}

function persistItemsFromPayload(
  grid: StoredGrid,
  payload: Record<string, unknown>,
) {
  const incoming = Array.isArray(payload.items) ? payload.items : [];
  store.items = store.items.filter((item) => item.feeGridId !== grid.id);
  for (const raw of incoming) {
    const row = (raw ?? {}) as Record<string, unknown>;
    store.seq += 1;
    store.items.push({
      id: String(row.id ?? `FEEITEM-${store.seq}`),
      feeGridId: grid.id,
      schoolId: grid.schoolId,
      schoolCode: grid.schoolCode,
      className: grid.className,
      feeType: String(row.feeType ?? "Inscription"),
      label: String(row.label ?? `Frais ${store.seq}`),
      amount: Number(row.amount ?? 0),
      mandatory: row.mandatory !== false,
      status: String(row.status ?? "Actif"),
    });
  }
}

function seedGridA(itemCount: number, options?: { itemGridId?: string; itemSchoolId?: string; itemSchoolCode?: string }) {
  store.feeGrids.push({
    id: GRID_A,
    schoolId: SCHOOL_ID_A,
    schoolCode: LOGIN_A,
    classId: CLASS_ID_A,
    classCode: "1PA",
    className: CLASS_A,
    academicYear: ACADEMIC_YEAR,
    periodName: "",
    currency: "CDF",
    status: "Brouillon",
  });
  for (let index = 1; index <= itemCount; index += 1) {
    store.seq += 1;
    store.items.push({
      id: `FEEITEM-A-${index}`,
      feeGridId: options?.itemGridId ?? GRID_A,
      schoolId: options?.itemSchoolId ?? SCHOOL_ID_A,
      schoolCode: options?.itemSchoolCode ?? LOGIN_A,
      className: CLASS_A,
      feeType: index === 1 ? "Inscription" : "Scolarité",
      label: index === 1 ? "Frais d'inscription" : "Minerval",
      amount: index === 1 ? 15000 : 45000,
      mandatory: true,
      status: "Actif",
    });
  }
}

function renderFeesTree({ bootstrap = true }: { bootstrap?: boolean } = {}) {
  return render(
    <DataProvider>
      <MemoryRouter initialEntries={["/finances/frais"]}>
        {bootstrap ? <DomainRouteBootstrap /> : null}
        <Topbar title="Frais & tarifs" />
        <Routes>
          <Route path="/finances/frais" element={<FinanceFeesPage />} />
        </Routes>
      </MemoryRouter>
    </DataProvider>,
  );
}

async function waitCatalogReady() {
  await waitFor(() => {
    expect(screen.queryByText("Chargement des tarifs…")).not.toBeInTheDocument();
  });
}

function fraisCountForClass(className: string): string {
  const table = screen.getByRole("table");
  const row = within(table)
    .getAllByRole("row")
    .find((candidate) => within(candidate).queryAllByRole("cell")[0]?.textContent === className);
  expect(row, `ligne de grille ${className}`).toBeTruthy();
  return within(row as HTMLElement).getAllByRole("cell")[4]?.textContent?.trim() ?? "";
}

async function expectFraisColumn(className: string, count: number) {
  await waitFor(() => {
    expect(screen.getByRole("table")).toHaveTextContent(className);
    expect(fraisCountForClass(className)).toBe(String(count));
  });
}

function schoolAdminPermissionCtx() {
  return {
    user: sessionActor.user,
    rolePermissions: {},
  };
}

describe("FinanceFeesPage — colonne Frais vs schoolFeeItems (RED)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    showToastMock.mockReset();
    seedTenants();
    asSchoolAdminA();
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    apiPatchMock.mockReset();

    apiGetMock.mockImplementation(async (path: string) => {
      const url = String(path).split("?")[0];
      if (url.endsWith("/academic-config")) {
        return {
          schoolCode: sessionActor.user.schoolCode,
          classNames: [CLASS_A],
          academicYear: ACADEMIC_YEAR,
        };
      }
      if (url === "/finance/catalog") {
        return {
          currency: "CDF",
          currencySource: "school",
          paymentMethods: [],
          feeTypes: [],
          canonicalFeeTypes: [
            { feeType: "Inscription", label: "Inscription", active: true },
            { feeType: "Scolarité", label: "Scolarité", active: true },
            { feeType: "Autre", label: "Autre", active: true },
          ],
          feeTypeCatalog: [
            { code: "INS", feeType: "Inscription", label: "Inscription", active: true },
            { code: "SCO", feeType: "Scolarité", label: "Scolarité", active: true },
            { code: "AUT", feeType: "Autre", label: "Autre", active: true },
          ],
          discountsDeferred: true,
          penaltiesDeferred: true,
        };
      }
      if (url === "/finance/fee-grids") {
        return store.feeGrids
          .filter((grid) => grid.schoolId === actorSchoolId())
          .map((grid) => ({ ...grid, schoolCode: actorPublicCode() }));
      }
      const gridDetail = url.match(/^\/finance\/fee-grids\/([^/]+)$/);
      if (gridDetail) {
        const gridId = decodeURIComponent(gridDetail[1]);
        const grid = store.feeGrids.find((row) => row.id === gridId && row.schoolId === actorSchoolId());
        if (!grid) return { grid: null, items: [] };
        return {
          grid: { ...grid, schoolCode: actorPublicCode() },
          items: tenantItems(actorSchoolId(), grid.id).map(mapItemForApi),
        };
      }
      if (url === "/finance/school-fee-items") {
        return tenantItems(actorSchoolId()).map(mapItemForApi);
      }
      if (url === "/finance/student-fees" || url === "/payments" || url === "/finance/payment-statuses") {
        return [];
      }
      if (url === "/students") return [];
      if (url === "/backoffice/establishments") return store.schools;
      if (url.startsWith("/backoffice/establishments/")) {
        const code = decodeURIComponent(url.slice("/backoffice/establishments/".length)).toUpperCase();
        return (
          store.schools.find(
            (school) =>
              String(school.code).toUpperCase() === code ||
              String(school.loginCode).toUpperCase() === code ||
              String(school.schoolCode).toUpperCase() === code,
          ) ?? {}
        );
      }
      return [];
    });

    apiPostMock.mockImplementation(async (path: string, body?: unknown) => {
      const url = String(path).split("?")[0];
      if (url !== "/finance/fee-grids") return {};
      const payload = (body ?? {}) as Record<string, unknown>;
      store.seq += 1;
      const created: StoredGrid = {
        id: `FEEGRID-${store.seq}`,
        schoolId: actorSchoolId(),
        schoolCode: actorPublicCode(),
        classId: String(payload.classId ?? CLASS_ID_A),
        classCode: String(payload.classCode ?? "1PA"),
        className: String(payload.className ?? CLASS_A),
        academicYear: String(payload.academicYear ?? ACADEMIC_YEAR),
        periodName: String(payload.periodName ?? ""),
        currency: String(payload.currency ?? "CDF"),
        status: "Brouillon",
      };
      store.feeGrids.push(created);
      persistItemsFromPayload(created, payload);
      return created;
    });

    apiPatchMock.mockImplementation(async (path: string, body?: unknown) => {
      const url = String(path).split("?")[0];
      const match = url.match(/^\/finance\/fee-grids\/([^/]+)$/);
      if (!match) return {};
      const gridId = decodeURIComponent(match[1]);
      const grid = store.feeGrids.find((row) => row.id === gridId && row.schoolId === actorSchoolId());
      if (!grid) return {};
      persistItemsFromPayload(grid, (body ?? {}) as Record<string, unknown>);
      return grid;
    });
  });

  it("contrat domaine : /finances/frais doit hydrater schoolFeeItems, pas seulement feeGrids", () => {
    expect(DOMAIN_KEYS).toContain("schoolFeeItems");
    expect(domainsForPath("/finances/frais", schoolAdminPermissionCtx())).toContain("schoolFeeItems");
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "FinanceFeesPage.tsx"), "utf8");
    expect(source).toContain('header: "Frais"');
    expect(source).toContain("itemsForGrid");
    const reloadsItems =
      /refresh\s*\(\s*\[[^\]]*"schoolFeeItems"/.test(source) ||
      /ensureDomains\s*\(\s*\[[^\]]*"schoolFeeItems"/.test(source) ||
      /refresh\s*\(\s*\[[^\]]*"feeGrids"[^\]]*"schoolFeeItems"/.test(source);
    expect(reloadsItems).toBe(true);
  });

  it("grille avec 2 items API → colonne Frais = 2", async () => {
    seedGridA(2);
    renderFeesTree();
    await waitCatalogReady();
    await expectFraisColumn(CLASS_A, 2);
  });

  it("grille sans item → colonne Frais = 0", async () => {
    seedGridA(0);
    renderFeesTree();
    await waitCatalogReady();
    await expectFraisColumn(CLASS_A, 0);
  });

  it("remount / F5 : le compteur reste celui des schoolFeeItems API", async () => {
    seedGridA(2);
    const first = renderFeesTree();
    await waitCatalogReady();
    await expectFraisColumn(CLASS_A, 2);
    first.unmount();

    renderFeesTree();
    await waitCatalogReady();
    await expectFraisColumn(CLASS_A, 2);
  });

  it("bouton Rafraîchir recharge feeGrids et schoolFeeItems", async () => {
    seedGridA(2);
    renderFeesTree();
    await waitCatalogReady();
    await expectFraisColumn(CLASS_A, 2);

    store.items.push({
      id: "FEEITEM-A-3",
      feeGridId: GRID_A,
      schoolId: SCHOOL_ID_A,
      schoolCode: LOGIN_A,
      className: CLASS_A,
      feeType: "Autre",
      label: "Uniforme",
      amount: 8000,
      mandatory: true,
      status: "Actif",
    });

    await userEvent.click(screen.getByRole("button", { name: "Rafraîchir les données" }));
    await expectFraisColumn(CLASS_A, 3);
  });

  it("après ajout d'une ligne, le compteur reflète l'API (2)", async () => {
    seedGridA(1);
    renderFeesTree();
    await waitCatalogReady();
    await expectFraisColumn(CLASS_A, 1);

    await userEvent.click(within(screen.getByRole("table")).getByText(CLASS_A));
    await userEvent.click(await screen.findByRole("button", { name: "Modifier" }));
    const dialog = await screen.findByRole("dialog", { name: /Modifier la grille/i });
    await userEvent.click(within(dialog).getByRole("button", { name: "Ajouter une ligne" }));
    const amountInputs = within(dialog).getAllByLabelText(/^Montant/i);
    await userEvent.clear(amountInputs[1]);
    await userEvent.type(amountInputs[1], "45000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      expect(tenantItems(SCHOOL_ID_A, GRID_A)).toHaveLength(2);
    });
    await expectFraisColumn(CLASS_A, 2);
  });

  it("même schoolId, leftover JWT ≠ login_code item → items comptés", async () => {
    seedGridA(2, { itemSchoolCode: LOGIN_A });
    expect(sessionActor.user.schoolCode).toBe(LEFTOVER_A);
    expect(sessionActor.user.schoolCode).not.toBe(LOGIN_A);
    renderFeesTree();
    await waitCatalogReady();
    await expectFraisColumn(CLASS_A, 2);
  });

  it("autre schoolId → jamais compté, même si feeGridId et code alias collent", async () => {
    seedGridA(2);
    store.items.push({
      id: "FEEITEM-SPOOF-B",
      feeGridId: GRID_A,
      schoolId: SCHOOL_ID_B,
      schoolCode: LOGIN_A,
      className: CLASS_A,
      feeType: "Inscription",
      label: "Spoof B",
      amount: 1,
      mandatory: true,
      status: "Actif",
    });
    renderFeesTree();
    await waitCatalogReady();
    await expectFraisColumn(CLASS_A, 2);
  });

  it("feeGridId différent → jamais compté", async () => {
    seedGridA(2, { itemGridId: GRID_B });
    store.feeGrids.push({
      id: GRID_B,
      schoolId: SCHOOL_ID_B,
      schoolCode: LOGIN_B,
      classId: "class-b",
      classCode: "6B",
      className: "6ème Bravo",
      academicYear: ACADEMIC_YEAR,
      periodName: "",
      currency: "BIF",
      status: "Brouillon",
    });
    renderFeesTree();
    await waitCatalogReady();
    await expectFraisColumn(CLASS_A, 0);
  });

  it("invariant : N items API du tenant+grille → UI affiche N", async () => {
    seedGridA(2);
    const apiItems = tenantItems(SCHOOL_ID_A, GRID_A);
    expect(apiItems).toHaveLength(2);
    expect(itemsForGrid(apiItems as never, GRID_A)).toHaveLength(2);
    expect(
      scopedSchoolFeeItems(sessionActor.user, {
        schoolFeeItems: [
          ...apiItems,
          {
            id: "FEEITEM-B",
            feeGridId: GRID_A,
            schoolId: SCHOOL_ID_B,
            schoolCode: LOGIN_B,
            className: CLASS_A,
            feeType: "Inscription",
            label: "Étranger",
            amount: 1,
            mandatory: true,
            status: "Actif",
          },
        ],
      } as never),
    ).toHaveLength(2);

    renderFeesTree();
    await waitCatalogReady();
    await expectFraisColumn(CLASS_A, apiItems.length);
  });
});
