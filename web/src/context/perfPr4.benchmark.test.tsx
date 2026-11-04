import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHOOL_ADMIN_ROLE } from "../lib/orgHierarchy";
import type { SessionUser } from "../types";

/**
 * PERF-PR4 — banc reproductible (temps SIMULÉ, minuteurs factices) :
 * vrai client HTTP + vrais loaders + vrai DataContext, seul `fetch` est simulé.
 *   A = /backoffice/dashboard-chart-config : 100 ms
 *   B = /backoffice/role-permissions      : 1 500 ms
 *   C = /students                         : 8 000 ms (ou sans réponse pour le cas « délai »)
 * « Avant » = fusion à la fin du lot (moment où loadDomains se résout, comportement
 * historique Promise.allSettled) et client sans délai.
 * Ces mesures ne sont pas des temps de préproduction.
 * Lancer : npx vitest run src/context/perfPr4.benchmark.test.tsx
 */

const auth = vi.hoisted(() => ({ session: null as Record<string, unknown> | null }));
vi.mock("./AuthContext", () => ({ useAuth: () => ({ session: auth.session, permissionsReady: true }) }));

import { configureHttpTimeouts, httpTimeouts, setAccessTokenProvider } from "../api/client";
import { loadDomains } from "../lib/domainLoaders";
import { DataProvider, useData } from "./DataContext";

const SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOGIN = "CD-IN-26-001";
const DELAYS: Record<string, number | null> = {
  "/backoffice/dashboard-chart-config": 100,
  "/backoffice/role-permissions": 1_500,
  "/students": 8_000,
  "/classes": 300,
};

const BODIES: Record<string, unknown> = {
  "/backoffice/dashboard-chart-config": { platform: { a: 1 }, establishment: {} },
  "/backoffice/role-permissions": { Secrétaire: ["Élèves:READ"] },
  "/students": [
    {
      id: "CD-IN-EL-26-00001",
      publicId: "CD-IN-EL-26-00001",
      studentCode: "CD-IN-EL-26-00001",
      firstName: "Awa",
      lastName: "Diop",
      name: "Awa Diop",
      schoolId: SCHOOL_ID,
      schoolCode: LOGIN,
      schoolPublicCode: LOGIN,
      status: "active",
    },
  ],
  "/classes": [],
};

type Stats = { requests: string[]; aborted: string[] };
let stats: Stats;

function installFetch() {
  stats = { requests: [], aborted: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname.replace(/^\/api/, "");
      stats.requests.push(path);
      return new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => {
            stats.aborted.push(path);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
        const delay = DELAYS[path];
        if (delay === null || delay === undefined) return; // sans réponse
        setTimeout(() => {
          const text = JSON.stringify(BODIES[path] ?? []);
          resolve({ ok: true, status: 200, text: async () => text, json: async () => BODIES[path] } as unknown as Response);
        }, delay);
      });
    }),
  );
}

const user = {
  id: "admin-bench",
  firstName: "Admin",
  lastName: "Bench",
  role: SCHOOL_ADMIN_ROLE,
  schoolCode: LOGIN,
  schoolPublicCode: LOGIN,
  schoolId: SCHOOL_ID,
  identifier: "admin-bench",
} as SessionUser;

function wrapper({ children }: { children: ReactNode }) {
  return <DataProvider>{children}</DataProvider>;
}

const results: Record<string, unknown> = {};
const defaultReadMs = httpTimeouts.readMs;

beforeEach(() => {
  vi.useFakeTimers();
  auth.session = { user, accessToken: "t", scope: { label: "Établissement", hint: LOGIN } };
  setAccessTokenProvider(() => "t");
  installFetch();
});

