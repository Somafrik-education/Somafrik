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
import { scopedFeeGrids } from "../../lib/fees";
import { ApiError } from "../../api/client";
import { financeApi } from "../../lib/financeApi";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOGIN_A = "CD-IN-26-001";
const LOGIN_B = "BI-EC-26-001";
const LEFTOVER_A = "CD-2026-0001";
const LEFTOVER_B = "BI-2026-0001";
const CLASS_A = "1ère Primaire A";
const CLASS_ID_A = "class-a-1ere-primaire";
const ACADEMIC_YEAR = "2026-2027";

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

const store = vi.hoisted(() => ({
  schools: [] as Record<string, unknown>[],
  students: [] as Record<string, unknown>[],
  feeGrids: [] as StoredGrid[],
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

function normalizeKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

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

function asSchoolAdminB() {
  sessionActor.user = {
    id: "admin-bravo",
    firstName: "Admin",
    lastName: "Bravo",
    role: SCHOOL_ADMIN_ROLE,
    schoolCode: LEFTOVER_B,
    schoolPublicCode: LOGIN_B,
    schoolId: SCHOOL_ID_B,
    identifier: "admin-bravo",
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
  store.students = [
    {
      id: "st-a-1",
      schoolId: SCHOOL_ID_A,
      schoolCode: LEFTOVER_A,
      className: CLASS_A,
      firstName: "Eleve",
      lastName: "Alpha",
      studentCode: `${LOGIN_A}-ELV-00001`,
    },
    {
      id: "st-b-1",
      schoolId: SCHOOL_ID_B,
      schoolCode: LEFTOVER_B,
      className: "6ème Bravo",
      firstName: "Eleve",
      lastName: "Bravo",
      studentCode: `${LOGIN_B}-ELV-00001`,
    },
  ];
  store.feeGrids = [];
  store.seq = 0;
  store.academicClassNames = [CLASS_A];
}

function feeGridGetCalls(): number {
  return apiGetMock.mock.calls.filter(([path]) => String(path) === "/finance/fee-grids").length;
}

function feeGridPostCalls(): number {
  return apiPostMock.mock.calls.filter(([path]) => String(path) === "/finance/fee-grids").length;
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

function expectReferentialShowsCreatedGrid() {
  expect(screen.queryByText("Aucun tarif défini")).not.toBeInTheDocument();
  expect(screen.getByRole("table")).toHaveTextContent(CLASS_A);
}

async function waitCatalogReady() {
  await waitFor(() => {
    expect(screen.queryByText("Chargement des tarifs…")).not.toBeInTheDocument();
  });
}

async function createGridViaUi(className = CLASS_A, amount = "15000") {
  await waitCatalogReady();
  await userEvent.click(screen.getAllByRole("button", { name: "Nouvelle grille" })[0]);
  const dialog = await screen.findByRole("dialog", { name: /Nouvelle grille tarifaire/i });
  await waitFor(() => {
    expect(within(dialog).getByRole("option", { name: className })).toBeInTheDocument();
  });
  const classSelect = within(dialog).getByLabelText(/^Classe/i);
  await userEvent.selectOptions(classSelect, className);
  const amountInput = within(dialog).getByLabelText(/^Montant/i);
  await userEvent.clear(amountInput);
  await userEvent.type(amountInput, amount);
  await userEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
}

describe("FinanceFeesPage — création grille vs lecture (RED)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    showToastMock.mockReset();
    seedTenants();
    asSchoolAdminA();
    apiGetMock.mockReset();
    apiPostMock.mockReset();

    apiGetMock.mockImplementation(async (path: string) => {
      const url = String(path).split("?")[0];
      if (url.endsWith("/academic-config")) {
        return {
          schoolCode: sessionActor.user.schoolCode,
          classNames: actorSchoolId() === SCHOOL_ID_A ? [CLASS_A] : ["6ème Bravo"],
          academicYear: ACADEMIC_YEAR,
        };
      }
      if (url === "/finance/catalog") {
        return {
          currency: "CDF",
          currencySource: "school",
          paymentMethods: [],
          feeTypes: [],
          canonicalFeeTypes: [{ feeType: "Inscription", label: "Inscription", active: true }],
          feeTypeCatalog: [{ code: "INS", feeType: "Inscription", label: "Inscription", active: true }],
          discountsDeferred: true,
          penaltiesDeferred: true,
        };
      }
      if (url === "/finance/fee-grids") {
        return store.feeGrids
          .filter((grid) => grid.schoolId === actorSchoolId())
          .map((grid) => ({ ...grid, schoolCode: actorPublicCode() }));
      }
      if (url === "/finance/student-fees" || url === "/payments" || url === "/finance/payment-statuses") {
        return [];
      }
      if (url === "/students") {
        return store.students.filter((row) => row.schoolId === actorSchoolId());
      }
      if (url === "/backoffice/establishments") {
        return store.schools;
      }
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
      const className = String(payload.className ?? "").trim();
      const academicYear = String(payload.academicYear ?? "").trim();
      const periodName = String(payload.periodName ?? "").trim();
      const duplicate = store.feeGrids.find(
        (grid) =>
          grid.schoolId === actorSchoolId() &&
          normalizeKey(grid.className) === normalizeKey(className) &&
          normalizeKey(grid.academicYear) === normalizeKey(academicYear) &&
          normalizeKey(grid.periodName) === normalizeKey(periodName),
      );
      if (duplicate) {
        throw new ApiError(
          "Une grille existe déjà pour cette classe et cette année.",
          409,
          "FEE_GRID_DUPLICATE",
        );
      }
      store.seq += 1;
      const created: StoredGrid = {
        id: `FEEGRID-${store.seq}`,
        schoolId: actorSchoolId(),
        schoolCode: actorPublicCode(),
        classId: String(payload.classId ?? CLASS_ID_A),
        classCode: String(payload.classCode ?? "1PA"),
        className,
        academicYear,
        periodName,
        currency: String(payload.currency ?? "CDF"),
        status: "Brouillon",
      };
      store.feeGrids.push(created);
      return created;
    });
  });

  it("contrat source : après création, FinanceFeesPage doit recharger le domaine feeGrids", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "FinanceFeesPage.tsx"), "utf8");
    expect(source).toContain("financeApi.createFeeGrid");
    expect(source).toContain("useData()");
    const reloadsFeeGrids =
      /refresh\s*\(\s*\[[^\]]*"feeGrids"/.test(source) ||
      /ensureDomains\s*\(\s*\[[^\]]*"feeGrids"/.test(source);
    expect(reloadsFeeGrids).toBe(true);
  });

  it("projection scopedFeeGrids : leftover JWT doit voir les grilles émises en login_code", () => {
    const rows = scopedFeeGrids(sessionActor.user, {
      feeGrids: [
        {
          id: "FEEGRID-1",
          schoolId: SCHOOL_ID_A,
          schoolCode: LOGIN_A,
          classId: CLASS_ID_A,
          classCode: "1PA",
          className: CLASS_A,
          academicYear: ACADEMIC_YEAR,
          currency: "CDF",
          status: "Brouillon",
        },
      ],
    } as never);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.className).toBe(CLASS_A);
  });

  it("création d'une grille pour 1ère Primaire A : succès API puis visibilité dans le référentiel", async () => {
    renderFeesTree();
    await createGridViaUi();

    await waitFor(() => {
      expect(feeGridPostCalls()).toBeGreaterThanOrEqual(1);
      expect(store.feeGrids.some((grid) => grid.className === CLASS_A)).toBe(true);
    });

    await waitFor(() => {
      expectReferentialShowsCreatedGrid();
    });
  });

  it("POST réussi + GET liste cohérente : la recréation 409 n'est possible que si la grille est visible", async () => {
    renderFeesTree();
    await createGridViaUi();

    await waitFor(() => {
      expect(store.feeGrids).toHaveLength(1);
    });

    const listed = await financeApi.listFeeGrids();
    expect(listed.some((grid) => grid.className === CLASS_A)).toBe(true);

    await createGridViaUi();
    await waitFor(() => {
      expect(showToastMock.mock.calls.some((call) => /existe déjà/i.test(String(call[0])))).toBe(true);
    });
    expect(store.feeGrids).toHaveLength(1);
    expectReferentialShowsCreatedGrid();
  });

  it("après création, remount DataProvider : la grille reste visible", async () => {
    const first = renderFeesTree();
    await createGridViaUi();
    await waitFor(() => {
      expect(store.feeGrids).toHaveLength(1);
    });
    first.unmount();

    const second = renderFeesTree();
    await waitCatalogReady();
    await waitFor(() => {
      expect(feeGridGetCalls()).toBeGreaterThanOrEqual(1);
      expectReferentialShowsCreatedGrid();
    });
    second.unmount();
  });

  it("bouton Rafraîchir recharge feeGrids et affiche la grille créée", async () => {
    renderFeesTree();
    await createGridViaUi();
    await waitFor(() => {
      expect(store.feeGrids).toHaveLength(1);
    });
    const getsAfterCreate = feeGridGetCalls();

    await userEvent.click(screen.getByRole("button", { name: "Rafraîchir les données" }));

    await waitFor(() => {
      expect(feeGridGetCalls()).toBeGreaterThan(getsAfterCreate);
      expectReferentialShowsCreatedGrid();
    });
  });

  it("Rafraîchir sans DomainRouteBootstrap recharge quand même feeGrids", async () => {
    renderFeesTree({ bootstrap: false });
    await createGridViaUi();
    await waitFor(() => {
      expect(store.feeGrids).toHaveLength(1);
    });
    const getsAfterCreate = feeGridGetCalls();

    await userEvent.click(screen.getByRole("button", { name: "Rafraîchir les données" }));

    await waitFor(() => {
      expect(feeGridGetCalls()).toBeGreaterThan(getsAfterCreate);
      expectReferentialShowsCreatedGrid();
    });
  });

  it("filtre classe A : la grille créée n'est pas masquée par classId/classCode/schoolId", async () => {
    renderFeesTree();
    await createGridViaUi();
    await waitFor(() => {
      expect(store.feeGrids[0]?.className).toBe(CLASS_A);
    });

    const filter = screen.getByLabelText(/Filtrer par classe/i);
    await userEvent.selectOptions(filter, CLASS_A);

    await waitFor(() => {
      expectReferentialShowsCreatedGrid();
    });
  });

  it("année scolaire active et filtre Toutes : la grille créée reste visible", async () => {
    renderFeesTree();
    await createGridViaUi();
    await waitFor(() => {
      expect(store.feeGrids[0]?.academicYear).toBe(ACADEMIC_YEAR);
    });

    await waitFor(() => {
      expectReferentialShowsCreatedGrid();
    });
    expect(screen.getByRole("table")).toHaveTextContent(ACADEMIC_YEAR);

    const yearFilter = screen.getByLabelText(/Année scolaire/i);
    await userEvent.selectOptions(yearFilter, "");
    expectReferentialShowsCreatedGrid();
    await userEvent.selectOptions(yearFilter, ACADEMIC_YEAR);
    expectReferentialShowsCreatedGrid();
  });

  it("isolation tenant : établissement B ne voit jamais la grille de A", async () => {
    store.feeGrids.push({
      id: "FEEGRID-LEAK",
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
    asSchoolAdminB();
    store.academicClassNames = ["6ème Bravo"];
    renderFeesTree();
    await waitCatalogReady();

    await waitFor(() => {
      expect(feeGridGetCalls()).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: CLASS_A })).not.toBeInTheDocument();
    expect(screen.queryByText("Complexe Scolaire Nuru")).not.toBeInTheDocument();
  });

  it("invariance : si la recréation est refusée (grille existante), la première grille est lisible dans le même périmètre", async () => {
    renderFeesTree();
    await createGridViaUi();
    await waitFor(() => {
      expect(store.feeGrids).toHaveLength(1);
    });

    const listed = await financeApi.listFeeGrids();
    expect(listed).toHaveLength(1);

    await createGridViaUi();
    await waitFor(() => {
      expect(showToastMock.mock.calls.some((call) => /existe déjà/i.test(String(call[0])))).toBe(true);
    });

    expect(listed[0]?.className).toBe(CLASS_A);
    expectReferentialShowsCreatedGrid();
  });
});
