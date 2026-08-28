/** Clé d'intention Finance — même retry = même UUID ; succès = rotation. */
export function createFinanceIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `fin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
