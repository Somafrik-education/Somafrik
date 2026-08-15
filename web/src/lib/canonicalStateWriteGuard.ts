import type { BackOfficeState } from "../types";

export function strippedTopLevelKeys(
  originalPatch: Partial<BackOfficeState>,
  residualPatch: Partial<BackOfficeState>,
): string[] {
  const residualKeys = new Set(Object.keys(residualPatch));
  return Object.keys(originalPatch).filter((key) => !residualKeys.has(key));
}

export function assertNoStrippedCanonicalWrites(
  originalPatch: Partial<BackOfficeState>,
  residualPatch: Partial<BackOfficeState>,
) {
  const strippedKeys = strippedTopLevelKeys(originalPatch, residualPatch);
  if (!strippedKeys.length) return;
  throw new Error(
    `Écriture PostgreSQL canonique interdite via DataContext.update(): ${strippedKeys.join(", ")}. Utilisez l'API métier dédiée.`,
  );
}
