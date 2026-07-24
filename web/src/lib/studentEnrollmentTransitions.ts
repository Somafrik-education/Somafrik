/**
 * C1.8a — Transitions explicites d'inscription.
 *
 * Parcours métier :
 *   PRE_REGISTERED (brouillon)
 *       ↓
 *   PENDING_REVIEW / INCOMPLETE (en attente)
 *       ↓ VALIDATE_ENROLLMENT
 *   APPROVED (validé)
 *       ↓ ASSIGN_ENROLLMENT_CLASS
 *   ENROLLED + classe (affecté)
 *
 * Aucun retour arrière implicite.
 */

import type { StudentEnrollmentStatus } from "./studentEnrollmentStatus";

/** Statuts depuis lesquels une validation est autorisée. */
export const VALIDATE_ENROLLMENT_SOURCE_STATUSES = [
  "PRE_REGISTERED",
  "PENDING_REVIEW",
  "INCOMPLETE",
] as const satisfies readonly StudentEnrollmentStatus[];

/** Statuts depuis lesquels une affectation de classe est autorisée. */
export const ASSIGN_CLASS_SOURCE_STATUSES = [
  "APPROVED",
  "ENROLLED",
] as const satisfies readonly StudentEnrollmentStatus[];

export type ValidateEnrollmentSourceStatus =
  (typeof VALIDATE_ENROLLMENT_SOURCE_STATUSES)[number];

export type AssignClassSourceStatus =
  (typeof ASSIGN_CLASS_SOURCE_STATUSES)[number];

export function canValidateEnrollmentStatus(
  status: StudentEnrollmentStatus,
): status is ValidateEnrollmentSourceStatus {
  return (VALIDATE_ENROLLMENT_SOURCE_STATUSES as readonly string[]).includes(
    status,
  );
}

export function canAssignClassEnrollmentStatus(
  status: StudentEnrollmentStatus,
): status is AssignClassSourceStatus {
  return (ASSIGN_CLASS_SOURCE_STATUSES as readonly string[]).includes(status);
}

/** Validation → APPROVED (Validé). */
export function nextStatusAfterValidate(): "APPROVED" {
  return "APPROVED";
}

/**
 * Affectation → ENROLLED (Affecté / Inscrit).
 * Une réaffectation depuis ENROLLED conserve ENROLLED.
 */
export function nextStatusAfterAssignClass(
  current: AssignClassSourceStatus,
): "ENROLLED" {
  void current;
  return "ENROLLED";
}
