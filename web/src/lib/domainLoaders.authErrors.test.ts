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
vi.mock("./pedagogyApi", () => ({
  pedagogyApi: { listCourses: vi.fn(), listCourseSchedules: vi.fn(), listEvaluations: vi.fn() },
}));
vi.mock("./studentsApi", () => ({ studentsApi: { list: vi.fn() } }));
vi.mock("./teachersApi", () => ({ teachersApi: { list: vi.fn() } }));

import { ApiError } from "../api/client";
import { clientsApi } from "./clientsApi";
import { loadDomains } from "./domainLoaders";

describe("loadDomains — 401/403 ne sont pas un succès vide", () => {
  beforeEach(() => {
    vi.mocked(clientsApi.listUsers).mockReset();
  });

  it("G — 401 users → serverError, pas loaded []", async () => {
    vi.mocked(clientsApi.listUsers).mockRejectedValue(new ApiError("Unauthorized", 401));
    const result = await loadDomains(["users"]);
    expect(result.loaded).toEqual([]);
    expect(result.data.users).toBeUndefined();
    expect(result.serverErrors).toEqual([
      expect.objectContaining({ domain: "users", message: expect.stringContaining("401") }),
    ]);
  });

  it("G — 403 users → serverError, pas skipped vide", async () => {
    vi.mocked(clientsApi.listUsers).mockRejectedValue(new ApiError("Forbidden", 403));
    const result = await loadDomains(["users"]);
    expect(result.loaded).toEqual([]);
    expect(result.skipped).not.toContain("users");
    expect(result.data.users).toBeUndefined();
    expect(result.serverErrors).toEqual([
      expect.objectContaining({ domain: "users", message: expect.stringContaining("403") }),
    ]);
  });
});
