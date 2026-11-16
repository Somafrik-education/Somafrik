/**
 * PERF-PR4 — nature d'une erreur du client HTTP, lue sur son champ `kind`.
 * Sans dépendance au module client : les tests qui le remplacent par un mock partiel
 * restent valables.
 */
export type HttpErrorKind = "http" | "network" | "timeout" | "aborted";

export function httpErrorKind(error: unknown): HttpErrorKind | null {
  if (!error || typeof error !== "object" || !("kind" in error)) return null;
  const kind = (error as { kind?: unknown }).kind;
  return kind === "http" || kind === "network" || kind === "timeout" || kind === "aborted" ? kind : null;
}

/** Annulation volontaire : jamais affichée comme une panne. */
export function isAbortedRequest(error: unknown): boolean {
  return httpErrorKind(error) === "aborted";
}
