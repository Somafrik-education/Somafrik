import type { BackOfficeState, Evaluation, SessionUser } from "../types";
import { canValidateGrades } from "./gradePermissions";
import { getSchoolPeriodNames } from "./evaluations";

/** Valeur Select : toutes les périodes académiques. */
export const ALL_PERIODS_FILTER = "";

/** File Préfet : évaluations encore à valider. */
export const PENDING_VALIDATION_FILTER = "a-valider";
export const ALL_STATUSES_FILTER = "tous";

export const EVALUATION_STATUS_FILTER_OPTIONS = [
  { value: ALL_STATUSES_FILTER, label: "Tous" },
  { value: PENDING_VALIDATION_FILTER, label: "À valider" },
  { value: "Brouillon", label: "Brouillon" },
  { value: "Saisie terminée", label: "Saisie terminée" },
  { value: "Validée", label: "Validée" },
  { value: "Publiée", label: "Publiée" },
] as const;

const TERMINAL_VALIDATION_STATUSES = new Set(["Validée", "Publiée", "Annulée"]);

export function isPendingValidationStatus(status: string | undefined): boolean {
  const value = String(status ?? "").trim();
  if (!value) return true;
  return !TERMINAL_VALIDATION_STATUSES.has(value);
}

export function matchesEvaluationPeriodFilter(
  evaluation: Pick<Evaluation, "period">,
  periodFilter: string,
): boolean {
  if (!periodFilter) return true;
  return String(evaluation.period ?? "") === periodFilter;
}

export function matchesEvaluationStatusFilter(
  evaluation: Pick<Evaluation, "status">,
  statusFilter: string,
): boolean {
  if (!statusFilter || statusFilter === ALL_STATUSES_FILTER) return true;
  if (statusFilter === PENDING_VALIDATION_FILTER) {
    return isPendingValidationStatus(evaluation.status);
  }
  return String(evaluation.status ?? "") === statusFilter;
}

export function filterEvaluationsForQueue(
  evaluations: Evaluation[],
  periodFilter: string,
  statusFilter: string,
): Evaluation[] {
  return evaluations.filter(
    (evaluation) =>
      matchesEvaluationPeriodFilter(evaluation, periodFilter) &&
      matchesEvaluationStatusFilter(evaluation, statusFilter),
  );
}

export function resolveEvaluationsQueueDefaults(user: SessionUser | null): {
  periodFilter: string | null;
  statusFilter: string;
  showStatusFilter: boolean;
} {
  if (canValidateGrades(user)) {
    return {
      periodFilter: ALL_PERIODS_FILTER,
      statusFilter: PENDING_VALIDATION_FILTER,
      showStatusFilter: true,
    };
  }
  return {
    periodFilter: null,
    statusFilter: ALL_STATUSES_FILTER,
    showStatusFilter: false,
  };
}

export function periodFilterOptions(
  state: BackOfficeState,
  schoolCode: string,
  evaluations: Pick<Evaluation, "period">[],
): { value: string; label: string }[] {
  const names = [...getSchoolPeriodNames(state, schoolCode)];
  for (const evaluation of evaluations) {
    const period = String(evaluation.period ?? "").trim();
    if (period && !names.includes(period)) names.push(period);
  }
  return [{ value: ALL_PERIODS_FILTER, label: "Toutes les périodes" }, ...names.map((name) => ({ value: name, label: name }))];
}

export function evaluationsEmptyDescription(periodFilter: string, statusFilter: string): string {
  if (statusFilter === PENDING_VALIDATION_FILTER && !periodFilter) {
    return "Aucune évaluation à valider.";
  }
  if (periodFilter) {
    return `Aucune évaluation pour la période « ${periodFilter} ».`;
  }
  return "Créez une évaluation pour commencer la saisie des notes.";
}
