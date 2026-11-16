import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ api: { get } }));

import {
  fetchAllPresences,
  fetchClassDayPresences,
  fetchPresenceById,
  fetchPresencesPage,
  isCanonicalClassId,
  isoAttendanceDay,
  useClassDayPresences,
} from "./presencesPageApi";

const DAY = "2026-11-04";
const CLASS_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const CLASS_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const CLASS_C = "cccccccc-0000-4000-8000-00000000000c";
const CLASS_D = "dddddddd-0000-4000-8000-00000000000d";

function page(ids: string[], nextCursor: string | null, hasMore = nextCursor !== null) {
  return { items: ids.map((id) => ({ id, date: DAY })), nextCursor, hasMore };
}

function query(path: string) {
  return new URL(`http://test${path}`).searchParams;
}

/** Serveur simulé : `perClass` lignes par classe, servies par pages de `limit`. */
function serveClasses(perClass: Record<string, number>) {
  get.mockImplementation(async (path: string) => {
    const params = query(path);
    const classId = params.get("classId") ?? "";
    const limit = Number(params.get("limit"));
    const offset = Number(params.get("cursor") ?? 0);
    const total = perClass[classId] ?? 0;
    const ids = Array.from({ length: Math.min(limit, Math.max(0, total - offset)) }, (_, i) => `${classId}-${offset + i}`);
    const next = offset + ids.length < total ? String(offset + ids.length) : null;
    return { items: ids.map((id) => ({ id, classId, date: DAY })), nextCursor: next, hasMore: next !== null };
  });
}

