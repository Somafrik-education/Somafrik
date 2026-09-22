/**
 * Contrat d'affichage Présences élève — même vérité que Notes/Paiements.
 * idle/loading, error et offline ne sont jamais une liste vide métier.
 */
import type { ResourceSnapshot } from "./dataTruth";

export function filterPresencesForAliases<T extends { studentId?: string | null }>(
  rows: readonly T[],
  studentAliasKeys: readonly string[],
): T[] {
  return rows.filter((presence) => studentAliasKeys.includes(String(presence.studentId ?? "")));
}

export type StudentPresencesView<T> =
  | { kind: "list"; rows: T[] }
  | { kind: "query"; snapshot: ResourceSnapshot<T> };

/** La liste n'existe qu'après un succès. empty/error/offline/loading passent par QueryStateView. */
export function resolveStudentPresencesView<T>(
  snapshot: ResourceSnapshot<T>,
  visibleRows: readonly T[],
): StudentPresencesView<T> {
  if (snapshot.status === "success") {
    return { kind: "list", rows: [...visibleRows] };
  }
  return { kind: "query", snapshot };
}

export type StudentPresencesVisibleState = "loading" | "error" | "offline" | "empty" | "list";

export function studentPresencesVisibleState<T>(
  snapshot: ResourceSnapshot<T>,
  visibleRows: readonly T[],
): StudentPresencesVisibleState {
  const view = resolveStudentPresencesView(snapshot, visibleRows);
  if (view.kind === "list") {
    return view.rows.length > 0 ? "list" : "empty";
  }
  if (view.snapshot.status === "error") return "error";
  if (view.snapshot.status === "offline") return "offline";
  if (view.snapshot.status === "empty") return "empty";
  return "loading";
}

/** Retry Présences : relance le chargement canonique, sans substituer une liste vide. */
export function reloadStudentPresences(loadPresences: () => Promise<unknown>): void {
  void loadPresences();
}
