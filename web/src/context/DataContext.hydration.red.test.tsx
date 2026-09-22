import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../types";
import { AuthProvider, useAuth } from "./AuthContext";
import { DataProvider, useData } from "./DataContext";
import { SCHOOL_ADMIN_ROLE } from "../lib/orgHierarchy";
import {
  SCHOOL_A,
  SCHOOL_ID_A,
  authHeader,
  collapseCounts,
  deferred,
  jsonResponse,
  neverDippedToZero,
  pathnameOf,
  pgStudent,
  pgUser,
} from "./hydrationRedTestUtils";

const STUDENT_COUNT = 12;

type FetchCtl = {
  access: string;
  refresh: string;
  expireAccess: boolean;
  students: Record<string, unknown>[];
  users: Record<string, unknown>[];
  holdStudents: ReturnType<typeof deferred> | null;
  captureStudentsAtStart: boolean;
  studentStatus: number;
  refreshStatus: number;
  refreshHold: ReturnType<typeof deferred> | null;
  refreshCalls: number;
  studentCalls: number;
};

const ctl: FetchCtl = {
  access: "access-1",
  refresh: "refresh-1",
  expireAccess: false,
  students: [],
  users: [],
  holdStudents: null,
  captureStudentsAtStart: true,
  studentStatus: 200,
  refreshStatus: 200,
  refreshHold: null,
  refreshCalls: 0,
  studentCalls: 0,
};

function resetCtl() {
  ctl.access = "access-1";
  ctl.refresh = "refresh-1";
  ctl.expireAccess = false;
  ctl.students = Array.from({ length: STUDENT_COUNT }, (_, index) => pgStudent(index));
  ctl.users = Array.from({ length: 3 }, (_, index) => pgUser(index));
  ctl.holdStudents = null;
  ctl.captureStudentsAtStart = true;
  ctl.studentStatus = 200;
  ctl.refreshStatus = 200;
  ctl.refreshHold = null;
  ctl.refreshCalls = 0;
  ctl.studentCalls = 0;
}

function schoolAdminSession(accessToken = ctl.access): Session {
  return {
    accessToken,
    refreshToken: ctl.refresh,
    permissions: [],
    scope: { label: "Établissement", hint: SCHOOL_A },
    user: {
      id: "admin-nuru",
      firstName: "Admin",
      lastName: "Nuru",
      identifier: "admin-nuru",
      role: SCHOOL_ADMIN_ROLE,
      schoolCode: SCHOOL_A,
      schoolPublicCode: SCHOOL_A,
      schoolId: SCHOOL_ID_A,
    },
  } as Session;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>{children}</DataProvider>
    </AuthProvider>
  );
}

function useHarness() {
  const auth = useAuth();
  const data = useData();
  return { auth, data };
}

const studentHistory: number[] = [];
const presentedEmptyHistory: boolean[] = [];

function useObservedHarness() {
  const harness = useHarness();
  studentHistory.push(harness.data.state.students.length);
  presentedEmptyHistory.push(
    harness.data.state.students.length === 0 && !harness.data.loading,
  );
  return harness;
}

function resetObservations() {
  studentHistory.length = 0;
  presentedEmptyHistory.length = 0;
}

async function loginAndLoadStudents() {
  const { result } = renderHook(() => useObservedHarness(), { wrapper });
  await act(async () => {
    result.current.auth.setSession(schoolAdminSession());
  });
  await waitFor(() => expect(result.current.auth.permissionsReady).toBe(true));
  await act(async () => {
    await result.current.data.ensureDomains(["students", "users"], { schoolCode: SCHOOL_A });
  });
  await waitFor(() => expect(result.current.data.state.students).toHaveLength(STUDENT_COUNT));
  return result;
}

function markBaselineLoaded() {
  const last = studentHistory[studentHistory.length - 1] ?? 0;
  resetObservations();
  studentHistory.push(last);
  presentedEmptyHistory.push(false);
}

