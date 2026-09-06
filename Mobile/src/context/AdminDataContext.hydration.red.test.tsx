import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCHOOL_A,
  SCHOOL_B,
  SCHOOL_ID_A,
  collapseCounts,
  deferred,
  neverDippedToZero,
} from "../../../web/src/context/hydrationRedTestUtils";

const STUDENT_COUNT = 12;
const CLASS_COUNT = 4;
const USER_COUNT = 3;

type TestSession = {
  role: string;
  permissions?: string[];
  user: {
    id: string;
    name: string;
    schoolId?: string;
    schoolCode?: string;
    schoolPublicCode?: string;
    countryScope?: string;
    role?: string;
  };
  school?: { id: string; code: string; name: string };
};

const apiStore = vi.hoisted(() => {
  const SCHOOL_A = "CD-IN-26-001";
  const SCHOOL_B = "BI-EC-26-001";
  const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const STUDENT_COUNT = 12;
  const CLASS_COUNT = 4;
  const USER_COUNT = 3;
  function student(index: number, schoolCode: string, schoolId: string) {
    return {
      id: `stu-${schoolCode}-${index + 1}`,
      publicId: `stu-${schoolCode}-${index + 1}`,
      name: `Eleve ${index + 1}`,
      firstName: "Eleve",
      lastName: `${index + 1}`,
      matricule: `M${index + 1}`,
      className: "6ème A",
      schoolId,
      schoolCode,
      schoolPublicCode: schoolCode,
      parentName: "",
      parentPhone: "",
      parentEmail: "",
      status: "active",
      gender: "Masculin",
      birthDate: "2012-01-01",
    };
  }
  function klass(index: number, schoolCode: string, schoolId: string) {
    return {
      id: `cls-${schoolCode}-${index + 1}`,
      name: `Classe ${index + 1}`,
      code: `C${index + 1}`,
      schoolId,
      schoolCode,
    };
  }
  function user(index: number, schoolCode: string, schoolId: string) {
    return {
      id: `usr-${schoolCode}-${index + 1}`,
      firstName: `User${index + 1}`,
      lastName: "Test",
      role: "Admin School",
      schoolId,
      schoolCode,
    };
  }
  return {
    studentsBySchool: {
      [SCHOOL_A]: Array.from({ length: STUDENT_COUNT }, (_, index) => student(index, SCHOOL_A, SCHOOL_ID_A)),
      [SCHOOL_B]: Array.from({ length: 5 }, (_, index) => student(index, SCHOOL_B, SCHOOL_ID_B)),
    } as Record<string, unknown[]>,
    classesBySchool: {
      [SCHOOL_A]: Array.from({ length: CLASS_COUNT }, (_, index) => klass(index, SCHOOL_A, SCHOOL_ID_A)),
      [SCHOOL_B]: Array.from({ length: 2 }, (_, index) => klass(index, SCHOOL_B, SCHOOL_ID_B)),
    } as Record<string, unknown[]>,
    usersBySchool: {
      [SCHOOL_A]: Array.from({ length: USER_COUNT }, (_, index) => user(index, SCHOOL_A, SCHOOL_ID_A)),
      [SCHOOL_B]: Array.from({ length: 2 }, (_, index) => user(index, SCHOOL_B, SCHOOL_ID_B)),
    } as Record<string, unknown[]>,
    schools: [
      { id: SCHOOL_ID_A, code: SCHOOL_A, name: "Nuru A", countryCode: "CD", status: "active" },
      { id: SCHOOL_ID_B, code: SCHOOL_B, name: "Nuru B", countryCode: "BI", status: "active" },
    ],
    holdStudents: null as ReturnType<typeof deferred> | null,
    failStudents: null as { status: number; message: string } | null,
    studentsCalls: 0,
    usersCalls: 0,
    activeSchoolForFetch: SCHOOL_A,
    seedStudentsA() {
      this.studentsBySchool[SCHOOL_A] = Array.from({ length: STUDENT_COUNT }, (_, index) =>
        student(index, SCHOOL_A, SCHOOL_ID_A),
      );
    },
  };
});

type AuthHarnessValue = { session: TestSession | null; permissionsBootstrap: string };

