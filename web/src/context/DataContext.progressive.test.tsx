import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHOOL_ADMIN_ROLE } from "../lib/orgHierarchy";
import type { SessionUser } from "../types";

/**
 * PERF-PR4 — chargement progressif des domaines, annulation et isolation de portée.
 * Le serveur simulé laisse le test décider quand chaque réponse arrive.
 */

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOGIN_A = "CD-IN-26-001";

type Pending = {
  path: string;
  signal?: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

const server = vi.hoisted(() => ({ pending: [] as Pending[] }));
const auth = vi.hoisted(() => ({ session: null as Record<string, unknown> | null }));

function user(id: string, schoolCode = LOGIN_A, schoolId = SCHOOL_ID_A): SessionUser {
  return {
    id,
    firstName: "Admin",
    lastName: id,
    role: SCHOOL_ADMIN_ROLE,
    schoolCode,
    schoolPublicCode: schoolCode,
    schoolId,
    identifier: id,
  } as SessionUser;
}

function sessionFor(u: SessionUser) {
  return { user: u, accessToken: `token-${u.id}`, scope: { label: "Établissement", hint: u.schoolCode } };
}

vi.mock("./AuthContext", () => ({
  useAuth: () => ({ session: auth.session, permissionsReady: true }),
}));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getAccessToken: () => (auth.session ? "token" : null),
    api: {
      ...actual.api,
      get: vi.fn(
        (path: string, init?: { signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            const entry: Pending = { path, signal: init?.signal, resolve, reject };
            init?.signal?.addEventListener("abort", () => reject(new actual.ApiAbortError()), { once: true });
            server.pending.push(entry);
          }),
      ),
    },
  };
});

import { ApiError, ApiTimeoutError, api } from "../api/client";
import { DataProvider, useData } from "./DataContext";

function student(index: number, schoolId = SCHOOL_ID_A, school = LOGIN_A) {
  const seq = String(index + 1).padStart(5, "0");
  return {
    id: `CD-IN-EL-26-${seq}`,
    publicId: `CD-IN-EL-26-${seq}`,
    studentCode: `CD-IN-EL-26-${seq}`,
    firstName: `Prenom${index + 1}`,
    lastName: `Nom${index + 1}`,
    name: `Prenom${index + 1} Nom${index + 1}`,
    schoolId,
    schoolCode: school,
    schoolPublicCode: school,
    status: "active",
  };
}

const chart = (marker: string) => ({ platform: { marker }, establishment: {} });
const role = (name: string) => ({ [name]: ["Élèves:READ"] });

/** Répond à la plus ancienne requête encore en attente pour ce chemin. */
async function respond(path: string, body: unknown) {
  const index = server.pending.findIndex((entry) => entry.path === path);
  if (index < 0) throw new Error(`aucune requête en attente pour ${path}`);
  const [entry] = server.pending.splice(index, 1);
  await act(async () => {
    entry.resolve(body);
    await Promise.resolve();
  });
  return entry;
}

async function fail(path: string, error: unknown) {
  const index = server.pending.findIndex((entry) => entry.path === path);
  const [entry] = server.pending.splice(index, 1);
  await act(async () => {
    entry.reject(error);
    await Promise.resolve();
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return <DataProvider>{children}</DataProvider>;
}

const pathsRequested = () => vi.mocked(api.get).mock.calls.map(([path]) => path);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  server.pending = [];
  vi.mocked(api.get).mockClear();
  auth.session = sessionFor(user("admin-a"));
});

