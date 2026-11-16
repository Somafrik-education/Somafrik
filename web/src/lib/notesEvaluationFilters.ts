import { classNamesMatch } from "./classRules";
import type { Evaluation } from "../types";

/** Un filtre sans classe sélectionnée ne retourne aucune évaluation staff. */
export function filterEvaluationsByClassAndType(
  evaluations: readonly Evaluation[],
  selectedClass: string,
  selectedType: string,
): Evaluation[] {
  if (!selectedClass.trim()) return [];
  return evaluations.filter((row) =>
    classNamesMatch(row.className, selectedClass) &&
    (!selectedType || String(row.evaluationType ?? "").trim() === selectedType),
  );
}