afterEach(() => {
  configureHttpTimeouts({ readMs: defaultReadMs });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const DOMAINS = ["dashboardChartConfig", "rolePermissions", "students"] as const;

describe("PERF-PR4 — banc simulé A 100 ms / B 1 500 ms / C 8 000 ms", () => {
  it("avant : fusion du lot entier quand le plus lent répond", async () => {
    const start = Date.now();
    let mergedAt: number | null = null;
    void loadDomains([...DOMAINS], { schoolCode: LOGIN, role: SCHOOL_ADMIN_ROLE }).then(() => {
      mergedAt = Date.now() - start;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    results.before = {
      firstDataMs: mergedAt,
      perDomainMs: { A: mergedAt, B: mergedAt, C: mergedAt },
      completeMs: mergedAt,
      requests: stats.requests.length,
    };
    expect(mergedAt).toBe(8_000);
  });

  it("après : chaque domaine visible dès sa réponse", async () => {
    const { result } = renderHook(() => useData(), { wrapper });
    const start = Date.now();
    const seen: Record<string, number> = {};
    let completeMs: number | null = null;
    act(() => {
      void result.current.ensureDomains([...DOMAINS]).then(() => (completeMs = Date.now() - start));
    });
    for (let t = 0; t < 10_000; t += 50) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      const status = result.current.domainStatus;
      for (const [label, domain] of [["A", "dashboardChartConfig"], ["B", "rolePermissions"], ["C", "students"]] as const) {
        if (status[domain]?.status === "ready" && seen[label] === undefined) seen[label] = Date.now() - start;
      }
    }
    results.after = {
      firstDataMs: Math.min(...Object.values(seen)),
      perDomainMs: seen,
      completeMs,
      requests: stats.requests.length,
      abortedRequests: stats.aborted.length,
    };
    expect(seen.A).toBeLessThanOrEqual(150);
    expect(seen.B).toBeLessThanOrEqual(1_550);
    expect(seen.C).toBeLessThanOrEqual(8_050);
    expect(completeMs).not.toBeNull();
    expect(result.current.state.students).toHaveLength(1);
  });

  it("endpoint sans réponse : avant bloqué, après A et B affichés puis C en délai à 20 s", async () => {
    DELAYS["/students"] = null;
    try {
      // Avant : client sans délai, le lot ne se termine jamais.
      configureHttpTimeouts({ readMs: 0 });
      let beforeDone: number | null = null;
      const startBefore = Date.now();
      void loadDomains([...DOMAINS], { schoolCode: LOGIN, role: SCHOOL_ADMIN_ROLE }).then(() => {
        beforeDone = Date.now() - startBefore;
      });
      await vi.advanceTimersByTimeAsync(120_000);

      // Après : délai de lecture 20 s.
      configureHttpTimeouts({ readMs: 20_000 });
      installFetch();
      const { result } = renderHook(() => useData(), { wrapper });
      const start = Date.now();
      let settledAt: number | null = null;
      act(() => {
        void result.current
          .ensureDomains([...DOMAINS])
          .catch(() => undefined)
          .then(() => (settledAt = Date.now() - start));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      const visibleAt2s = {
        A: result.current.domainStatus.dashboardChartConfig?.status,
        B: result.current.domainStatus.rolePermissions?.status,
        C: result.current.domainStatus.students?.status,
      };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      results.timeout = {
        before: { completedWithin120s: beforeDone !== null },
        after: {
          at2s: visibleAt2s,
          settledMs: settledAt,
          students: result.current.domainStatus.students,
        },
      };
      expect(beforeDone).toBeNull();
      expect(visibleAt2s).toEqual({ A: "ready", B: "ready", C: "loading" });
      expect(result.current.domainStatus.students).toMatchObject({ status: "error", kind: "timeout" });
      expect(settledAt).toBe(20_000);
    } finally {
      DELAYS["/students"] = 8_000;
    }
  });

  it("navigation rapide : domaine commun partagé, aucune requête en double", async () => {
    const { result } = renderHook(() => useData(), { wrapper });
    act(() => {
      void result.current.ensureDomains(["students", "rolePermissions"]); // écran 1
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    act(() => {
      void result.current.ensureDomains(["students", "classes"]); // écran 2, 200 ms plus tard
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    results.navigation = { requests: [...stats.requests], aborted: [...stats.aborted] };
    expect(stats.requests.filter((path) => path === "/students")).toHaveLength(1);
    expect(stats.aborted).toEqual([]);
  });

  it("changement d'établissement : lectures scolaires annulées, plateforme poursuivie", async () => {
    const { result } = renderHook(() => useData(), { wrapper });
    act(() => {
      void result.current.ensureDomains([...DOMAINS]).catch(() => undefined);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() => result.current.beginScopeTransition("CD-IN-26-002"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    results.schoolSwitch = {
      requests: stats.requests.length,
      aborted: [...stats.aborted],
      studentsMerged: result.current.state.students.length,
      rolePermissionsReady: result.current.domainStatus.rolePermissions?.status,
    };
    expect(stats.aborted).toEqual(["/students"]);
    expect(result.current.state.students).toEqual([]);
    expect(result.current.domainStatus.rolePermissions?.status).toBe("ready");
    // Imprimé pour le rapport : résultats de tout le banc.
    console.log(`PERF-PR4-BENCH ${JSON.stringify(results)}`);
  });
});
