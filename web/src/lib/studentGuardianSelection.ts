import type { StudentGuardianRelationRecord } from "./studentGuardian";

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, "fr", { sensitivity: "base" });
}

/**
 * Comparateur du responsable principal :
 * priorité numérique la plus faible → légal → urgence → alphabétique.
 */
export function compareGuardianPrimaryPriority(
  left: StudentGuardianRelationRecord,
  right: StudentGuardianRelationRecord,
): number {
  const priorityDelta = left.priority - right.priority;
  if (priorityDelta !== 0) return priorityDelta;

  const legalDelta =
    Number(right.isLegalGuardian) - Number(left.isLegalGuardian);
  if (legalDelta !== 0) return legalDelta;

  const emergencyDelta =
    Number(right.isEmergencyContact) - Number(left.isEmergencyContact);
  if (emergencyDelta !== 0) return emergencyDelta;

  return compareNames(left.displayName, right.displayName);
}

export function selectPrimaryGuardian(
  relations: readonly StudentGuardianRelationRecord[],
): StudentGuardianRelationRecord | null {
  const active = relations.filter((relation) => relation.isActive);
  if (active.length === 0) return null;

  return [...active].sort(compareGuardianPrimaryPriority)[0] ?? null;
}

/** Tri d'affichage : priorité croissante, puis nom. */
export function sortGuardiansByPriority(
  relations: readonly StudentGuardianRelationRecord[],
): StudentGuardianRelationRecord[] {
  return [...relations].sort((left, right) => {
    const priorityDelta = left.priority - right.priority;
    if (priorityDelta !== 0) return priorityDelta;
    return compareNames(left.displayName, right.displayName);
  });
}

export function getEmergencyContacts(
  relations: readonly StudentGuardianRelationRecord[],
): StudentGuardianRelationRecord[] {
  return sortGuardiansByPriority(
    relations.filter(
      (relation) => relation.isActive && relation.isEmergencyContact,
    ),
  );
}

export function getPickupAuthorizedGuardians(
  relations: readonly StudentGuardianRelationRecord[],
): StudentGuardianRelationRecord[] {
  return sortGuardiansByPriority(
    relations.filter(
      (relation) => relation.isActive && relation.pickupAuthorized,
    ),
  );
}

export function getFinancialResponsibleGuardians(
  relations: readonly StudentGuardianRelationRecord[],
): StudentGuardianRelationRecord[] {
  return sortGuardiansByPriority(
    relations.filter(
      (relation) => relation.isActive && relation.financialResponsible,
    ),
  );
}

export interface GuardianRelationDiagnostics {
  hasLegalGuardian: boolean;
  hasEmergencyContact: boolean;
  hasFinancialResponsible: boolean;
  hasPhone: boolean;
  multiplePriorityOne: boolean;
  multipleFinancialResponsible: boolean;
  hasExpiredRelation: boolean;
  priorityOneCount: number;
  financialResponsibleCount: number;
}

export function diagnoseGuardianRelations(
  relations: readonly StudentGuardianRelationRecord[],
): GuardianRelationDiagnostics {
  const active = relations.filter((relation) => relation.isActive);
  const priorityOneCount = active.filter(
    (relation) => relation.priority === 1,
  ).length;
  const financialResponsibleCount = active.filter(
    (relation) => relation.financialResponsible,
  ).length;

  return {
    hasLegalGuardian: active.some((relation) => relation.isLegalGuardian),
    hasEmergencyContact: active.some((relation) => relation.isEmergencyContact),
    hasFinancialResponsible: financialResponsibleCount > 0,
    hasPhone: active.some((relation) => Boolean(relation.phone)),
    multiplePriorityOne: priorityOneCount > 1,
    multipleFinancialResponsible: financialResponsibleCount > 1,
    hasExpiredRelation: relations.some((relation) => relation.isExpired),
    priorityOneCount,
    financialResponsibleCount,
  };
}
