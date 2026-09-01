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
import { loadDomains } from "./domainLoaders";

describe("loadDomains — schools tenant-scoped", () => {
  beforeEach(() => {
    vi.mocked(establishmentsApi.list).mockReset();
    vi.mocked(establishmentsApi.get).mockReset();
  });

  it("A/C. SCHOOL_ADMIN avec schoolCode → GET :code, jamais la liste globale", async () => {
    const own = { id: "school-a", code: "CD-2026-0001", name: "Nuru" };
    vi.mocked(establishmentsApi.get).mockResolvedValue(own as never);

    const result = await loadDomains(["schools"], { schoolCode: "CD-2026-0001" });

    expect(establishmentsApi.get).toHaveBeenCalledWith("CD-2026-0001");
    expect(establishmentsApi.list).not.toHaveBeenCalled();
    expect(result.data.schools).toEqual([own]);
    expect(result.data.schools).toHaveLength(1);
  });

  it("catalogue plateforme (super/pays) → list()", async () => {
    vi.mocked(establishmentsApi.list).mockResolvedValue([
      { code: "CD-2026-0001", name: "Nuru" },
      { code: "BI-2026-0002", name: "B" },
    ] as never);

    const result = await loadDomains(["schools"], { schoolCode: "*" });

    expect(establishmentsApi.list).toHaveBeenCalledTimes(1);
    expect(establishmentsApi.get).not.toHaveBeenCalled();
    expect(result.data.schools).toHaveLength(2);
  });
});