describe("presencesPageApi", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("jour civil local au format AAAA-MM-JJ", () => {
    expect(isoAttendanceDay(new Date(2026, 10, 4, 23, 59))).toBe("2026-11-04");
    expect(isoAttendanceDay(new Date(2026, 0, 2))).toBe("2026-01-02");
  });

  it("transmet filtres, limite et curseur sans paramètre vide", async () => {
    get.mockResolvedValueOnce(page([], null));
    await fetchPresencesPage({ date: DAY, classId: "", limit: 50, cursor: "abc" });
    expect(get).toHaveBeenCalledWith(`/v2/presences?date=${DAY}&limit=50&cursor=abc`);
  });

  it("suit les pages jusqu'à la fin, sans doublon", async () => {
    get
      .mockResolvedValueOnce(page(["a", "b"], "c1"))
      .mockResolvedValueOnce(page(["b", "c"], "c2"))
      .mockResolvedValueOnce(page(["d"], null));
    const rows = await fetchAllPresences({ date: DAY });
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    expect(get).toHaveBeenNthCalledWith(2, `/v2/presences?date=${DAY}&limit=200&cursor=c1`);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("classe : filtre classId transmis au serveur", async () => {
    get.mockResolvedValueOnce(page([], null));
    await fetchClassDayPresences(DAY, CLASS_A);
    expect(get).toHaveBeenCalledWith(`/v2/presences?date=${DAY}&classId=${CLASS_A}&limit=200`);
  });

  it("aucun plafond arbitraire : une journée de 5 000 présences est lue en entier (25 pages)", async () => {
    serveClasses({ [CLASS_A]: 5000 });
    const rows = await fetchClassDayPresences(DAY, CLASS_A);
    expect(rows).toHaveLength(5000);
    expect(new Set(rows.map((row) => row.id)).size).toBe(5000);
    expect(get).toHaveBeenCalledTimes(25);
  });

  it("une page qui annonce une suite sans curseur n'est jamais prise pour la liste complète", async () => {
    get.mockResolvedValueOnce(page(["a"], null, true));
    await expect(fetchAllPresences({ date: DAY })).rejects.toThrow(/incomplète/);
  });

  it("un curseur déjà vu (boucle serveur) est une erreur, pas une liste complète", async () => {
    get.mockResolvedValueOnce(page(["a"], "same")).mockResolvedValueOnce(page(["b"], "same"));
    await expect(fetchAllPresences({ date: DAY })).rejects.toThrow(/incomplète/);
  });

  it("refuse une réponse qui n'est pas une page", async () => {
    get.mockResolvedValueOnce([{ id: "a" }]);
    await expect(fetchPresencesPage({ date: DAY })).rejects.toThrow(/inattendue/);
  });

  it("lien profond : une seule ligne demandée par identifiant", async () => {
    get.mockResolvedValueOnce(page(["p-9"], null));
    expect(await fetchPresenceById("p-9")).toEqual({ id: "p-9", date: DAY });
    expect(get).toHaveBeenCalledWith("/v2/presences?attendanceId=p-9&limit=1");
  });

  it("identifiant de classe canonique = UUID", () => {
    expect(isCanonicalClassId(CLASS_A)).toBe(true);
    expect(isCanonicalClassId("CLS-A")).toBe(false);
    expect(isCanonicalClassId("")).toBe(false);
  });
});

describe("useClassDayPresences", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("plusieurs classes : chaque carte a sa liste complète, une requête par classe", async () => {
    serveClasses({ [CLASS_A]: 3, [CLASS_B]: 450, [CLASS_C]: 0, [CLASS_D]: 1 });
    const { result } = renderHook(() =>
      useClassDayPresences({ enabled: true, day: DAY, classIds: [CLASS_A, CLASS_B, CLASS_C, CLASS_D], priorityClassId: null }),
    );
    await waitFor(() =>
      expect([CLASS_A, CLASS_B, CLASS_C, CLASS_D].every((id) => result.current.entryFor(id).status === "complete")).toBe(true),
    );
    expect(result.current.entryFor(CLASS_A).rows).toHaveLength(3);
    expect(result.current.entryFor(CLASS_B).rows).toHaveLength(450);
    expect(result.current.entryFor(CLASS_C).rows).toEqual([]);
    expect(result.current.entryFor(CLASS_D).rows).toHaveLength(1);
    for (const [path] of get.mock.calls) {
      expect(query(path).get("classId")).not.toBeNull();
      expect(query(path).get("date")).toBe(DAY);
    }
    // Chaque ligne reste dans sa classe.
    expect(result.current.entryFor(CLASS_B).rows?.every((row) => row.classId === CLASS_B)).toBe(true);
  });

  it("classe ouverte : seule sa lecture part, même si la journée dépasse 4 000 présences", async () => {
    serveClasses({ [CLASS_A]: 4200, [CLASS_B]: 10 });
    const { result } = renderHook(() =>
      useClassDayPresences({ enabled: true, day: DAY, classIds: [CLASS_A, CLASS_B], priorityClassId: CLASS_A }),
    );
    await waitFor(() => expect(result.current.entryFor(CLASS_A).status).toBe("complete"));
    expect(result.current.entryFor(CLASS_A).rows).toHaveLength(4200);
    expect(result.current.entryFor(CLASS_B).status).toBe("idle");
    expect(get.mock.calls.every(([path]) => query(path).get("classId") === CLASS_A)).toBe(true);
  });

  it("ouvrir une classe interrompt les cartes entre deux pages ; elles reprennent ensuite", async () => {
    serveClasses({ [CLASS_A]: 1000, [CLASS_B]: 5 });
    const { result, rerender } = renderHook(
      ({ priority }: { priority: string | null }) =>
        useClassDayPresences({ enabled: true, day: DAY, classIds: [CLASS_A, CLASS_B], priorityClassId: priority }),
      { initialProps: { priority: null as string | null } },
    );
    rerender({ priority: CLASS_B });
    await waitFor(() => expect(result.current.entryFor(CLASS_B).status).toBe("complete"));
    await waitFor(() => expect(result.current.entryFor(CLASS_A).status).toBe("idle"));
    expect(result.current.entryFor(CLASS_A).rows).toBeNull();
    const pagesOfA = get.mock.calls.filter(([path]) => query(path).get("classId") === CLASS_A).length;
    expect(pagesOfA).toBeLessThan(5);
    rerender({ priority: null });
    await waitFor(() => expect(result.current.entryFor(CLASS_A).status).toBe("complete"));
    expect(result.current.entryFor(CLASS_A).rows).toHaveLength(1000);
  });

  it("erreur en cours de pagination : aucune liste partielle exposée", async () => {
    get.mockResolvedValueOnce(page(["a1"], "c1")).mockRejectedValueOnce(new Error("Réseau indisponible"));
    const { result } = renderHook(() =>
      useClassDayPresences({ enabled: true, day: DAY, classIds: [CLASS_A], priorityClassId: CLASS_A }),
    );
    await waitFor(() => expect(result.current.entryFor(CLASS_A).status).toBe("error"));
    expect(result.current.entryFor(CLASS_A).rows).toBeNull();
    expect(result.current.entryFor(CLASS_A).error).toBe("Réseau indisponible");
  });

  it("rechargement en échec : la dernière liste complète est conservée", async () => {
    get.mockResolvedValueOnce(page(["a1", "a2"], null)).mockRejectedValueOnce(new Error("Réseau indisponible"));
    const { result } = renderHook(() =>
      useClassDayPresences({ enabled: true, day: DAY, classIds: [CLASS_A], priorityClassId: CLASS_A }),
    );
    await waitFor(() => expect(result.current.entryFor(CLASS_A).status).toBe("complete"));
    await act(async () => {
      await result.current.reload(CLASS_A);
    });
    expect(result.current.entryFor(CLASS_A).status).toBe("error");
    expect(result.current.entryFor(CLASS_A).rows?.map((row) => row.id)).toEqual(["a1", "a2"]);
  });

  it("réessayer relit les classes en échec", async () => {
    get.mockRejectedValueOnce(new Error("Réseau indisponible")).mockResolvedValueOnce(page(["a1"], null));
    const { result } = renderHook(() =>
      useClassDayPresences({ enabled: true, day: DAY, classIds: [CLASS_A], priorityClassId: null }),
    );
    await waitFor(() => expect(result.current.entryFor(CLASS_A).status).toBe("error"));
    act(() => result.current.retryFailed());
    await waitFor(() => expect(result.current.entryFor(CLASS_A).status).toBe("complete"));
    expect(result.current.entryFor(CLASS_A).rows).toHaveLength(1);
  });

  it("identifiant non canonique : aucune requête", async () => {
    const { result } = renderHook(() =>
      useClassDayPresences({ enabled: true, day: DAY, classIds: ["CLS-A"], priorityClassId: "CLS-A" }),
    );
    await act(async () => undefined);
    expect(get).not.toHaveBeenCalled();
    expect(result.current.entryFor("CLS-A").rows).toBeNull();
  });

  it("désactivé (parent) : aucune requête", async () => {
    renderHook(() => useClassDayPresences({ enabled: false, day: DAY, classIds: [CLASS_A], priorityClassId: null }));
    await act(async () => undefined);
    expect(get).not.toHaveBeenCalled();
  });

  it("changement de jour : la classe est relue pour le nouveau jour", async () => {
    get.mockResolvedValueOnce(page(["a"], null)).mockResolvedValueOnce(page(["z"], null));
    const { result, rerender } = renderHook(
      ({ day }) => useClassDayPresences({ enabled: true, day, classIds: [CLASS_A], priorityClassId: CLASS_A }),
      { initialProps: { day: DAY } },
    );
    await waitFor(() => expect(result.current.entryFor(CLASS_A).rows?.map((row) => row.id)).toEqual(["a"]));
    rerender({ day: "2026-11-05" });
    await waitFor(() => expect(result.current.entryFor(CLASS_A).rows?.map((row) => row.id)).toEqual(["z"]));
    expect(get).toHaveBeenLastCalledWith(`/v2/presences?date=2026-11-05&classId=${CLASS_A}&limit=200`);
  });
});
