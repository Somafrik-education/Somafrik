import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../types";
import { AuthProvider, useAuth } from "./AuthContext";
import { DataProvider, useData } from "./DataContext";
import { ActiveSchoolProvider, useActiveSchool } from "./ActiveSchoolContext";
import { SUPER_ADMIN_ROLE } from "../lib/orgHierarchy";
import {
  SCHOOL_A,
  SCHOOL_B,
  SCHOOL_ID_A,
  SCHOOL_ID_B,
  deferred,
  jsonResponse,
  pathnameOf,
  pgSchool,
  pgStudent,
} from "./hydrationRedTestUtils";

const COUNT_A = 12;
const COUNT_B = 5;

type FetchCtl = {
  studentsA: Record<string, unknown>[];
  studentsB: Record<string, unknown>[];
  holdB: ReturnType<typeof deferred> | null;
  holdA: ReturnType<typeof deferred> | null;
  studentCalls: number;
};

const ctl: FetchCtl = {
  studentsA: [],
  studentsB: [],
  holdB: null,
  holdA: null,
  studentCalls: 0,
};

function resetCtl() {
  ctl.studentsA = Array.from({ length: COUNT_A }, (_, index) => pgStudent(index, SCHOOL_A, SCHOOL_ID_A));
  ctl.studentsB = Array.from({ length: COUNT_B }, (_, index) => pgStudent(index, SCHOOL_B, SCHOOL_ID_B));
  ctl.holdB = null;
  ctl.holdA = null;
  ctl.studentCalls = 0;
}

function superSession(): Session {
  return {
    accessToken: "super-access",
    refreshToken: "super-refresh",
    permissions: [],
    scope: { label: "Plateforme", hint: "*" },
    user: {
      id: "super-1",
      firstName: "Super",
      lastName: "Admin",
      identifier: "super-1",
      role: SUPER_ADMIN_ROLE,
      schoolCode: "*",
    },
  } as Session;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>
        <ActiveSchoolProvider>{children}</ActiveSchoolProvider>
      </DataProvider>
    </AuthProvider>
  );
}

const studentHistory: number[] = [];
const frames: Array<{ active: string; codes: string[]; n: number; loading: boolean }> = [];

function useObserved() {
  const auth = useAuth();
  const data = useData();
  const school = useActiveSchool();
  const codes = data.state.students.map((row) => String(row.schoolCode ?? ""));
  studentHistory.push(data.state.students.length);
  frames.push({
    active: school.activeSchoolCode,
    codes,
    n: data.state.students.length,
    loading: data.loading,
  });
  return { auth, data, school };
}

