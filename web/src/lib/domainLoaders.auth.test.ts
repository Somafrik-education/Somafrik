import { beforeEach, describe, expect, it, vi } from "vitest";

const getAccessToken = vi.hoisted(() => vi.fn((): string | null => "test-access-token"));

vi.mock("../api/client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    api: { get: vi.fn() },
    getAccessToken,
  };
});

vi.mock("./clientsApi", () => ({
  clientsApi: {
    listUsers: vi.fn(),
    listContacts: vi.fn(),
    listRelations: vi.fn(),
    listMessages: vi.fn(),
    listAnnouncements: vi.fn(),
  },
}));
vi.mock("./establishmentsApi", () => ({ establishmentsApi: { list: vi.fn(), get: vi.fn() } }));
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

describe("loadDomains — bootstrap auth (F, G)", () => {
  beforeEach(() => {
    getAccessToken.mockReset();
    getAccessToken.mockReturnValue("test-access-token");
    vi.mocked(clientsApi.listUsers).mockReset();
  });

  it("F. aucun fetch métier avant accessToken prêt", async () => {
    getAccessToken.mockReturnValue(null);
    const result = await loadDomains(["users", "contacts"]);

    expect(clientsApi.listUsers).not.toHaveBeenCalled();
    expect(result.loaded).toEqual([]);
    expect(result.data.users).toBeUndefined();
    expect(result.serverErrors).toHaveLength(2);
    expect(result.serverErrors[0]?.message).toMatch(/accessToken absent/i);
  });

  it("G. 401 n'est pas un succès vide", async () => {
    vi.mocked(clientsApi.listUsers).mockRejectedValue(new ApiError("Unauthorized", 401));
    const result = await loadDomains(["users"]);

    expect(result.loaded).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.data.users).toBeUndefined();
    expect(result.serverErrors).toEqual([
      expect.objectContaining({
        domain: "users",
        status: 401,
        message: expect.stringMatching(/session expirée/i),
      }),
    ]);
    expect(result.serverErrors[0]?.message).not.toMatch(/\b401\b|\b403\b|\b50[0-9]\b/);
  });

  it("G. 403 n'est pas un succès vide", async () => {
    vi.mocked(clientsApi.listUsers).mockRejectedValue(new ApiError("Forbidden", 403));
    const result = await loadDomains(["users"]);

    expect(result.loaded).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.data.users).toBeUndefined();
    expect(result.serverErrors).toEqual([
      expect.objectContaining({
        domain: "users",
        status: 403,
        message: expect.stringMatching(/accès refusé/i),
      }),
    ]);
    expect(result.serverErrors[0]?.message).not.toMatch(/\b401\b|\b403\b|\b50[0-9]\b/);
  });
});