describe("DataContext — chargement progressif (PERF-PR4)", () => {
  it("trois domaines : chacun fusionné dès sa réponse, la promesse attend le plus lent", async () => {
    const { result } = renderHook(() => useData(), { wrapper });
    let done = false;
    let ensure!: Promise<void>;
    act(() => {
      ensure = result.current.ensureDomains(["students", "dashboardChartConfig", "rolePermissions"]).then(() => {
        done = true;
      });
    });
    await waitFor(() => expect(server.pending).toHaveLength(3));
    expect(result.current.domainStatus.students?.status).toBe("loading");

    await respond("/backoffice/dashboard-chart-config", chart("v1")); // A : rapide
    expect(result.current.state.dashboardChartConfig).toMatchObject({ platform: { marker: "v1" } });
    expect(result.current.domainStatus.dashboardChartConfig?.status).toBe("ready");
    expect(result.current.domainStatus.students?.status).toBe("loading");
    expect(done).toBe(false);

    await respond("/students", [student(0), student(1)]); // B : moyen
    expect(result.current.state.students).toHaveLength(2);
    expect(done).toBe(false);

    await respond("/backoffice/role-permissions", role("Secrétaire")); // C : lent
    await act(async () => {
      await ensure;
    });
    expect(done).toBe(true);
    expect(result.current.state.rolePermissions).toHaveProperty("Secrétaire");
  });

  it("une erreur n'efface pas les deux autres domaines ; son état est propre au domaine", async () => {
    const { result } = renderHook(() => useData(), { wrapper });
    let ensure!: Promise<void>;
    act(() => {
      ensure = result.current.ensureDomains(["students", "dashboardChartConfig", "rolePermissions"]);
      ensure.catch(() => undefined);
    });
    await waitFor(() => expect(server.pending).toHaveLength(3));
    await respond("/backoffice/dashboard-chart-config", chart("v1"));
    await fail("/students", new ApiError("panne", 500));
    await respond("/backoffice/role-permissions", role("Secrétaire"));
    await act(async () => {
      await expect(ensure).rejects.toThrow(/students/);
    });
    expect(result.current.state.dashboardChartConfig).toMatchObject({ platform: { marker: "v1" } });
    expect(result.current.state.rolePermissions).toHaveProperty("Secrétaire");
    expect(result.current.domainStatus.students).toMatchObject({ status: "error", kind: "http", httpStatus: 500 });
    expect(result.current.domainStatus.dashboardChartConfig?.status).toBe("ready");
  });

  it("délai dépassé : la donnée valide précédente est conservée, jamais remplacée par une liste vide", async () => {
    const { result } = renderHook(() => useData(), { wrapper });
    act(() => {
      void result.current.ensureDomains(["students"]);
    });
    await waitFor(() => expect(server.pending).toHaveLength(1));
    await respond("/students", [student(0), student(1), student(2)]);
    expect(result.current.state.students).toHaveLength(3);

    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refresh(["students"]);
      refresh.catch(() => undefined);
    });
    await waitFor(() => expect(server.pending).toHaveLength(1));
    await fail("/students", new ApiTimeoutError("GET", 20_000));
    await act(async () => {
      await expect(refresh).rejects.toThrow(/Délai/);
    });
    expect(result.current.state.students).toHaveLength(3);
    expect(result.current.domainStatus.students).toMatchObject({ status: "error", kind: "timeout" });
  });

  it("une réponse obsolète n'écrase pas une lecture plus récente", async () => {
    const { result } = renderHook(() => useData(), { wrapper });
    act(() => {
      void result.current.refresh(["students"]).catch(() => undefined);
    });
    await waitFor(() => expect(server.pending).toHaveLength(1));
    act(() => {
      void result.current.refresh(["students"]).catch(() => undefined);
    });
    await waitFor(() => expect(server.pending).toHaveLength(2));
    // La seconde lecture (après mutation) répond d'abord, la première ensuite.
    const [older, newer] = server.pending.splice(0, 2);
    await act(async () => {
      newer.resolve([student(0), student(1)]);
      await Promise.resolve();
    });
    await act(async () => {
      older.resolve([student(0)]);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.state.students).toHaveLength(2));
  });

  it("rafraîchissement après mutation : seul le domaine concerné est relu", async () => {
    const { result } = renderHook(() => useData(), { wrapper });
    act(() => {
      void result.current.ensureDomains(["students", "dashboardChartConfig"]);
    });
    await waitFor(() => expect(server.pending).toHaveLength(2));
    await respond("/students", [student(0)]);
    await respond("/backoffice/dashboard-chart-config", chart("v1"));
    vi.mocked(api.get).mockClear();
    act(() => {
      void result.current.refresh(["students"]);
    });
    await waitFor(() => expect(server.pending).toHaveLength(1));
    expect(pathsRequested()).toEqual(["/students"]);
    await respond("/students", [student(0), student(1)]);
    expect(result.current.state.students).toHaveLength(2);
    expect(result.current.state.dashboardChartConfig).toMatchObject({ platform: { marker: "v1" } });
  });

  it("relancer : seuls les domaines en erreur repartent", async () => {
    const { result } = renderHook(() => useData(), { wrapper });
    act(() => {
      void result.current.ensureDomains(["students", "dashboardChartConfig"]).catch(() => undefined);
    });
    await waitFor(() => expect(server.pending).toHaveLength(2));
    await respond("/backoffice/dashboard-chart-config", chart("v1"));
    await fail("/students", new ApiError("panne", 503));
    await waitFor(() => expect(result.current.domainStatus.students?.status).toBe("error"));
    vi.mocked(api.get).mockClear();
    act(() => {
      void result.current.retryDomains();
    });
    await waitFor(() => expect(server.pending).toHaveLength(1));
    expect(pathsRequested()).toEqual(["/students"]);
    await respond("/students", [student(0)]);
    expect(result.current.domainStatus.students?.status).toBe("ready");
  });
});

