import { describe, expect, it, vi, beforeEach } from "vitest";
import type { UserAccount } from "../types";
import {
  ACCESS_ROLES_NONE_LABEL,
  BUSINESS_PROFILE_KIND_LABELS,
  formatAccessRolesDisplay,
  formatBusinessProfileKind,
} from "./userAccounts";
import { applyClientScopeToState } from "./scope";
import { clientsApi } from "./clientsApi";
import { loadDomains } from "./domainLoaders";

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

const listUsers = vi.mocked(clientsApi.listUsers);

/** Payload GET /backoffice/users tel que le Web le consomme (clientsApi.listUsers). */
const captureUnassigned: UserAccount = {
  id: "user-capture",
  publicId: "CD-ITS-MR-26-00099",
  firstName: "Test",
  lastName: "Nouveau",
  accountKind: "unassigned",
  businessProfileLabel: "Sans affectation",
  linkedStudent: null,
  linkedTeacher: null,
  roleKeys: [],
  roles: [],
  role: "Sans affectation",
  assignmentStatus: "Sans affectation",
};

const apiStudentLoginEmptyAccess: UserAccount = {
  id: "user-student",
  publicId: "CD-ITS-MR-26-00003",
  firstName: "Marc",
  lastName: "Rumba",
  accountKind: "student_login",
  businessProfileLabel: "Compte lié à un élève",
  linkedStudent: { studentId: "stu-1", studentCode: "CD-ITS-MR-26-00003", status: "active" },
  linkedTeacher: null,
  roleKeys: [],
  roles: [],
  role: "Sans affectation",
  assignmentStatus: "Sans affectation",
};

/** W5 — UUID lié, codes divergents (user identifier ≠ studentCode). */
const apiStudentLoginDivergedCodes: UserAccount = {
  id: "user-student-div",
  publicId: "CD-ITS-MR-26-00099",
  identifier: "CD-ITS-MR-26-00099",
  firstName: "Marc",
  lastName: "Rumba",
  accountKind: "student_login",
  businessProfileLabel: "Compte lié à un élève",
  linkedStudent: {
    studentId: "22222222-2222-4222-8222-222222222222",
    studentCode: "CD-ITS-MR-26-00003",
    status: "active",
  },
  linkedTeacher: null,
  roleKeys: [],
  roles: [],
  role: "",
  assignmentStatus: "",
};

describe("#514 web-runtime — GET /backoffice/users → formatters UsersPage", () => {
  it("capture préprod : payload unassigned → Type métier Sans affectation (fidèle à l'API)", () => {
    expect(formatBusinessProfileKind(captureUnassigned)).toBe(BUSINESS_PROFILE_KIND_LABELS.unassigned);
    expect(formatAccessRolesDisplay(captureUnassigned)).toBe(ACCESS_ROLES_NONE_LABEL);
  });

  it("payload student_login + roleKeys=[] → Type métier élève, jamais Sans affectation", () => {
    expect(formatBusinessProfileKind(apiStudentLoginEmptyAccess)).toBe(
      BUSINESS_PROFILE_KIND_LABELS.student_login,
    );
    expect(formatAccessRolesDisplay(apiStudentLoginEmptyAccess)).toBe("Élève / Étudiant");
    expect(formatBusinessProfileKind(apiStudentLoginEmptyAccess)).not.toBe("Sans affectation");
  });
});

describe("#514 web-runtime — domainLoaders + scope ne jettent pas le profil métier", () => {
  beforeEach(() => {
    listUsers.mockReset();
  });

  it("loadDomains(['users']) conserve accountKind / linkedStudent / businessProfileLabel", async () => {
    listUsers.mockResolvedValue([apiStudentLoginEmptyAccess]);
    const result = await loadDomains(["users"]);
    const row = result.data.users?.[0] as UserAccount;
    expect(row.accountKind).toBe("student_login");
    expect(row.linkedStudent?.studentCode).toBe("CD-ITS-MR-26-00003");
    expect(row.businessProfileLabel).toBe("Compte lié à un élève");
    expect(row.roleKeys).toEqual([]);
    expect(formatBusinessProfileKind(row)).toBe("Compte lié à un élève");
  });

  it("W5 loadDomains : linkedStudent UUID conservé si studentCode ≠ identifier", async () => {
    listUsers.mockResolvedValue([apiStudentLoginDivergedCodes]);
    const result = await loadDomains(["users"]);
    const row = result.data.users?.[0] as UserAccount;
    expect(row.accountKind).toBe("student_login");
    expect(row.linkedStudent?.studentId).toBe("22222222-2222-4222-8222-222222222222");
    expect(row.linkedStudent?.studentCode).toBe("CD-ITS-MR-26-00003");
    expect(row.publicId).toBe("CD-ITS-MR-26-00099");
    expect(row.linkedStudent?.studentCode).not.toBe(row.publicId);
    expect(formatBusinessProfileKind(row)).toBe("Compte lié à un élève");
  });

  it("applyClientScopeToState SCHOOL_ADMIN conserve les champs métier", () => {
    const scoped = applyClientScopeToState(
      {
        users: [
          {
            ...apiStudentLoginEmptyAccess,
            schoolId: "school-nuru",
            schoolCode: "CD-IN-26-001",
            schoolPublicCode: "CD-IN-26-001",
            status: "Actif",
          },
        ],
        schools: [],
        countries: [],
        subscriptions: [],
        notifications: [],
        students: [],
      } as never,
      {
        id: "admin-nuru",
        role: "Admin School",
        schoolCode: "CD-2026-0001",
        schoolPublicCode: "CD-IN-26-001",
        schoolId: "school-nuru",
      } as never,
    );
    const row = scoped.users[0];
    expect(row.accountKind).toBe("student_login");
    expect(row.linkedStudent?.studentCode).toBe("CD-ITS-MR-26-00003");
    expect(formatBusinessProfileKind(row)).toBe("Compte lié à un élève");
  });
});