/** Même instance React que AdminDataContext (pas de require() CJS → faux RED `render is not a function`). */
const authHarness = vi.hoisted(() => ({
  Ctx: null as import("react").Context<AuthHarnessValue> | null,
}));

vi.mock("./AuthContext", async () => {
  const React = await import("react");
  const Ctx = React.createContext<AuthHarnessValue>({
    session: null,
    permissionsBootstrap: "ready",
  });
  authHarness.Ctx = Ctx;
  return {
    useAuth: () => React.useContext(Ctx),
  };
});

vi.mock("../services/api", () => {
  const empty = async () => [];
  const academic = async () => ({
    schoolCode: apiStore.activeSchoolForFetch,
    periodMode: "trimester",
    periods: [],
    evaluationTypes: [],
    defaultScale: 20,
    reportCardMode: "",
  });
  async function students() {
    apiStore.studentsCalls += 1;
    if (apiStore.holdStudents) await apiStore.holdStudents.promise;
    if (apiStore.failStudents) {
      const error = new Error(apiStore.failStudents.message) as Error & { status: number };
      error.status = apiStore.failStudents.status;
      throw error;
    }
    return apiStore.studentsBySchool[apiStore.activeSchoolForFetch] ?? [];
  }
  return {
    getStudents: students,
    getClasses: async () => apiStore.classesBySchool[apiStore.activeSchoolForFetch] ?? [],
    getCourses: empty,
    getNotes: empty,
    getPresences: empty,
    getAcademicConfig: academic,
    getAssignments: empty,
    getSubjects: empty,
    getPayments: empty,
    getStudentFees: empty,
    getEvaluations: empty,
    getReportCards: empty,
    getPlanningWeekly: empty,
    getPlanningCourseOptions: empty,
    getSchoolRooms: empty,
    getCourseScheduleReplacements: empty,
    createPlatformNotification: empty,
    updatePlatformNotification: empty,
    createClientsAnnouncement: empty,
    updateClientsAnnouncement: empty,
    sendClientsMessage: empty,
    createClientsUser: empty,
    updateClientsUser: empty,
  };
});

vi.mock("../services/domainHydrationApi", () => {
  const empty = async () => [];
  return {
    getCanonicalUsers: async () => {
      apiStore.usersCalls += 1;
      if (apiStore.holdStudents) await apiStore.holdStudents.promise;
      return apiStore.usersBySchool[apiStore.activeSchoolForFetch] ?? [];
    },
    getCanonicalTeachers: empty,
    getCanonicalAnnouncements: empty,
    getCanonicalMessages: empty,
    getCanonicalSchools: async () => apiStore.schools,
    getCanonicalCountries: empty,
    getCanonicalSubscriptions: empty,
    getCanonicalNotifications: empty,
  };
});

vi.mock("../offline/l1/readModel", () => ({
  loadL1BackedSnapshot: async ({ fetchNetwork }: { fetchNetwork: () => Promise<unknown[]> }) => {
    const data = await fetchNetwork();
    return {
      status: data.length ? "success" : "empty",
      data,
      source: "network",
    };
  },
}));

vi.mock("../services/schoolSettingsApi", () => ({
  listSchoolClassCourses: async () => [],
}));

import { AdminDataProvider, useAdminData } from "./AdminDataContext";
import { clearRequestSchoolScope } from "../lib/requestSchoolScope";
import { clearStoredSchoolCode } from "../lib/activeSchool";
import { metricLabelFromSnapshot, shouldRenderEmpty } from "../lib/dataTruth";

function schoolAdminSession(): TestSession {
  return {
    role: "school_admin",
    permissions: [],
    user: {
      id: "admin-1",
      name: "Admin Nuru",
      schoolId: SCHOOL_ID_A,
      schoolCode: SCHOOL_A,
      schoolPublicCode: SCHOOL_A,
      role: "Admin School",
    },
    school: { id: SCHOOL_ID_A, code: SCHOOL_A, name: "Nuru A" },
  };
}

function superAdminSession(): TestSession {
  return {
    role: "super_admin",
    permissions: [],
    user: {
      id: "super-1",
      name: "Super Admin",
      role: "super_admin",
    },
  };
}

