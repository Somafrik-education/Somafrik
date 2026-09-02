import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SessionUser } from "../types";
import { SCHOOL_ADMIN_ROLE } from "../lib/orgHierarchy";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOGIN_A = "CD-IN-26-001";
const LEFTOVER_A = "CD-2026-0001";

const store = vi.hoisted(() => ({
  students: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
}));

const apiGetMock = vi.hoisted(() =>
  vi.fn(async (path: string) => {
    if (path === "/students") return store.students;
    if (path === "/backoffice/users") return store.users;
    return [];
  }),
);

const schoolAdminUser = {
  id: "admin-nuru",
  firstName: "Admin",
  lastName: "Nuru",
  role: SCHOOL_ADMIN_ROLE,
  schoolCode: LEFTOVER_A,
  schoolPublicCode: LOGIN_A,
  schoolId: SCHOOL_ID_A,
  identifier: "admin-nuru",
} as SessionUser;

vi.mock("./AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: schoolAdminUser,
      accessToken: "test-access-token",
      scope: { label: "Établissement", hint: LEFTOVER_A },
    },
    permissionsReady: true,
  }),
}));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getAccessToken: () => "test-access-token",
    api: {
      ...actual.api,
      get: apiGetMock,
    },
  };
});

import { DataProvider, useData } from "./DataContext";

function pgStudent(index: number, overrides: Record<string, unknown> = {}) {
  const seq = String(index + 1).padStart(5, "0");
  return {
    id: `CD-IN-EL-26-${seq}`,
    publicId: `CD-IN-EL-26-${seq}`,
    studentCode: `CD-IN-EL-26-${seq}`,
    firstName: `Prenom${index + 1}`,
    lastName: `Nom${index + 1}`,
    name: `Prenom${index + 1} Nom${index + 1}`,
    className: "6ème A",
    schoolId: SCHOOL_ID_A,
    schoolCode: LOGIN_A,
    schoolPublicCode: LOGIN_A,
    status: "active",
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <DataProvider>{children}</DataProvider>;
}

describe("DataProvider — cycle de vie scopeError users vs students", () => {
  beforeEach(() => {
    localStorage.clear();
    apiGetMock.mockClear();
    store.users = [];
    store.students = [];
  });

  it("fuite students : refresh users propre ne l'efface pas ; refresh students propre la pose à null", async () => {
    store.students = [
      ...Array.from({ length: 14 }, (_, index) => pgStudent(index)),
      pgStudent(14, { schoolId: SCHOOL_ID_B, schoolCode: "BI-EC-26-001", schoolPublicCode: "BI-EC-26-001" }),
    ];

    const { result } = renderHook(() => useData(), { wrapper });

    await act(async () => {
      await result.current.ensureDomains(["students", "users"], { schoolCode: LEFTOVER_A });
    });

    await waitFor(() => {
      expect(result.current.state.students).toHaveLength(14);
      expect(result.current.scopeError).toEqual(expect.stringMatching(/autre établissement/i));
    });

    store.users = [
      {
        id: "u1",
        firstName: "Admin",
        lastName: "Nuru",
        role: SCHOOL_ADMIN_ROLE,
        schoolId: SCHOOL_ID_A,
        schoolCode: LOGIN_A,
        schoolPublicCode: LOGIN_A,
      },
    ];

    await act(async () => {
      await result.current.refresh(["users"], { schoolCode: LEFTOVER_A });
    });

    expect(result.current.scopeError).toEqual(expect.stringMatching(/autre établissement/i));
    expect(result.current.state.students).toHaveLength(14);
    expect(apiGetMock.mock.calls.some(([path]) => path === "/students")).toBe(true);
    const studentCallsAfterUsersRefresh = apiGetMock.mock.calls.filter(([path]) => path === "/students").length;
    expect(studentCallsAfterUsersRefresh).toBe(1);

    store.students = Array.from({ length: 15 }, (_, index) => pgStudent(index));

    await act(async () => {
      await result.current.refresh(["students"], { schoolCode: LEFTOVER_A });
    });

    await waitFor(() => {
      expect(result.current.state.students).toHaveLength(15);
      expect(result.current.scopeError).toBeNull();
    });
  });

  it("payload mixte 14+1 sans schoolId : alerte visible puis effacée uniquement par un GET students propre", async () => {
    store.students = [
      ...Array.from({ length: 14 }, (_, index) => pgStudent(index)),
      pgStudent(14, { schoolId: "" }),
    ];

    const { result } = renderHook(() => useData(), { wrapper });

    await act(async () => {
      await result.current.ensureDomains(["students"], { schoolCode: LEFTOVER_A });
    });

    await waitFor(() => {
      expect(result.current.state.students).toHaveLength(14);
      expect(result.current.scopeError).toEqual(expect.stringMatching(/schoolId/i));
    });

    await act(async () => {
      await result.current.refresh(["users"], { schoolCode: LEFTOVER_A });
    });

    expect(result.current.scopeError).toEqual(expect.stringMatching(/schoolId/i));
    expect(result.current.state.students).toHaveLength(14);

    store.students = Array.from({ length: 15 }, (_, index) => pgStudent(index));

    await act(async () => {
      await result.current.refresh(["students"], { schoolCode: LEFTOVER_A });
    });

    await waitFor(() => {
      expect(result.current.state.students).toHaveLength(15);
      expect(result.current.scopeError).toBeNull();
    });
  });
});
