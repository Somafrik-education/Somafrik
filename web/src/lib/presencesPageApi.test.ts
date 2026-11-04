import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ api: { get } }));

import {
  fetchAllPresencesForDay,
  fetchPresenceById,
  fetchPresencesPage,
  isoAttendanceDay,
  useDayPresences,
} from "./presencesPageApi";

function page(ids: string[], nextCursor: string | null) {
  return { items: ids.map((id) => ({ id, date: "2026-11-04" })), nextCursor, hasMore: nextCursor !== null };
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
    await fetchPresencesPage({ date: "2026-11-04", classId: "", limit: 50, cursor: "abc" });
    expect(get).toHaveBeenCalledWith("/v2/presences?date=2026-11-04&limit=50&cursor=abc");
  });

  it("suit les pages jusqu'à la fin, sans doublon", async () => {
    get
      .mockResolvedValueOnce(page(["a", "b"], "c1"))
      .mockResolvedValueOnce(page(["b", "c"], "c2"))
      .mockResolvedValueOnce(page(["d"], null));
    const rows = await fetchAllPresencesForDay("2026-11-04");
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    expect(get).toHaveBeenNthCalledWith(2, "/v2/presences?date=2026-11-04&limit=200&cursor=c1");
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("journée vide", async () => {
    get.mockResolvedValueOnce(page([], null));
    expect(await fetchAllPresencesForDay("2026-11-04")).toEqual([]);
  });

  it("refuse une réponse qui n'est pas une page", async () => {
    get.mockResolvedValueOnce([{ id: "a" }]);
    await expect(fetchPresencesPage({ date: "2026-11-04" })).rejects.toThrow(/inattendue/);
  });

  it("borne le nombre de pages d'une journée", async () => {
    get.mockImplementation(async () => page([String(Math.random())], "next"));
    await expect(fetchAllPresencesForDay("2026-11-04")).rejects.toThrow(/Trop de présences/);
    expect(get).toHaveBeenCalledTimes(20);
  });

  it("lien profond : une seule ligne demandée par identifiant", async () => {
    get.mockResolvedValueOnce(page(["p-9"], null));
    expect(await fetchPresenceById("p-9")).toEqual({ id: "p-9", date: "2026-11-04" });
    expect(get).toHaveBeenCalledWith("/v2/presences?attendanceId=p-9&limit=1");
  });
});

describe("useDayPresences", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("chargement initial puis rafraîchissement", async () => {
    get.mockResolvedValueOnce(page(["a"], null)).mockResolvedValueOnce(page(["a", "b"], null));
    const { result } = renderHook(() => useDayPresences(true, "2026-11-04"));
    await waitFor(() => expect(result.current.rows.map((row) => row.id)).toEqual(["a"]));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(result.current.error).toBeNull();
  });

  it("erreur réseau : message affiché, lignes déjà chargées conservées", async () => {
    get.mockResolvedValueOnce(page(["a"], null)).mockRejectedValueOnce(new Error("Réseau indisponible"));
    const { result } = renderHook(() => useDayPresences(true, "2026-11-04"));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).toBe("Réseau indisponible");
    expect(result.current.rows.map((row) => row.id)).toEqual(["a"]);
  });

  it("désactivé (parent) : aucune requête", async () => {
    const { result } = renderHook(() => useDayPresences(false, "2026-11-04"));
    expect(result.current.rows).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("changement de jour : nouvelle lecture", async () => {
    get.mockResolvedValueOnce(page(["a"], null)).mockResolvedValueOnce(page(["z"], null));
    const { result, rerender } = renderHook(({ day }) => useDayPresences(true, day), {
      initialProps: { day: "2026-11-04" },
    });
    await waitFor(() => expect(result.current.rows.map((row) => row.id)).toEqual(["a"]));
    rerender({ day: "2026-11-05" });
    await waitFor(() => expect(result.current.rows.map((row) => row.id)).toEqual(["z"]));
    expect(get).toHaveBeenLastCalledWith("/v2/presences?date=2026-11-05&limit=200");
  });
});