describe("CHANTIER SYNC — Web changement d'établissement (tests RED)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    resetCtl();
    studentHistory.length = 0;
    frames.length = 0;

    vi.stubGlobal("fetch", async (url: string) => {
      const path = pathnameOf(url);
      if (path === "/auth/effective-permissions") return jsonResponse({ permissions: [] });
      if (path === "/backoffice/establishments") {
        return jsonResponse([
          pgSchool(SCHOOL_A, SCHOOL_ID_A, "Nuru A"),
          pgSchool(SCHOOL_B, SCHOOL_ID_B, "Nuru B"),
        ]);
      }
      if (path === "/students") {
        ctl.studentCalls += 1;
        if (ctl.studentCalls === 1) {
          if (ctl.holdA) await ctl.holdA.promise;
          return jsonResponse(ctl.studentsA);
        }
        if (ctl.holdB) await ctl.holdB.promise;
        return jsonResponse(ctl.studentsB);
      }
      if (path.includes("academic-config")) {
        const school = path.includes(encodeURIComponent(SCHOOL_B)) ? SCHOOL_B : SCHOOL_A;
        return jsonResponse({ schoolCode: school, periodMode: "trimester" });
      }
      if (path === "/backoffice/users") return jsonResponse([]);
      return jsonResponse([]);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
  });

  async function bootOnSchoolA() {
    const { result } = renderHook(() => useObserved(), { wrapper });
    await act(async () => {
      result.current.auth.setSession(superSession());
    });
    await waitFor(() => expect(result.current.auth.permissionsReady).toBe(true));
    await waitFor(() => expect(result.current.school.availableSchools.length).toBeGreaterThan(0));
    if (result.current.school.activeSchoolCode !== SCHOOL_A) {
      await act(async () => {
        result.current.school.setActiveSchoolCode(SCHOOL_A);
      });
    }
    await act(async () => {
      await result.current.data.ensureDomains(["students"], { schoolCode: SCHOOL_A });
    });
    await waitFor(() => expect(result.current.data.state.students).toHaveLength(COUNT_A));
    studentHistory.length = 0;
    frames.length = 0;
    studentHistory.push(COUNT_A);
    frames.push({
      active: result.current.school.activeSchoolCode,
      codes: result.current.data.state.students.map((row) => String(row.schoolCode ?? "")),
      n: COUNT_A,
      loading: result.current.data.loading,
    });
    return result;
  }

  it("4. A → B : pas de fuite A-sous-B, pas de flash vide assimilé à un domaine vide, état switching distinct", async () => {
    const result = await bootOnSchoolA();
    ctl.holdB = deferred();

    await act(async () => {
      result.current.school.setActiveSchoolCode(SCHOOL_B);
    });

    const leakOnB = frames.some(
      (frame) => frame.active === SCHOOL_B && frame.codes.some((code) => code === SCHOOL_A),
    );
    const flashedBusinessEmpty = frames.some(
      (frame) => frame.active === SCHOOL_B && frame.n === 0 && frame.loading === false,
    );
    const issues: string[] = [];
    if (leakOnB) issues.push("fuite A sous B (A encore visible alors que l'établissement actif est B)");
    if (flashedBusinessEmpty) issues.push(`flash vide métier []+loading=false sous B`);
    expect(issues, issues.join(" ; ") || "ok").toEqual([]);
    expect(result.current.school.scopeTransition).toBe("switching");
    expect(result.current.data.loading).toBe(true);

    const loadB = result.current.data.ensureDomains(["students"], { schoolCode: SCHOOL_B });
    await act(async () => {
      ctl.holdB?.resolve();
      await loadB;
    });
    await waitFor(() => expect(result.current.data.state.students.length).toBeGreaterThan(0));
    expect(result.current.data.state.students.every((row) => row.schoolCode === SCHOOL_B)).toBe(true);
    expect(result.current.school.scopeTransition).toBe("idle");
  });

  it("8. Web stale response : requête A lancée, passage B, A termine après B", async () => {
    const result = await bootOnSchoolA();
    ctl.studentCalls = 0;
    ctl.holdA = deferred();
    ctl.holdB = null;

    const staleA = result.current.data.refresh(["students"], { schoolCode: SCHOOL_A });

    await act(async () => {
      result.current.school.setActiveSchoolCode(SCHOOL_B);
    });
    await act(async () => {
      await result.current.data.ensureDomains(["students"], { schoolCode: SCHOOL_B });
    });
    await waitFor(() => {
      const codes = result.current.data.state.students.map((row) => row.schoolCode);
      expect(codes.every((code) => code === SCHOOL_B) || result.current.data.state.students.length === 0).toBe(true);
    });

    const bCount = result.current.data.state.students.length;

    await act(async () => {
      ctl.holdA?.resolve();
      await staleA.catch(() => undefined);
    });

    const afterStale = result.current.data.state.students;
    expect(
      afterStale.every((row) => row.schoolCode === SCHOOL_B),
      `A ne doit jamais écraser B. Après A tardif: ${afterStale.map((row) => row.schoolCode).join(",")}`,
    ).toBe(true);
    if (bCount > 0) {
      expect(afterStale).toHaveLength(bCount);
    }
  });
});