describe("CHANTIER SYNC — Web DataContext / Auth (tests RED)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    resetCtl();
    resetObservations();
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const path = pathnameOf(url);
      const token = authHeader(init);

      if (path === "/auth/effective-permissions") {
        return jsonResponse({ permissions: [] });
      }
      if (path === "/auth/refresh") {
        ctl.refreshCalls += 1;
        if (ctl.refreshHold) await ctl.refreshHold.promise;
        if (ctl.refreshStatus !== 200) {
          return jsonResponse({ message: "refresh failed" }, ctl.refreshStatus);
        }
        ctl.access = "access-2";
        ctl.refresh = "refresh-2";
        ctl.expireAccess = false;
        return jsonResponse({ accessToken: ctl.access, refreshToken: ctl.refresh });
      }
      if (path === "/students") {
        ctl.studentCalls += 1;
        if (ctl.expireAccess && token.includes("access-1")) {
          return jsonResponse({ message: "Session expirée" }, 401);
        }
        if (ctl.studentStatus >= 500) {
          return jsonResponse({ message: "Erreur serveur" }, ctl.studentStatus);
        }
        const snapshot = ctl.captureStudentsAtStart ? [...ctl.students] : ctl.students;
        if (ctl.holdStudents) await ctl.holdStudents.promise;
        return jsonResponse(snapshot, 200);
      }
      if (path === "/backoffice/users") {
        return jsonResponse(ctl.users);
      }
      if (path.startsWith("/backoffice/establishments")) {
        return jsonResponse([]);
      }
      if (path.includes("academic-config")) {
        return jsonResponse({ schoolCode: SCHOOL_A, periodMode: "trimester" });
      }
      return jsonResponse([]);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("1. refresh JWT : les données déjà affichées ne repassent jamais à []", async () => {
    const result = await loginAndLoadStudents();
    markBaselineLoaded();
    expect(result.current.data.state.students).toHaveLength(STUDENT_COUNT);

    await act(async () => {
      result.current.auth.setSession(schoolAdminSession("access-rotated"));
    });

    await act(async () => {
      await result.current.data.ensureDomains(["students"], { schoolCode: SCHOOL_A });
    });
    await waitFor(() => expect(result.current.data.state.students.length).toBeGreaterThan(0));

    const transition = collapseCounts(studentHistory);
    expect(
      neverDippedToZero(studentHistory),
      `students ne doivent pas disparaître pendant une rotation JWT. Transition observée: ${transition}`,
    ).toBe(true);
  });

  it("6. erreur réseau pendant refresh : dernier snapshot valide conservé, jamais []", async () => {
    const result = await loginAndLoadStudents();
    markBaselineLoaded();
    ctl.studentStatus = 503;

    await act(async () => {
      await result.current.data.refresh(["students"], { schoolCode: SCHOOL_A }).catch(() => undefined);
    });

    const transition = collapseCounts(studentHistory);
    expect(
      result.current.data.state.students,
      `snapshot students conservé après 503. Transition: ${transition}`,
    ).toHaveLength(STUDENT_COUNT);
    expect(neverDippedToZero(studentHistory), `interdit students: ${transition}`).toBe(true);
    expect(result.current.data.error).toBeTruthy();
  });

  it("6b. rotation JWT puis 5xx : le snapshot précèdent ne doit pas rester []", async () => {
    const result = await loginAndLoadStudents();
    markBaselineLoaded();
    ctl.studentStatus = 503;

    await act(async () => {
      result.current.auth.setSession(schoolAdminSession("access-rotated"));
    });

    await act(async () => {
      await result.current.data.ensureDomains(["students"], { schoolCode: SCHOOL_A }).catch(() => undefined);
    });

    const transition = collapseCounts(studentHistory);
    expect(
      result.current.data.state.students.length,
      `après JWT + 5xx le dernier snapshot valide doit rester. Transition: ${transition}`,
    ).toBe(STUDENT_COUNT);
    expect(neverDippedToZero(studentHistory), `interdit students: ${transition}`).toBe(true);
  });

  it("7a. refresh auth concurrent : une seule rotation JWT (GREEN — contrat actuel)", async () => {
    const result = await loginAndLoadStudents();
    ctl.refreshHold = deferred();
    ctl.expireAccess = true;

    const refreshA = result.current.data.refresh(["students"], { schoolCode: SCHOOL_A }).catch(() => undefined);
    const refreshB = result.current.data.refresh(["students"], { schoolCode: SCHOOL_A }).catch(() => undefined);

    await act(async () => {
      await Promise.resolve();
    });
    expect(ctl.refreshCalls).toBe(1);

    await act(async () => {
      ctl.refreshHold?.resolve();
      await Promise.all([refreshA, refreshB]);
    });

    expect(ctl.refreshCalls).toBe(1);
    expect(result.current.auth.session?.accessToken).toBe("access-2");
  });

  it("7b. 401 concurrents : les données visibles ne disparaissent pas", async () => {
    const result = await loginAndLoadStudents();
    markBaselineLoaded();
    ctl.refreshHold = deferred();
    ctl.expireAccess = true;

    const refreshA = result.current.data.refresh(["students"], { schoolCode: SCHOOL_A }).catch(() => undefined);
    const refreshB = result.current.data.refresh(["students"], { schoolCode: SCHOOL_A }).catch(() => undefined);

    await act(async () => {
      ctl.refreshHold?.resolve();
      await Promise.all([refreshA, refreshB]);
    });

    const transition = collapseCounts(studentHistory);
    expect(
      neverDippedToZero(studentHistory),
      `401 concurrents ne doivent pas vider students. Transition: ${transition}`,
    ).toBe(true);
  });

  it("9a. [] PostgreSQL réel = vide métier (GREEN — contrat actuel)", async () => {
    ctl.students = [];
    const { result: emptyResult } = renderHook(() => useObservedHarness(), { wrapper });
    await act(async () => {
      emptyResult.current.auth.setSession(schoolAdminSession());
    });
    await waitFor(() => expect(emptyResult.current.auth.permissionsReady).toBe(true));
    await act(async () => {
      await emptyResult.current.data.ensureDomains(["students"], { schoolCode: SCHOOL_A });
    });
    await waitFor(() => expect(emptyResult.current.data.loading).toBe(false));
    expect(emptyResult.current.data.state.students).toHaveLength(0);
    expect(emptyResult.current.data.loading).toBe(false);
  });

  it("9b. domaine déjà chargé + rotation JWT ≠ zéro métier", async () => {
    const result = await loginAndLoadStudents();
    markBaselineLoaded();
    expect(result.current.data.state.students).toHaveLength(STUDENT_COUNT);

    const hold = deferred();
    ctl.holdStudents = hold;
    const refreshPromise = result.current.data.refresh(["students"], { schoolCode: SCHOOL_A });

    await waitFor(() => expect(result.current.data.loading).toBe(true));
    expect(
      result.current.data.state.students.length === 0 && result.current.data.loading === false,
      "un refresh domaine (sans rotation JWT) ne doit pas être assimilé à un vide métier",
    ).toBe(false);
    expect(result.current.data.state.students).toHaveLength(STUDENT_COUNT);

    await act(async () => {
      hold.resolve();
      await refreshPromise.catch(() => undefined);
    });
    await waitFor(() => expect(result.current.data.loading).toBe(false));
    markBaselineLoaded();

    await act(async () => {
      result.current.auth.setSession(schoolAdminSession("access-rotated"));
    });

    const looksLikeBusinessEmpty = presentedEmptyHistory.some(Boolean);
    expect(
      looksLikeBusinessEmpty,
      `domaine déjà chargé + rotation JWT ne doit pas ressembler à « aucune donnée ». Transition students: ${collapseCounts(studentHistory)}`,
    ).toBe(false);
  });
});
