/**
 * DEMO-DATA — accessibilité métier session Démo Web (#667 → correction contrôlée).
 *
 * Preuve RED conservée puis GREEN : GET /notes 200 avec volume tenant, Messages
 * encore pendante, Notes affiche quand même les données. Le batch dashboard
 * critique ne mélange plus notes avec documents/messages. En runtime Démo,
 * GradesEvaluationsPage lit l'hydratation de route notes/evaluations/students/classes
 * au lieu de DataContext.loading global.
 *
 * Exécution : `npm --prefix web run test -- src/pages/demoDataAccess.hydration.test.tsx`
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import type { SessionUser } from "../types";
import { SCHOOL_ADMIN_ROLE } from "../lib/orgHierarchy";
import { getInternalRoleDefaults } from "../lib/internalRoleDefaults";
import {
  dashboardCriticalDomainsForDemo,
  dashboardDeferredDomainsForDemo,
  dashboardDomainsForDemo,
} from "../lib/dashboardDemoHydration";
import { scopedClasses, scopedNotes, scopedPayments, scopedPresences, scopedStudents, scopedTeachers } from "../lib/establishment";
import { deferred } from "../context/hydrationRedTestUtils";
import { PEDAGOGY_COPY } from "../lib/pedagogyParityContract";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOGIN_A = "CD-IN-26-001";
const LEFTOVER_A = "CD-2026-0001";

const store = vi.hoisted(() => ({
  holdMessages: null as ReturnType<typeof deferred> | null,
  holdDocuments: null as ReturnType<typeof deferred> | null,
  classes: [] as Record<string, unknown>[],
  students: [] as Record<string, unknown>[],
  teachers: [] as Record<string, unknown>[],
  notes: [] as Record<string, unknown>[],
  evaluations: [] as Record<string, unknown>[],
  presences: [] as Record<string, unknown>[],
  payments: [] as Record<string, unknown>[],
  exams: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  assignments: [] as Record<string, unknown>[],
}));

const apiGetMock = vi.hoisted(() =>
  vi.fn(async (path: string): Promise<unknown> => {
    void path;
    return [];
  }),
);

const sessionActor = vi.hoisted(() => ({
  user: {
    id: "demo-admin",
    firstName: "Admin",
    lastName: "Nuru",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    schoolPublicCode: "CD-IN-26-001",
    schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    identifier: "admin",
    permissions: [] as string[],
  } as SessionUser,
}));

const latestSample = vi.hoisted(() => ({
  current: {
    loading: false,
    classes: 0,
    students: 0,
    teachers: 0,
    notes: 0,
    presences: 0,
    payments: 0,
    evaluations: 0,
  },
}));

vi.mock("../lib/featureFlags", () => ({
  showDemoAccounts: false,
  marketplaceEnabled: false,
  publicDemoEnabled: false,
  demoRuntimeEnabled: true,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      accessToken: "demo-access-token",
      demo: true,
      user: sessionActor.user,
      permissions: sessionActor.user.permissions,
      scope: { label: "Établissement", hint: sessionActor.user.schoolCode },
    },
    permissionsReady: true,
    permissionsBootstrap: "ready",
    logout: vi.fn(),
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    scopedUser: sessionActor.user,
    activeSchoolCode: sessionActor.user.schoolCode,
    activeSchool: {
      id: sessionActor.user.schoolId,
      code: sessionActor.user.schoolCode,
      name: "Complexe Scolaire Nuru",
      currency: "CDF",
    },
    isSuperAdmin: false,
    ready: true,
  }),
}));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getAccessToken: () => "demo-access-token",
    api: {
      ...actual.api,
      get: (...args: unknown[]) => apiGetMock(...(args as [string])),
    },
  };
});

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));

vi.mock("../lib/pedagogyApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/pedagogyApi")>();
  return {
    ...actual,
    pedagogyApi: {
      ...actual.pedagogyApi,
      createEvaluation: vi.fn(async () => ({ id: "eval-imported" })),
    },
  };
});

import { DataProvider, useData } from "../context/DataContext";
import { DomainRouteBootstrap } from "../components/DomainRouteBootstrap";
import { OverviewPage } from "./OverviewPage";
import { GradesEvaluationsPage } from "./GradesEvaluationsPage";
import { StudentsListPage } from "./etablissement/StudentsListPage";
import { EtablissementOverviewPage } from "./etablissement/EtablissementOverviewPage";

function pathnameOf(url: string): string {
  return String(url).split("?")[0];
}

function asSchoolAdmin(permissions = getInternalRoleDefaults(SCHOOL_ADMIN_ROLE)) {
  sessionActor.user = {
    id: "demo-admin",
    firstName: "Admin",
    lastName: "Nuru",
    role: SCHOOL_ADMIN_ROLE,
    schoolCode: LEFTOVER_A,
    schoolPublicCode: LOGIN_A,
    schoolId: SCHOOL_ID_A,
    identifier: "admin",
    permissions,
  } as SessionUser;
}

function seedTenantPayload() {
  store.classes = [
    {
      id: "cls-1",
      classCode: "CLS-1",
      publicId: "CLS-1",
      name: "6ème A",
      className: "6ème A",
      schoolCode: LEFTOVER_A,
      schoolId: SCHOOL_ID_A,
      status: "active",
    },
    {
      id: "cls-2",
      classCode: "CLS-2",
      publicId: "CLS-2",
      name: "5ème B",
      className: "5ème B",
      schoolCode: LEFTOVER_A,
      schoolId: SCHOOL_ID_A,
      status: "active",
    },
  ];
  store.students = [
    {
      id: "CD-IN-EL-26-00001",
      publicId: "CD-IN-EL-26-00001",
      studentCode: "CD-IN-EL-26-00001",
      firstName: "Awa",
      lastName: "Diallo",
      name: "Awa Diallo",
      className: "6ème A",
      classCode: "CLS-1",
      schoolId: SCHOOL_ID_A,
      schoolCode: LOGIN_A,
      schoolPublicCode: LOGIN_A,
      status: "active",
    },
    {
      id: "CD-IN-EL-26-00002",
      publicId: "CD-IN-EL-26-00002",
      studentCode: "CD-IN-EL-26-00002",
      firstName: "Marc",
      lastName: "Nze",
      name: "Marc Nze",
      className: "5ème B",
      classCode: "CLS-2",
      schoolId: SCHOOL_ID_A,
      schoolCode: LOGIN_A,
      schoolPublicCode: LOGIN_A,
      status: "active",
    },
  ];
  store.teachers = [
    {
      id: "ENS-0001",
      teacherCode: "ENS-0001",
      publicId: "ENS-0001",
      firstName: "Seke",
      lastName: "Kilombo",
      name: "Seke Kilombo",
      schoolCode: LEFTOVER_A,
      schoolId: SCHOOL_ID_A,
      assignedClasses: ["6ème A"],
      status: "Actif",
    },
  ];
  store.notes = [
    {
      id: "note-1",
      schoolId: SCHOOL_ID_A,
      schoolCode: LEFTOVER_A,
      studentId: "CD-IN-EL-26-00001",
      className: "6ème A",
      subject: "Maths",
      value: 14,
      period: "Trimestre 1",
    },
    {
      id: "note-2",
      schoolId: SCHOOL_ID_A,
      schoolCode: LEFTOVER_A,
      studentId: "CD-IN-EL-26-00002",
      className: "5ème B",
      subject: "Français",
      value: 12,
      period: "Trimestre 1",
    },
  ];
  store.evaluations = [
    {
      id: "eval-1",
      schoolId: SCHOOL_ID_A,
      schoolCode: LEFTOVER_A,
      className: "6ème A",
      subject: "Maths",
      title: "Devoir 1",
      period: "Trimestre 1",
      status: "Publiée",
      active: true,
    },
  ];
  store.presences = [
    {
      id: "pres-1",
      schoolCode: LEFTOVER_A,
      studentId: "CD-IN-EL-26-00001",
      className: "6ème A",
      status: "Présent",
      date: "15-09-2026",
    },
  ];
  store.payments = [
    {
      id: "pay-1",
      schoolId: SCHOOL_ID_A,
      schoolCode: LOGIN_A,
      studentId: "CD-IN-EL-26-00001",
      amount: 25000,
      status: "Payé",
    },
  ];
  store.exams = [
    {
      id: "exam-1",
      schoolCode: LEFTOVER_A,
      name: "Composition T1",
      className: "6ème A",
      subject: "Maths",
    },
  ];
  store.users = [
    {
      id: "demo-admin",
      firstName: "Admin",
      lastName: "Nuru",
      role: SCHOOL_ADMIN_ROLE,
      schoolId: SCHOOL_ID_A,
      schoolCode: LOGIN_A,
      schoolPublicCode: LOGIN_A,
      status: "Actif",
    },
  ];
  store.assignments = [
    {
      id: "asg-1",
      teacherId: "ENS-0001",
      className: "6ème A",
      course: "Maths",
      schoolCode: LEFTOVER_A,
    },
  ];
}

function DataProbe() {
  const { state, loading } = useData();
  useEffect(() => {
    latestSample.current = {
      loading,
      classes: scopedClasses(sessionActor.user, state).length,
      students: scopedStudents(sessionActor.user, state).length,
      teachers: scopedTeachers(sessionActor.user, state).length,
      notes: scopedNotes(sessionActor.user, state).length,
      presences: scopedPresences(sessionActor.user, state).length,
      payments: scopedPayments(sessionActor.user, state).length,
      evaluations: (state.evaluations ?? []).filter((row) => row.active !== false).length,
    };
  }, [state, loading]);
  return (
    <div data-testid="demo-data-probe">
      {`loading=${latestSample.current.loading ? "1" : "0"} students=${latestSample.current.students} notes=${latestSample.current.notes}`}
    </div>
  );
}

function renderDemoTree(initialPath: string) {
  return render(
    <DataProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <DomainRouteBootstrap />
        <DataProbe />
        <nav>
          <Link to="/tableau-de-bord">Aller dashboard</Link>
          <Link to="/notes">Aller notes</Link>
          <Link to="/etablissement/eleves">Aller eleves</Link>
          <Link to="/etablissement/vue-ensemble">Aller etablissement</Link>
        </nav>
        <Routes>
          <Route path="/tableau-de-bord" element={<OverviewPage />} />
          <Route path="/notes" element={<GradesEvaluationsPage />} />
          <Route path="/etablissement/eleves" element={<StudentsListPage />} />
          <Route path="/etablissement/vue-ensemble" element={<EtablissementOverviewPage />} />
        </Routes>
      </MemoryRouter>
    </DataProvider>,
  );
}

function expectTenantVolumes() {
  expect(latestSample.current.classes).toBeGreaterThan(0);
  expect(latestSample.current.students).toBeGreaterThan(0);
  expect(latestSample.current.teachers).toBeGreaterThan(0);
  expect(latestSample.current.notes).toBeGreaterThan(0);
  expect(latestSample.current.presences).toBeGreaterThan(0);
  expect(latestSample.current.payments).toBeGreaterThan(0);
  expect(latestSample.current.evaluations).toBeGreaterThan(0);
}

describe("DEMO-DATA — accessibilité métier session Démo", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    store.holdMessages = deferred();
    store.holdDocuments = deferred();
    asSchoolAdmin();
    seedTenantPayload();
    latestSample.current = {
      loading: false,
      classes: 0,
      students: 0,
      teachers: 0,
      notes: 0,
      presences: 0,
      payments: 0,
      evaluations: 0,
    };
    apiGetMock.mockReset();
    apiGetMock.mockImplementation(async (path: string) => {
      const url = pathnameOf(path);
      if (url === "/classes") return store.classes;
      if (url === "/students") return store.students;
      if (url === "/teachers") return store.teachers;
      if (url === "/notes") return store.notes;
      if (url === "/evaluations") return store.evaluations;
      if (url === "/presences") return store.presences;
      if (url === "/payments") return store.payments;
      if (url === "/exams") return { exams: store.exams };
      if (url === "/report-cards") return { bulletins: [] };
      if (url === "/school-documents") {
        if (store.holdDocuments) await store.holdDocuments.promise;
        return { documents: [] };
      }
      if (url === "/assignments") return store.assignments;
      if (url === "/backoffice/users") return store.users;
      if (url === "/backoffice/relations") return [];
      if (url === "/finance/fee-grids" || url === "/finance/student-fees") return [];
      if (url.startsWith("/backoffice/messages")) {
        if (store.holdMessages) await store.holdMessages.promise;
        return [];
      }
      if (url.startsWith("/backoffice/establishments/") && url.endsWith("/academic-config")) {
        return { schoolCode: LEFTOVER_A, academicYear: "2025-2026" };
      }
      if (url.startsWith("/backoffice/establishments/")) {
        return {
          id: SCHOOL_ID_A,
          code: LEFTOVER_A,
          schoolCode: LEFTOVER_A,
          loginCode: LOGIN_A,
          name: "Complexe Scolaire Nuru",
        };
      }
      if (url === "/v2/academic-years") {
        return [{ id: "ay-1", name: "2025-2026", isCurrent: true, schoolCode: LOGIN_A }];
      }
      return [];
    });
  });

  it("contrat source : batches dashboard séparés, RBAC avant ensureDomains, Notes Démo hors loading global", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const overview = readFileSync(join(here, "OverviewPage.tsx"), "utf8");
    const notes = readFileSync(join(here, "GradesEvaluationsPage.tsx"), "utf8");
    const dataContext = readFileSync(join(here, "../context/DataContext.tsx"), "utf8");
    const bootstrap = readFileSync(join(here, "../components/DomainRouteBootstrap.tsx"), "utf8");

    expect(dashboardDomainsForDemo(true)).toEqual(
      expect.arrayContaining(["notes", "exams", "bulletins", "documents", "messages"]),
    );
    expect(dashboardCriticalDomainsForDemo(true)).toEqual(
      expect.arrayContaining(["notes", "exams", "bulletins"]),
    );
    expect(dashboardCriticalDomainsForDemo(true)).not.toContain("messages");
    expect(dashboardCriticalDomainsForDemo(true)).not.toContain("documents");
    expect(dashboardDeferredDomainsForDemo(true)).toEqual(["documents", "messages"]);
    expect(overview).toMatch(/filterDomainsByPermissions/);
    expect(overview).toMatch(/dashboardCriticalDomainsForDemo/);
    expect(overview).toMatch(/dashboardDeferredDomainsForDemo/);
    expect(notes).toMatch(/demoRuntimeEnabled/);
    expect(notes).toMatch(/notesRouteLoading/);
    expect(notes).toContain("Chargement des notes et évaluations…");
    expect(bootstrap).toMatch(/NOTES_PATH/);
    expect(dataContext).toMatch(/const loading = fetchLoading \|\| scopeSwitching/);
  });

  it("session Démo : messages pendante → Notes affiche le volume tenant sans spinner", async () => {
    const user = userEvent.setup();
    renderDemoTree("/tableau-de-bord");

    await waitFor(() => {
      expect(apiGetMock.mock.calls.some(([path]) => pathnameOf(String(path)) === "/students")).toBe(true);
    });
    await waitFor(() => {
      expect(apiGetMock.mock.calls.some(([path]) => pathnameOf(String(path)) === "/notes")).toBe(true);
      expect(apiGetMock.mock.calls.some(([path]) => pathnameOf(String(path)).startsWith("/backoffice/messages"))).toBe(
        true,
      );
    });

    await user.click(screen.getByRole("link", { name: "Aller notes" }));

    await waitFor(() => {
      expect(apiGetMock.mock.calls.some(([path]) => pathnameOf(String(path)) === "/evaluations")).toBe(true);
    });

    await waitFor(() => {
      expect(screen.queryByText("Chargement des notes et évaluations…")).not.toBeInTheDocument();
      expect(screen.getByText(PEDAGOGY_COPY.moduleTitle)).toBeInTheDocument();
      expectTenantVolumes();
    });

    expect(latestSample.current.loading).toBe(true);
    expect(store.holdMessages).not.toBeNull();
  });

  it("documents/messages peuvent terminer plus tard sans rebloquer Notes", async () => {
    const user = userEvent.setup();
    renderDemoTree("/tableau-de-bord");

    await waitFor(() => {
      expect(apiGetMock.mock.calls.some(([path]) => pathnameOf(String(path)) === "/notes")).toBe(true);
    });
    await user.click(screen.getByRole("link", { name: "Aller notes" }));

    await waitFor(() => {
      expect(screen.queryByText("Chargement des notes et évaluations…")).not.toBeInTheDocument();
      expect(screen.getByText(PEDAGOGY_COPY.moduleTitle)).toBeInTheDocument();
      expectTenantVolumes();
    });

    store.holdDocuments?.resolve();
    store.holdMessages?.resolve();

    await waitFor(() => {
      expect(latestSample.current.loading).toBe(false);
    });

    expect(screen.queryByText("Chargement des notes et évaluations…")).not.toBeInTheDocument();
    expect(screen.getByText(PEDAGOGY_COPY.moduleTitle)).toBeInTheDocument();
    expectTenantVolumes();
  });

  it("RBAC : un domaine non autorisé n'est pas demandé", async () => {
    const permissions = getInternalRoleDefaults(SCHOOL_ADMIN_ROLE).filter(
      (permission) => !permission.startsWith("Messages:") && !permission.startsWith("Documents:"),
    );
    asSchoolAdmin(permissions);
    renderDemoTree("/tableau-de-bord");

    await waitFor(() => {
      expect(apiGetMock.mock.calls.some(([path]) => pathnameOf(String(path)) === "/notes")).toBe(true);
    });

    expect(
      apiGetMock.mock.calls.some(([path]) => pathnameOf(String(path)).startsWith("/backoffice/messages")),
    ).toBe(false);
    expect(apiGetMock.mock.calls.some(([path]) => pathnameOf(String(path)) === "/school-documents")).toBe(false);
  });
});
