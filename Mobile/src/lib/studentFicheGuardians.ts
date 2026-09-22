export type GuardiansLoadState = "loading" | "success" | "empty" | "error" | "offline";

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : undefined;
}

export function isOfflineLikeError(error: unknown): boolean {
  if (!error) return false;
  if (errorStatus(error) === 0) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /network request failed|failed to fetch|offline|internet/i.test(message);
}

/**
 * Ne rend « Aucun responsable lié » que sur 200 + liste vide.
 * 403 / 500 / réseau → error | offline, jamais empty.
 */
export function classifyGuardiansLoad(input: {
  loading: boolean;
  error: unknown | null;
  items: unknown[];
}): GuardiansLoadState {
  if (input.loading) return "loading";
  if (input.error) return isOfflineLikeError(input.error) ? "offline" : "error";
  if (!input.items.length) return "empty";
  return "success";
}

export function guardiansCardSubtitle(state: GuardiansLoadState, count: number): string {
  if (state === "loading") return "Chargement…";
  if (state === "error" || state === "offline") return "Indisponible";
  if (state === "empty") return "Aucun responsable lié";
  return `${count} responsable(s)`;
}
