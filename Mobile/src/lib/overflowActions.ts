import { MIN_TOUCH_TARGET_DP } from "./mobileUsability";

export const OVERFLOW_TRIGGER_DP = MIN_TOUCH_TARGET_DP;
export const OVERFLOW_MENU_ITEM_DP = MIN_TOUCH_TARGET_DP;
export const STUDENT_OVERFLOW_A11Y_LABEL = "Actions de l'élève";

/** Rangée historique Modifier/Supprimer sous la fiche (44 + marginTop 8). */
export const LEGACY_STUDENT_ACTION_STACK_DP = MIN_TOUCH_TARGET_DP + 8;

/** Fiche élève + ⋮ inline : plus de seconde ligne de 52 dp. */
export const STUDENT_ROW_INLINE_MAX_DP = 58;

export type OverflowActionSpec = {
  key: string;
  label: string;
  destructive?: boolean;
};

export type StudentRowActionAccess = {
  canUpdate: boolean;
  canDelete: boolean;
};

export function studentRowOverflowActions(access: StudentRowActionAccess): OverflowActionSpec[] {
  const actions: OverflowActionSpec[] = [];
  if (access.canUpdate) {
    actions.push({ key: "update", label: "Modifier" });
  }
  if (access.canDelete) {
    actions.push({ key: "delete", label: "Supprimer", destructive: true });
  }
  return actions;
}

export function shouldShowOverflowTrigger(actions: OverflowActionSpec[]): boolean {
  return actions.length > 0;
}