function AuthGate({ session, children }: { session: TestSession; children: ReactNode }) {
  const Ctx = authHarness.Ctx;
  if (!Ctx) throw new Error("Auth harness context not initialized");
  return <Ctx.Provider value={{ session, permissionsBootstrap: "ready" }}>{children}</Ctx.Provider>;
}

const studentHistory: number[] = [];
const metricHistory: string[] = [];

function useObserved() {
  const data = useAdminData();
  studentHistory.push(data.studentsData.length);
  metricHistory.push(metricLabelFromSnapshot(data.studentsSnapshot, (rows) => String(rows.length)));
  return data;
}

function resetObservations() {
  studentHistory.length = 0;
  metricHistory.length = 0;
}

describe("CHANTIER SYNC — Mobile AdminDataContext (tests RED)", () => {
  beforeEach(() => {
    resetObservations();
    apiStore.holdStudents = null;
    apiStore.failStudents = null;
    apiStore.studentsCalls = 0;
    apiStore.usersCalls = 0;
    apiStore.activeSchoolForFetch = SCHOOL_A;
    apiStore.seedStudentsA();
    clearRequestSchoolScope();
    clearStoredSchoolCode();
  });

  afterEach(() => {
    clearRequestSchoolScope();
    clearStoredSchoolCode();
  });

  it("2. rehydratation même tenant : pas d'écran vide N → 0 → N", async () => {
    const session = schoolAdminSession();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AuthGate session={session}>
          <AdminDataProvider>{children}</AdminDataProvider>
        </AuthGate>
      );
    }
    const { result } = renderHook(() => useObserved(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.studentsData.length).toBe(STUDENT_COUNT));
    await waitFor(() => expect(result.current.classesData.length).toBe(CLASS_COUNT));
    await waitFor(() => expect(result.current.usersData.length).toBe(USER_COUNT));
    studentHistory.length = 0;
    metricHistory.length = 0;
    studentHistory.push(STUDENT_COUNT);

    apiStore.holdStudents = deferred();
    await act(async () => {
      result.current.setActiveSchoolCode(SCHOOL_A.toLowerCase());
    });

    const transition = collapseCounts(studentHistory);
    expect(
      neverDippedToZero(studentHistory),
      `même user + même établissement : l'ancien snapshot doit rester. Transition students: ${transition}`,
    ).toBe(true);
    expect(shouldRenderEmpty(result.current.studentsSnapshot)).toBe(false);

    await act(async () => {
      apiStore.holdStudents?.resolve();
    });
    await waitFor(() => expect(result.current.studentsData.length).toBe(STUDENT_COUNT));
  });

  it("5. changement de scope A → B : isolation tenant, jamais « 0 élève » avant fin d'hydratation", async () => {
    const session = superAdminSession();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AuthGate session={session}>
          <AdminDataProvider>{children}</AdminDataProvider>
        </AuthGate>
      );
    }
    const { result } = renderHook(() => useObserved(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.availableSchools.length).toBeGreaterThan(0));
    apiStore.activeSchoolForFetch = SCHOOL_A;
    await act(async () => {
      result.current.setActiveSchoolCode(SCHOOL_A);
    });
    await waitFor(() => expect(result.current.studentsData.length).toBe(STUDENT_COUNT));
    studentHistory.length = 0;
    metricHistory.length = 0;
    studentHistory.push(STUDENT_COUNT);

    apiStore.holdStudents = deferred();
    apiStore.activeSchoolForFetch = SCHOOL_B;
    await act(async () => {
      result.current.setActiveSchoolCode(SCHOOL_B);
    });

    expect(
      result.current.studentsData.some((row) => row.schoolCode === SCHOOL_A),
      "aucune donnée de A ne doit rester présentée sous B",
    ).toBe(false);

    const transition = collapseCounts(studentHistory);
    expect(
      metricHistory.includes("0") || studentHistory.includes(0),
      `reset interne A→B ne doit pas être lu comme 0 élève. students: ${transition} métriques: ${metricHistory.join(",")}`,
    ).toBe(false);
    expect(shouldRenderEmpty(result.current.studentsSnapshot)).toBe(false);

    await act(async () => {
      apiStore.holdStudents?.resolve();
    });
    await waitFor(() => expect(result.current.studentsData.length).toBe(5));
    expect(result.current.studentsData.every((row) => row.schoolCode === SCHOOL_B)).toBe(true);
  });

  it("6. erreur réseau pendant refresh : snapshot valide conservé", async () => {
    const session = schoolAdminSession();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AuthGate session={session}>
          <AdminDataProvider>{children}</AdminDataProvider>
        </AuthGate>
      );
    }
    const { result } = renderHook(() => useObserved(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.studentsData.length).toBe(STUDENT_COUNT));
    studentHistory.length = 0;
    studentHistory.push(STUDENT_COUNT);

    apiStore.failStudents = { status: 503, message: "Erreur serveur" };
    await act(async () => {
      await result.current.refreshBackOfficeState().catch(() => undefined);
    });

    const transition = collapseCounts(studentHistory);
    expect(
      result.current.studentsData.length,
      `dernier snapshot conservé après 5xx. Transition: ${transition}`,
    ).toBe(STUDENT_COUNT);
    expect(neverDippedToZero(studentHistory), `interdit students: ${transition}`).toBe(true);
    expect(shouldRenderEmpty(result.current.studentsSnapshot)).toBe(false);
  });

  it("8. Mobile stale response : A termine après B et n'écrase pas B (students + users)", async () => {
    const session = superAdminSession();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AuthGate session={session}>
          <AdminDataProvider>{children}</AdminDataProvider>
        </AuthGate>
      );
    }
    const { result } = renderHook(() => useObserved(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.availableSchools.length).toBeGreaterThan(0));
    apiStore.activeSchoolForFetch = SCHOOL_A;
    await act(async () => {
      result.current.setActiveSchoolCode(SCHOOL_A);
    });
    await waitFor(() => expect(result.current.studentsData.length).toBe(STUDENT_COUNT));
    await waitFor(() => expect(result.current.usersData.length).toBe(USER_COUNT));

    const holdA = deferred();
    apiStore.holdStudents = holdA;
    const staleA = result.current.refreshBackOfficeState();
    const staleUsers = result.current.loadUsers();

    apiStore.activeSchoolForFetch = SCHOOL_B;
    apiStore.holdStudents = null;
    await act(async () => {
      result.current.setActiveSchoolCode(SCHOOL_B);
    });

    await act(async () => {
      holdA.resolve();
      await Promise.all([staleA.catch(() => undefined), staleUsers.catch(() => undefined)]);
    });

    expect(
      result.current.studentsData.every((row) => row.schoolCode === SCHOOL_B),
      "A ne doit jamais écraser B sur students",
    ).toBe(true);
    expect(
      result.current.usersData.every((row) => row.schoolCode === SCHOOL_B),
      "A ne doit jamais écraser B sur users",
    ).toBe(true);
  });

  it("9. [] PostgreSQL réel = vide métier ; domaine chargé en refresh ≠ zéro", async () => {
    apiStore.studentsBySchool[SCHOOL_A] = [];
    const session = schoolAdminSession();
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AuthGate session={session}>
          <AdminDataProvider>{children}</AdminDataProvider>
        </AuthGate>
      );
    }
    const { result } = renderHook(() => useObserved(), { wrapper: Wrapper });
    await waitFor(() =>
      expect(
        result.current.studentsSnapshot.status === "empty" || result.current.studentsSnapshot.status === "success",
      ).toBe(true),
    );
    expect(shouldRenderEmpty(result.current.studentsSnapshot)).toBe(true);
    expect(metricLabelFromSnapshot(result.current.studentsSnapshot, (rows) => String(rows.length))).toBe("0");

    apiStore.seedStudentsA();
    await act(async () => {
      await result.current.refreshBackOfficeState();
    });
    await waitFor(() => expect(result.current.studentsData.length).toBe(STUDENT_COUNT));

    apiStore.holdStudents = deferred();
    await act(async () => {
      result.current.setActiveSchoolCode(SCHOOL_A.toLowerCase());
    });

    expect(
      shouldRenderEmpty(result.current.studentsSnapshot),
      `refresh du domaine chargé ne doit pas être un vide métier. status=${result.current.studentsSnapshot.status} students=${collapseCounts(studentHistory)}`,
    ).toBe(false);

    await act(async () => {
      apiStore.holdStudents?.resolve();
    });
  });
});
