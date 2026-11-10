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

/**
 * Toutes les lignes d'une requête, page après page, sans doublon ni plafond arbitraire.
 * Une page qui annonce une suite sans curseur, ou un curseur déjà vu, est une erreur :
 * une liste partielle n'est jamais renvoyée comme complète.
 */
export class PresencesLoadStopped extends Error {
  constructor() {
    super("Lecture des présences interrompue.");
  }
}

export async function fetchAllPresences(
  query: Omit<PresencesPageQuery, "cursor">,
  shouldStop: () => boolean = () => false,
): Promise<PresenceRow[]> {
  const rows: PresenceRow[] = [];
  const seenRows = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    if (shouldStop()) throw new PresencesLoadStopped();
    const response = await fetchPresencesPage({ ...query, limit: PRESENCES_PAGE_LIMIT, cursor });
    for (const row of response.items) {
      const id = String(row.id ?? "");
      if (id && seenRows.has(id)) continue;
      if (id) seenRows.add(id);
      rows.push(row);
    }
    if (!response.hasMore) return rows;
    if (!response.nextCursor || seenCursors.has(response.nextCursor)) {
      throw new Error("Pagination des présences incomplète.");
    }
    seenCursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }
}

/** Présences d'une classe pour un jour (filtre SQL classId). */
export function fetchClassDayPresences(
  day: string,
  classId: string,
  shouldStop?: () => boolean,
): Promise<PresenceRow[]> {
  return fetchAllPresences({ date: day, classId }, shouldStop);
}

export async function fetchPresenceById(attendanceId: string): Promise<PresenceRow | null> {
  const response = await fetchPresencesPage({ attendanceId, limit: 1 });
  return response.items[0] ?? null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalClassId(value: string | null | undefined): value is string {
  return UUID_PATTERN.test(String(value ?? "").trim());
}

/** Nombre de classes lues en parallèle pour les cartes. */
const CARD_CONCURRENCY = 3;

export type ClassDayEntry = {
  /** Dernière liste complète de la classe ; null tant qu'aucune lecture n'a abouti. */
  rows: PresenceRow[] | null;
  status: "idle" | "loading" | "complete" | "error";
  error: string | null;
};

const IDLE_ENTRY: ClassDayEntry = { rows: null, status: "idle", error: null };

/**
 * Présences du jour, classe par classe (écran d'appel du personnel).
 * - La classe ouverte est lue seule et en priorité ; les autres attendent.
 * - Sans classe ouverte, les cartes sont lues CARD_CONCURRENCY par CARD_CONCURRENCY.
 * - Une erreur garde la dernière liste complète ; une lecture partielle n'est jamais exposée.
 */
export function useClassDayPresences(input: {
  enabled: boolean;
  day: string;
  classIds: readonly string[];
  priorityClassId: string | null;
}) {
  const { enabled, day, priorityClassId } = input;
  const classKey = [...new Set(input.classIds.filter(isCanonicalClassId))].sort().join(",");
  const [entries, setEntries] = useState<Record<string, ClassDayEntry>>({});
  const inFlight = useRef(new Set<string>());
  const generation = useRef(0);
  const priorityRef = useRef(priorityClassId);
  priorityRef.current = priorityClassId;

  const load = useCallback(
    async (classId: string) => {
      if (!enabled || !isCanonicalClassId(classId)) return;
      const current = generation.current;
      inFlight.current.add(classId);
      setEntries((prev) => ({
        ...prev,
        [classId]: { ...(prev[classId] ?? IDLE_ENTRY), status: "loading", error: null },
      }));
      // Une lecture de carte s'arrête entre deux pages dès qu'une autre classe est ouverte.
      const shouldStop = () =>
        current !== generation.current || (priorityRef.current !== null && priorityRef.current !== classId);
      try {
        const rows = await fetchClassDayPresences(day, classId, shouldStop);
        if (current !== generation.current) return;
        setEntries((prev) => ({ ...prev, [classId]: { rows, status: "complete", error: null } }));
      } catch (cause) {
        if (current !== generation.current) return;
        if (cause instanceof PresencesLoadStopped) {
          setEntries((prev) => ({
            ...prev,
            [classId]: { ...(prev[classId] ?? IDLE_ENTRY), status: prev[classId]?.rows ? "complete" : "idle", error: null },
          }));
          return;
        }
        const message = cause instanceof Error ? cause.message : "Chargement des présences impossible.";
        setEntries((prev) => ({
          ...prev,
          [classId]: { ...(prev[classId] ?? IDLE_ENTRY), status: "error", error: message },
        }));
      } finally {
        if (current === generation.current) inFlight.current.delete(classId);
      }
    },
    [enabled, day],
  );

  // Changement de jour ou d'utilisateur : tout est relu.
  useEffect(() => {
    generation.current += 1;
    inFlight.current = new Set();
    setEntries({});
  }, [enabled, day]);

  useEffect(() => {
    if (!enabled) return;
    const wanted = priorityClassId
      ? isCanonicalClassId(priorityClassId)
        ? [priorityClassId]
        : []
      : classKey
        ? classKey.split(",")
        : [];
    const pending = wanted.filter((id) => (entries[id]?.status ?? "idle") === "idle" && !inFlight.current.has(id));
    const slots = priorityClassId ? 1 : CARD_CONCURRENCY - inFlight.current.size;
    for (const classId of pending.slice(0, Math.max(0, slots))) void load(classId);
  }, [enabled, classKey, priorityClassId, entries, load]);

  const reload = useCallback((classId: string) => load(classId), [load]);
  const retryFailed = useCallback(() => {
    setEntries((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, entry]) => [id, entry.status === "error" ? { ...entry, status: "idle" } : entry]),
      ),
    );
  }, []);

  const entryFor = useCallback((classId: string | null | undefined): ClassDayEntry => {
    if (!classId) return IDLE_ENTRY;
    return entries[classId] ?? IDLE_ENTRY;
  }, [entries]);

  return { entries, entryFor, reload, retryFailed };
}
