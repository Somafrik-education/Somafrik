import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  api: {
    get: vi.fn(),
  },
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
  establishmentsApi: { list: vi.fn() },
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

import { api } from "../api/client";
import { clientsApi } from "./clientsApi";
import { loadDomains } from "./domainLoaders";

const listUsers = vi.mocked(clientsApi.listUsers);
const getMock = vi.mocked(api.get);

describe("loadDomains — users", () => {
  beforeEach(() => {
    listUsers.mockReset();
    getMock.mockReset();
  });

  it("charge uniquement la projection users, sans lookup /schools/:code", async () => {
    listUsers.mockResolvedValue([
      {
        schoolCode: "CD-2026-0001",
        schoolPublicCode: "CD-IN-26-001",
        schoolName: "INSTITUT NURU",
      },
    ]);

    const result = await loadDomains(["users"]);

    expect(listUsers).toHaveBeenCalledTimes(1);
    expect(getMock).not.toHaveBeenCalled();
    expect(result.data.users).toHaveLength(1);
    expect(result.data.schools).toBeUndefined();
  });
});
