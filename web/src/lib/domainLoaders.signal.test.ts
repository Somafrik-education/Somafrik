import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PERF-PR4 — transmission du signal d'annulation et contrats historiques des loaders.
 * Les vrais modules *Api sont utilisés ; seul `api.get` est observé.
 */

const get = vi.hoisted(() => vi.fn<(path: string, init?: unknown) => Promise<unknown>>(async () => []));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, getAccessToken: () => "token", api: { ...actual.api, get } };
});

import { ApiAbortError } from "../api/client";
import { DOMAIN_KEYS, HEAVY_DOMAIN_TIMEOUT_MS, loadDomains, type DomainKey } from "./domainLoaders";
import { financeApi } from "./financeApi";
import { pedagogyApi } from "./pedagogyApi";
import { SCHOOL_ADMIN_ROLE } from "./orgHierarchy";
import { teachersApi } from "./teachersApi";

const OPTIONS = { schoolCode: "CD-IN-26-001", role: SCHOOL_ADMIN_ROLE };

function callsFor(path: string) {
  return get.mock.calls.filter(([called]) => String(called).split("?")[0] === path);
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (path: string) => {
    if (path === "/exams") return { exams: [] };
    if (path === "/report-cards") return { bulletins: [] };
    if (path === "/school-documents") return { documents: [] };
    if (path.endsWith("/academic-config")) return { schoolCode: "CD-IN-26-001" };
    if (path.startsWith("/backoffice/establishments/")) return { code: "CD-IN-26-001" };
    return [];
  });
});

describe("loadDomains — signal d'annulation transmis à chaque requête", () => {
  it("chaque domaine porte le signal du lot sur toutes ses requêtes", async () => {
    const controller = new AbortController();
    const result = await loadDomains([...DOMAIN_KEYS], OPTIONS, { signal: controller.signal });
    expect(result.serverErrors).toEqual([]);
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(DOMAIN_KEYS.length - 1);
    for (const [path, init] of get.mock.calls) {
      expect(init, `signal absent pour ${path}`).toMatchObject({ signal: controller.signal });
    }
  });

  it("enseignants et évaluations : signal transmis sans changer teachersApi.list() / listEvaluations()", async () => {
    const list = vi.spyOn(teachersApi, "list");
    const listEvaluations = vi.spyOn(pedagogyApi, "listEvaluations");
    const controller = new AbortController();
    await loadDomains(["teachers", "evaluations"], OPTIONS, { signal: controller.signal });
    expect(callsFor("/teachers")).toEqual([["/teachers", { signal: controller.signal }]]);
    expect(callsFor("/evaluations")).toEqual([["/evaluations", { signal: controller.signal }]]);
    expect(list).not.toHaveBeenCalled();
    expect(listEvaluations).not.toHaveBeenCalled();
    list.mockRestore();
    listEvaluations.mockRestore();
  });

  it("domaines d'historique : délai explicite de 60 s en plus du signal", async () => {
    const controller = new AbortController();
    await loadDomains(["presences", "notes", "payments", "studentFees"], OPTIONS, { signal: controller.signal });
    for (const path of ["/presences", "/notes", "/payments", "/finance/student-fees"]) {
      expect(callsFor(path)[0]?.[1]).toEqual({ signal: controller.signal, timeoutMs: HEAVY_DOMAIN_TIMEOUT_MS });
    }
  });

  it("annulation pendant le lot : domaine « aborted », ni donnée ni erreur", async () => {
    const controller = new AbortController();
    get.mockImplementation(
      (_path: string, init?: unknown) =>
        new Promise((_resolve, reject) => {
          (init as { signal?: AbortSignal } | undefined)?.signal?.addEventListener("abort", () =>
            reject(new ApiAbortError()),
          );
        }),
    );
    const pending = loadDomains(["students", "teachers"], OPTIONS, { signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.aborted.sort()).toEqual(["students", "teachers"]);
    expect(result.serverErrors).toEqual([]);
    expect(result.loaded).toEqual([]);
    expect(result.data).toEqual({});
  });
});

describe("contrats historiques sans option", () => {
  it("sans signal : appels identiques à l'historique (aucun second argument)", async () => {
    const light: DomainKey[] = ["students", "teachers", "classes", "evaluations", "courses", "users"];
    const list = vi.spyOn(teachersApi, "list");
    await loadDomains(light, OPTIONS);
    expect(list).toHaveBeenCalledWith();
    for (const path of ["/students", "/teachers", "/classes", "/evaluations", "/courses", "/backoffice/users"]) {
      expect(callsFor(path)).toEqual([[path]]);
    }
    list.mockRestore();
  });

  it("teachersApi.list() et pedagogyApi.listEvaluations() : un seul argument (le chemin)", async () => {
    await teachersApi.list();
    await pedagogyApi.listEvaluations();
    expect(get.mock.calls).toEqual([["/teachers"], ["/evaluations"]]);
  });

  it("financeApi.listStudentFees(studentId) : filtre élève inchangé, sans option", async () => {
    await financeApi.listStudentFees("ELE 1");
    await financeApi.listStudentFees();
    expect(get.mock.calls).toEqual([["/finance/student-fees?studentId=ELE%201"], ["/finance/student-fees"]]);
  });

  it("teachersApi n'expose aucune création", () => {
    expect(Object.keys(teachersApi).sort()).toEqual(["get", "list", "remove", "update"]);
  });
});
