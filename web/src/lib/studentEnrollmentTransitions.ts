/**
 * C1.8a / C1.8b — Transitions explicites d'inscription.
 *
 * Parcours métier :
 *   PRE_REGISTERED (brouillon)
 *       ↓
 *   PENDING_REVIEW / INCOMPLETE (en attente)
 *       ↓ VALIDATE_ENROLLMENT
 *   APPROVED (validé)
 *       ↓ ASSIGN_ENROLLMENT_CLASS → ENROLLED + classe
 *       ↓ CLOSE_ENROLLMENT        → CLOSED
 *   ENROLLED
 *       ↓ TRANSFER_ENROLLMENT → TRANSFERRED
 *       ↓ CLOSE_ENROLLMENT    → CLOSED
 *
 * Aucune transition sortante depuis TRANSFERRED / CLOSED.
 * Aucun retour arrière implicite. Aucune suppression physique.
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

/** Transfert : uniquement depuis ENROLLED. */
export const TRANSFER_ENROLLMENT_SOURCE_STATUSES = [
  "ENROLLED",
] as const satisfies readonly StudentEnrollmentStatus[];

/**
 * Clôture : ENROLLED, ou APPROVED (inscription validée jamais affectée).
 */
export const CLOSE_ENROLLMENT_SOURCE_STATUSES = [
  "ENROLLED",
  "APPROVED",
] as const satisfies readonly StudentEnrollmentStatus[];

/** Statuts terminaux sans transition sortante C1.8b. */
export const TERMINAL_ENROLLMENT_STATUSES = [
  "TRANSFERRED",
  "CLOSED",
] as const satisfies readonly StudentEnrollmentStatus[];

export type ValidateEnrollmentSourceStatus =
  (typeof VALIDATE_ENROLLMENT_SOURCE_STATUSES)[number];

export type AssignClassSourceStatus =
  (typeof ASSIGN_CLASS_SOURCE_STATUSES)[number];

export type TransferEnrollmentSourceStatus =
  (typeof TRANSFER_ENROLLMENT_SOURCE_STATUSES)[number];

export type CloseEnrollmentSourceStatus =
  (typeof CLOSE_ENROLLMENT_SOURCE_STATUSES)[number];

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

export function canTransferEnrollmentStatus(
  status: StudentEnrollmentStatus,
): status is TransferEnrollmentSourceStatus {
  return (TRANSFER_ENROLLMENT_SOURCE_STATUSES as readonly string[]).includes(
    status,
  );
}

export function canCloseEnrollmentStatus(
  status: StudentEnrollmentStatus,
): status is CloseEnrollmentSourceStatus {
  return (CLOSE_ENROLLMENT_SOURCE_STATUSES as readonly string[]).includes(
    status,
  );
}

export function isTerminalEnrollmentStatus(
  status: StudentEnrollmentStatus,
): boolean {
  return (TERMINAL_ENROLLMENT_STATUSES as readonly string[]).includes(status);
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

/** Transfert → TRANSFERRED (aucune création dans l'établissement cible). */
export function nextStatusAfterTransfer(): "TRANSFERRED" {
  return "TRANSFERRED";
}

/** Clôture → CLOSED (désinscription / annulation propre). */
export function nextStatusAfterClose(): "CLOSED" {
  return "CLOSED";
}
