import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  api: { get: vi.fn() },
  getAccessToken: () => "test-access-token",
}));

vi.mock("./clientsApi", () => ({
  clientsApi: {
    listUsers: vi.fn(),
    listContacts: vi.fn(),
    listRelations: vi.fn(),
    listMessages: vi.fn(),
    listAnnouncements: vi.fn(),
  },
}));
vi.mock("./establishmentsApi", () => ({
  establishmentsApi: { list: vi.fn(), get: vi.fn() },
}));
vi.mock("./platformApi", () => ({
  platformApi: {
    listCountries: vi.fn(),
    listSubscriptions: vi.fn(),
    listNotifications: vi.fn(),
    getRolePermissions: vi.fn(),
    getDashboardChartConfig: vi.fn(),
  },
}));
vi.mock("./classesApi", () => ({ classesApi: { list: vi.fn() } }));
vi.mock("./financeApi", () => ({
  financeApi: {
    listPayments: vi.fn(),
    listPaymentStatuses: vi.fn(),
    listFeeGrids: vi.fn(),
    listStudentFees: vi.fn(),
  },
}));
vi.mock("./pedagogyApi", () => ({
  pedagogyApi: { listCourses: vi.fn(), listCourseSchedules: vi.fn(), listEvaluations: vi.fn() },
}));
vi.mock("./studentsApi", () => ({ studentsApi: { list: vi.fn() } }));
vi.mock("./teachersApi", () => ({ teachersApi: { list: vi.fn() } }));

import { establishmentsApi } from "./establishmentsApi";
import { loadDomains, usesPlatformSchoolCatalog } from "./domainLoaders";
import { COUNTRY_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "./orgHierarchy";
import { scopedSchools } from "./scope";
import type { School, SessionUser } from "../types";

describe("loadDomains — schools tenant-scoped", () => {
  beforeEach(() => {
    vi.mocked(establishmentsApi.list).mockReset();
    vi.mocked(establishmentsApi.get).mockReset();
  });

  it("A/C. SCHOOL_ADMIN avec schoolCode → GET :code, jamais la liste globale", async () => {
    const own = { id: "school-a", code: "CD-2026-0001", name: "Nuru" };
    vi.mocked(establishmentsApi.get).mockResolvedValue(own as never);

    const result = await loadDomains(["schools"], {
      schoolCode: "CD-2026-0001",
      role: "Admin School",
    });

    expect(establishmentsApi.get).toHaveBeenCalledWith("CD-2026-0001");
    expect(establishmentsApi.list).not.toHaveBeenCalled();
    expect(result.data.schools).toEqual([own]);
    expect(result.data.schools).toHaveLength(1);
  });

  it("Superadmin + activeSchoolCode concret → list() et catalogue complet", async () => {
    expect(usesPlatformSchoolCatalog(SUPER_ADMIN_ROLE)).toBe(true);
    const catalog = [
      { code: "CD-2026-0001", name: "Nuru", countryCode: "CD" },
      { code: "BI-2026-0002", name: "Bujumbura", countryCode: "BI" },
      { code: "CD-EL-26-002", name: "Lumière", countryCode: "CD" },
    ] as School[];
    vi.mocked(establishmentsApi.list).mockResolvedValue(catalog as never);

    const result = await loadDomains(["schools"], {
      schoolCode: "CD-2026-0001",
      role: SUPER_ADMIN_ROLE,
    });

    expect(establishmentsApi.list).toHaveBeenCalledTimes(1);
    expect(establishmentsApi.get).not.toHaveBeenCalled();
    expect(result.data.schools).toEqual(catalog);
    expect(result.data.schools).toHaveLength(3);

    const selector = scopedSchools(
      { role: SUPER_ADMIN_ROLE, schoolCode: "*" } as SessionUser,
      {
        schools: result.data.schools ?? [],
        users: [],
        countries: [],
        subscriptions: [],
        notifications: [],
      },
    );
    expect(selector.map((school) => school.code)).toEqual([
      "CD-2026-0001",
      "BI-2026-0002",
      "CD-EL-26-002",
    ]);
  });

  it("Admin Pays + activeSchoolCode concret → list() dans son périmètre", async () => {
    expect(usesPlatformSchoolCatalog(COUNTRY_ADMIN_ROLE)).toBe(true);
    const catalog = [
      { code: "CD-2026-0001", name: "Nuru", countryCode: "CD", country: "RDC" },
      { code: "CD-EL-26-002", name: "Lumière", countryCode: "CD", country: "RDC" },
    ] as School[];
    vi.mocked(establishmentsApi.list).mockResolvedValue(catalog as never);

    const result = await loadDomains(["schools"], {
      schoolCode: "CD-2026-0001",
      role: COUNTRY_ADMIN_ROLE,
    });

    expect(establishmentsApi.list).toHaveBeenCalledTimes(1);
    expect(establishmentsApi.get).not.toHaveBeenCalled();
    expect(result.data.schools).toHaveLength(2);

    const selector = scopedSchools(
      { role: COUNTRY_ADMIN_ROLE, schoolCode: "*", countryScope: "CD" } as SessionUser,
      {
        schools: result.data.schools ?? [],
        users: [],
        countries: [],
        subscriptions: [],
        notifications: [],
      },
    );
    expect(selector).toHaveLength(2);
    expect(selector.some((school) => school.code === "CD-EL-26-002")).toBe(true);
  });
});
