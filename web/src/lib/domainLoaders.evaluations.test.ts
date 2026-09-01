import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
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
vi.mock("./establishmentsApi", () => ({ establishmentsApi: { list: vi.fn() } }));
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
vi.mock("./studentsApi", () => ({ studentsApi: { list: vi.fn() } }));
vi.mock("./teachersApi", () => ({ teachersApi: { list: vi.fn() } }));

vi.mock("./pedagogyApi", () => ({
  pedagogyApi: {
    listCourses: vi.fn(),
    listCourseSchedules: vi.fn(),
    listEvaluations: vi.fn(),
  },
}));

import { pedagogyApi } from "./pedagogyApi";
import { DOMAIN_KEYS, loadDomains } from "./domainLoaders";

describe("loadDomains — evaluations", () => {
  beforeEach(() => {
    vi.mocked(pedagogyApi.listEvaluations).mockReset();
  });

  it("possède le domaine evaluations et lit GET /evaluations, pas GET /notes", async () => {
    expect(DOMAIN_KEYS).toContain("evaluations");
    vi.mocked(pedagogyApi.listEvaluations).mockResolvedValue([
      {
        id: "EVAL-1",
        title: "Interrogation 1",
        period: "Trimestre 1",
        subject: "Mathématiques",
        className: "2ème A",
      },
    ]);

    const result = await loadDomains(["evaluations"]);

    expect(pedagogyApi.listEvaluations).toHaveBeenCalledTimes(1);
    expect(result.loaded).toEqual(["evaluations"]);
    expect(result.data.evaluations).toEqual([
      expect.objectContaining({ title: "Interrogation 1", period: "Trimestre 1" }),
    ]);
  });
});