describe("DataContext — annulation et isolation (PERF-PR4)", () => {
  it("déconnexion pendant une lecture lente : requête annulée, rien n'est fusionné", async () => {
    const { result, rerender } = renderHook(() => useData(), { wrapper });
    let ensure!: Promise<void>;
    act(() => {
      ensure = result.current.ensureDomains(["students"]);
      ensure.catch(() => undefined);
    });
    await waitFor(() => expect(server.pending).toHaveLength(1));
    const inFlight = server.pending[0];

    auth.session = null;
    rerender();
    await waitFor(() => expect(inFlight.signal?.aborted).toBe(true));
    await act(async () => {
      await ensure; // résolue sans erreur visible
    });
    expect(result.current.error).toBeNull();
    expect(result.current.state.students).toEqual([]);
  });

  it("utilisateur suivant : une réponse tardive de l'ancien compte n'est jamais fusionnée", async () => {
    const { result, rerender } = renderHook(() => useData(), { wrapper });
    act(() => {
      void result.current.ensureDomains(["students"]).catch(() => undefined);
    });
    await waitFor(() => expect(server.pending).toHaveLength(1));
    const late = server.pending.splice(0, 1)[0];

    auth.session = sessionFor(user("admin-b"));
    rerender();
    // Serveur qui ignore l'annulation : la réponse de l'ancien compte arrive quand même.
    await act(async () => {
      late.resolve([student(0), student(1), student(2)]);
      await Promise.resolve();
    });
    expect(late.signal?.aborted).toBe(true);
    expect(result.current.state.students).toEqual([]);

    act(() => {
      void result.current.ensureDomains(["students"]);
    });
    await waitFor(() => expect(server.pending).toHaveLength(1));
    await respond("/students", [student(7)]);
    expect(result.current.state.students.map((row) => row.id)).toEqual(["CD-IN-EL-26-00008"]);
  });

  it("changement d'établissement : lectures scolaires annulées, catalogue plateforme conservé", async () => {
    const { result } = renderHook(() => useData(), { wrapper });
    act(() => {
      void result.current.ensureDomains(["students", "dashboardChartConfig"]).catch(() => undefined);
    });
    await waitFor(() => expect(server.pending).toHaveLength(2));
    const studentsA = server.pending.find((entry) => entry.path === "/students");
    const chartRequest = server.pending.find((entry) => entry.path === "/backoffice/dashboard-chart-config");

    act(() => result.current.beginScopeTransition("CD-IN-26-002"));
    expect(studentsA?.signal?.aborted).toBe(true);
    expect(chartRequest?.signal?.aborted).toBe(false);

    await respond("/backoffice/dashboard-chart-config", chart("v1"));
    expect(result.current.state.dashboardChartConfig).toMatchObject({ platform: { marker: "v1" } });
    expect(result.current.error).toBeNull();
  });

  it("changement rapide A → B → A : aucune ligne de l'établissement quitté", async () => {
    const { result } = renderHook(() => useData(), { wrapper });
    act(() => {
      void result.current.ensureDomains(["students"]).catch(() => undefined);
    });
    await waitFor(() => expect(server.pending).toHaveLength(1));
    const first = server.pending.splice(0, 1)[0];
    act(() => result.current.beginScopeTransition("CD-IN-26-002"));
    act(() => result.current.beginScopeTransition(LOGIN_A));
    await act(async () => {
      first.resolve([student(0)]); // réponse tardive de la portée annulée
      await Promise.resolve();
    });
    expect(result.current.state.students).toEqual([]);
  });

  it("401 sur un domaine : jamais une donnée exploitable", async () => {
    const { result } = renderHook(() => useData(), { wrapper });
    let ensure!: Promise<void>;
    act(() => {
      ensure = result.current.ensureDomains(["students"]);
      ensure.catch(() => undefined);
    });
    await waitFor(() => expect(server.pending).toHaveLength(1));
    await fail("/students", new ApiError("Unauthorized", 401));
    await act(async () => {
      await expect(ensure).rejects.toThrow(/session expirée/);
    });
    expect(result.current.state.students).toEqual([]);
    expect(result.current.domainStatus.students).toMatchObject({ status: "error", httpStatus: 401 });
  });
});
