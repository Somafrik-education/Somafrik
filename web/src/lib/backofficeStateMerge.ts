import type { BackOfficeState } from "../types";
import { dedupeAssignments } from "./pedagogySync";

type Row = Record<string, unknown> & { id?: string; schoolCode?: string };

function rowId(row: Row): string {
  return String(row.id ?? "");
}

function normalizeSchoolCode(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function schoolCodesInRows(rows: Row[]): Set<string> {
  const codes = new Set<string>();
  for (const row of rows) {
    const code = normalizeSchoolCode(row.schoolCode);
    if (code) codes.add(code);
  }
  return codes;
}

/** Fusionne deux listes par identifiant (remote prioritaire). */
export function mergeRowsById<T extends Row>(prev: T[] = [], remote: T[] = []): T[] {
  const map = new Map<string, T>();
  for (const row of prev) {
    const id = rowId(row);
    if (id) map.set(id, row);
  }
  for (const row of remote) {
    const id = rowId(row);
    if (id) map.set(id, row);
  }
  return [...map.values()];
}

/**
 * Remplace les lignes des établissements présents dans `remote`, conserve le reste.
 * Miroir de mergeScopedRows côté backend (réponses GET/PUT scopées).
 */
export function mergeScopedSchoolRows<T extends Row>(prev: T[] = [], remote: T[] = []): T[] {
  if (!remote.length && prev.length) return prev;
  const scope = schoolCodesInRows(remote);
  if (!scope.size) return remote.length ? remote : prev;
  const kept = prev.filter((row) => !scope.has(normalizeSchoolCode(row.schoolCode)));
  return mergeRowsById(kept, remote);
}

/**
 * Ne remplace pas une liste locale non vide par un tableau vide reçu du serveur
 * (réponse partielle ou synchronisation incomplète).
 */
export function preferNonEmptyRemote<T>(prev: T[] | undefined, remote: T[] | undefined): T[] {
  const local = prev ?? [];
  const incoming = remote ?? [];
  if (!incoming.length && local.length) return local;
  return incoming.length ? incoming : local;
}

/** Applique uniquement les clés présentes dans le patch (réponse PUT partielle). */
export function applyPartialSave(
  prev: BackOfficeState,
  saved: Partial<BackOfficeState>,
  patch: Partial<BackOfficeState>,
): BackOfficeState {
  const next: BackOfficeState = { ...prev };
  const scopedListKeys = new Set(["courseSchedules", "classes", "courses", "assignments", "exams"]);

  for (const key of Object.keys(patch) as (keyof BackOfficeState)[]) {
    if (!Object.prototype.hasOwnProperty.call(saved, key)) continue;
    const value = saved[key];
    if (value === undefined) continue;

    if (scopedListKeys.has(key) && Array.isArray(value)) {
      const merged = mergeScopedSchoolRows(
        (prev[key] as Row[] | undefined) ?? [],
        value as Row[],
      );
      (next as unknown as Record<string, unknown>)[key as string] =
        key === "assignments" ? dedupeAssignments(merged) : merged;
      continue;
    }

    (next as unknown as Record<string, unknown>)[key as string] = value;
  }

  return next;
}

/** Fusion prudente d'un instantané GET avec l'état local. */
export function mergeRemoteSnapshot(
  prev: BackOfficeState,
  remote: Partial<BackOfficeState>,
): BackOfficeState {
  const merged: BackOfficeState = { ...prev, ...remote };

  merged.courseSchedules = mergeScopedSchoolRows(
    prev.courseSchedules as Row[],
    (remote.courseSchedules as Row[] | undefined) ?? [],
  ) as BackOfficeState["courseSchedules"];

  merged.classes = mergeScopedSchoolRows(
    prev.classes as Row[],
    (remote.classes as Row[] | undefined) ?? [],
  ) as BackOfficeState["classes"];

  merged.courses = mergeScopedSchoolRows(
    prev.courses as Row[],
    (remote.courses as Row[] | undefined) ?? [],
  ) as BackOfficeState["courses"];

  merged.assignments = dedupeAssignments(
    mergeScopedSchoolRows(
      prev.assignments as Row[],
      (remote.assignments as Row[] | undefined) ?? [],
    ),
  ) as BackOfficeState["assignments"];

  merged.exams = mergeScopedSchoolRows(
    prev.exams as Row[],
    (remote.exams as Row[] | undefined) ?? [],
  ) as BackOfficeState["exams"];

  return merged;
}
