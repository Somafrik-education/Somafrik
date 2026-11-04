import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

/** PERF-PR3 — GET /api/v2/presences : pagination SQL par curseur (personnel établissement). */
export type PresenceRow = Record<string, unknown>;

export type PresencesPageResponse = {
  items: PresenceRow[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type PresencesPageQuery = {
  date?: string;
  from?: string;
  to?: string;
  classId?: string;
  studentId?: string;
  attendanceId?: string;
  status?: string;
  limit?: number;
  cursor?: string | null;
};

/** Taille de page maximale acceptée par le serveur. */
export const PRESENCES_PAGE_LIMIT = 200;
/** Garde-fou : 20 pages × 200 = 4 000 appels d'une journée. */
const MAX_PAGES_PER_DAY = 20;

/** Jour civil local du poste, au format AAAA-MM-JJ (même jour que formatAttendanceDate). */
export function isoAttendanceDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isPageResponse(body: unknown): body is PresencesPageResponse {
  if (!body || typeof body !== "object") return false;
  const value = body as Record<string, unknown>;
  return (
    Array.isArray(value.items) &&
    typeof value.hasMore === "boolean" &&
    (value.nextCursor === null || typeof value.nextCursor === "string")
  );
}

export async function fetchPresencesPage(query: PresencesPageQuery): Promise<PresencesPageResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const suffix = params.toString();
  const body = await api.get<unknown>(`/v2/presences${suffix ? `?${suffix}` : ""}`);
  if (!isPageResponse(body)) throw new Error("Réponse de présences inattendue.");
  return body;
}

/** Toutes les présences d'un jour, page après page, sans doublon. */
export async function fetchAllPresencesForDay(day: string): Promise<PresenceRow[]> {
  const rows: PresenceRow[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES_PER_DAY; page += 1) {
    const response = await fetchPresencesPage({ date: day, limit: PRESENCES_PAGE_LIMIT, cursor });
    for (const row of response.items) {
      const id = String(row.id ?? "");
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      rows.push(row);
    }
    if (!response.hasMore || !response.nextCursor) return rows;
    cursor = response.nextCursor;
  }
  throw new Error("Trop de présences pour une seule journée.");
}

export async function fetchPresenceById(attendanceId: string): Promise<PresenceRow | null> {
  const response = await fetchPresencesPage({ attendanceId, limit: 1 });
  return response.items[0] ?? null;
}

/**
 * Présences d'un jour pour l'écran d'appel. Une erreur conserve les lignes déjà affichées.
 */
export function useDayPresences(enabled: boolean, day: string) {
  const [rows, setRows] = useState<PresenceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      const next = await fetchAllPresencesForDay(day);
      if (current !== generation.current) return;
      setRows(next);
      setError(null);
    } catch (cause) {
      if (current !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "Chargement des présences impossible.");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [enabled, day]);

  useEffect(() => {
    if (!enabled) {
      generation.current += 1;
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }
    void reload();
  }, [enabled, reload]);

  return { rows, loading, error, reload, setRows };
}
