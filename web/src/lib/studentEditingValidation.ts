import {
  ALLOWED_ADMINISTRATIVE_CHANGE_FIELDS,
  ALLOWED_ENROLLMENT_CLASS_CHANGE_FIELDS,
  ALLOWED_GUARDIAN_CONTACT_CHANGE_FIELDS,
  ALLOWED_IDENTITY_CHANGE_FIELDS,
  type CommandValidationResult,
  type EditableEnrollment,
  type EditableGuardianContact,
  type EditableStudentAdministrativeDetails,
  type EditableStudentIdentity,
  type SchoolClassCatalogEntry,
  type StudentEditValidationError,
} from "./studentEditing";
import type { StudentWorkspaceCommand } from "./studentEditingCommands";
import {
  MAX_NOTES,
  MAX_TEXT,
  buildChangeSetForCommand,
  listUnsupportedFields,
  normalizeAdministrativeChanges,
  normalizeEmail,
  normalizeEnrollmentClassChanges,
  normalizeGuardianContactChanges,
  normalizeIdentityChanges,
  normalizeOptionalText,
  normalizePhone,
  type StudentChangeSet,
} from "./studentEditingChangeSet";
import {
  canAssignClassEnrollmentStatus,
  canValidateEnrollmentStatus,
} from "./studentEnrollmentTransitions";
import { parseCivilDate } from "./studentWorkspaceDates";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;
const HTML_RE = /<\/?[a-z][\s\S]*>/i;

function err(
  field: string | null,
  code: string,
  message: string,
): StudentEditValidationError {
  return { field, code, message };
}

function isFutureCivilDate(iso: string, referenceDate: Date): boolean {
  const date = parseCivilDate(iso);
  if (!date) return true;
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  return date.getTime() > today.getTime();
}

export interface ValidateCommandOptions {
  identity?: EditableStudentIdentity | null;
  guardian?: EditableGuardianContact | null;
  /** Autres relations actives du même élève (pour unicité priority=1). */
  siblingGuardians?: readonly EditableGuardianContact[];
  administrative?: EditableStudentAdministrativeDetails | null;
  enrollment?: EditableEnrollment | null;
  /** Catalogue de classes de l'établissement (affectation). */
  schoolClasses?: readonly SchoolClassCatalogEntry[];
  referenceDate?: Date;
  changeSet?: StudentChangeSet;
  /** false = la raison sera vérifiée à la confirmation (défaut true). */
  enforceReason?: boolean;
}

export function resolveSchoolClass(
  changes: { classId?: string | null; className?: string | null },
  catalog: readonly SchoolClassCatalogEntry[],
  schoolCode: string,
): { ok: true; classId: string; className: string } | {
  ok: false;
  code: string;
  message: string;
} {
  const classId = normalizeOptionalText(changes.classId);
  const className = normalizeOptionalText(changes.className);
  const school = schoolCode.trim().toLowerCase();
  const scoped = catalog.filter(
    (item) => item.schoolCode.trim().toLowerCase() === school,
  );

  // Contrat C1.8a : aucune affectation sans catalogue local canonique.
  if (scoped.length === 0) {
    return {
      ok: false,
      code: "CLASS_NOT_FOUND",
      message:
        "Aucune classe n'est disponible pour cet établissement. Créez une classe avant l'affectation.",
    };
  }

  if (classId) {
    // Un classId présent hors établissement (autre schoolCode) est exclu via `scoped`.
    const byId = scoped.find((item) => item.id === classId);
    if (!byId) {
      return {
        ok: false,
        code: "CLASS_NOT_FOUND",
        message: "La classe indiquée n'existe pas dans cet établissement.",
      };
    }
    // Le libellé client ne peut jamais écraser le nom canonique du catalogue.
    return {
      ok: true,
      classId: byId.id,
      className: byId.name,
    };
  }

  if (className) {
    const byName = scoped.find(
      (item) =>
        item.name.trim().toLowerCase() === className.trim().toLowerCase(),
    );
    if (!byName) {
      return {
        ok: false,
        code: "CLASS_NOT_FOUND",
        message: "Aucune classe ne correspond à ce libellé dans l'établissement.",
      };
    }
    return {
      ok: true,
      classId: byName.id,
      className: byName.name,
    };
  }

  return {
    ok: false,
    code: "CLASS_REQUIRED",
    message: "Une classe (identifiant ou libellé) est obligatoire.",
  };
}

function validateIdentityCommand(
  command: Extract<StudentWorkspaceCommand, { type: "UPDATE_STUDENT_IDENTITY" }>,
  options: ValidateCommandOptions,
): CommandValidationResult {
  const errors: StudentEditValidationError[] = [];
  const warnings: CommandValidationResult["warnings"] = [];
  const current = options.identity;

  if (!current) {
    return {
      valid: false,
      errors: [err(null, "NOT_FOUND", "Identité élève introuvable.")],
      warnings,
    };
  }

  const unsupported = listUnsupportedFields(
    command.changes as Record<string, unknown>,
    ALLOWED_IDENTITY_CHANGE_FIELDS,
  );
  for (const field of unsupported) {
    errors.push(
      err(field, "UNSUPPORTED_FIELD", `Champ non autorisé : ${field}`),
    );
  }

  const changes = normalizeIdentityChanges(command.changes);
  const merged = {
    firstName: "firstName" in changes ? changes.firstName! : current.firstName,
    lastName: "lastName" in changes ? changes.lastName! : current.lastName,
    preferredName:
      "preferredName" in changes ? changes.preferredName ?? null : current.preferredName,
    gender: "gender" in changes ? changes.gender ?? null : current.gender,
    birthDate: "birthDate" in changes ? changes.birthDate ?? null : current.birthDate,
    birthPlace:
      "birthPlace" in changes ? changes.birthPlace ?? null : current.birthPlace,
    nationality:
      "nationality" in changes ? changes.nationality ?? null : current.nationality,
    address: "address" in changes ? changes.address ?? null : current.address,
    phone: "phone" in changes ? changes.phone ?? null : current.phone,
    email: "email" in changes ? changes.email ?? null : current.email,
  };

  if (!merged.firstName) {
    errors.push(err("firstName", "REQUIRED", "Le prénom est obligatoire."));
  } else if (merged.firstName.length > MAX_TEXT) {
    errors.push(err("firstName", "MAX_LENGTH", "Prénom trop long."));
  }

  if (!merged.lastName) {
    errors.push(err("lastName", "REQUIRED", "Le nom est obligatoire."));
  } else if (merged.lastName.length > MAX_TEXT) {
    errors.push(err("lastName", "MAX_LENGTH", "Nom trop long."));
  }

  if (merged.birthDate) {
    if (!parseCivilDate(merged.birthDate)) {
      errors.push(
        err("birthDate", "INVALID_DATE", "Date de naissance invalide."),
      );
    } else if (
      isFutureCivilDate(merged.birthDate, options.referenceDate ?? new Date())
    ) {
      errors.push(
        err(
          "birthDate",
          "FUTURE_DATE",
          "La date de naissance ne peut pas être dans le futur.",
        ),
      );
    }
  }

  if (merged.email) {
    const email = normalizeEmail(merged.email);
    if (!email || !EMAIL_RE.test(email)) {
      errors.push(err("email", "INVALID_EMAIL", "Adresse e-mail invalide."));
    }
  }

  if (merged.phone) {
    const phone = normalizePhone(merged.phone);
    if (!phone || !PHONE_RE.test(phone)) {
      errors.push(err("phone", "INVALID_PHONE", "Téléphone invalide."));
    }
  }

  for (const field of [
    "preferredName",
    "birthPlace",
    "nationality",
    "address",
  ] as const) {
    const value = merged[field];
    if (value && value.length > MAX_TEXT) {
      errors.push(err(field, "MAX_LENGTH", "Valeur trop longue."));
    }
  }

  const changeSet =
    options.changeSet ??
    buildChangeSetForCommand(command, current);

  if (changeSet.isEmpty && unsupported.length === 0) {
    errors.push(
      err(null, "NO_CHANGES", "Aucun changement réel à enregistrer."),
    );
  }

  if (
    (options.enforceReason ?? true) &&
    changeSet.requiresReason &&
    !String(command.reason ?? "").trim()
  ) {
    errors.push(
      err(
        "reason",
        "REASON_REQUIRED",
        "Une raison est requise pour les changements sensibles.",
      ),
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateGuardianCommand(
  command: Extract<StudentWorkspaceCommand, { type: "UPDATE_GUARDIAN_CONTACT" }>,
  options: ValidateCommandOptions,
): CommandValidationResult {
  const errors: StudentEditValidationError[] = [];
  const warnings: CommandValidationResult["warnings"] = [];
  const current = options.guardian;

  if (!current || current.relationId !== command.relationId) {
    return {
      valid: false,
      errors: [err(null, "NOT_FOUND", "Relation responsable introuvable.")],
      warnings,
    };
  }

  if (!current.isActive) {
    errors.push(
      err(null, "INACTIVE_RELATION", "La relation responsable n'est pas active."),
    );
  }

  const unsupported = listUnsupportedFields(
    command.changes as Record<string, unknown>,
    ALLOWED_GUARDIAN_CONTACT_CHANGE_FIELDS,
  );
  for (const field of unsupported) {
    errors.push(
      err(field, "UNSUPPORTED_FIELD", `Champ non autorisé : ${field}`),
    );
  }

  // Interdiction implicite des champs juridiques hors commande.
  for (const forbidden of [
    "isLegalGuardian",
    "financialResponsible",
    "relationshipType",
  ]) {
    if (forbidden in (command.changes as Record<string, unknown>)) {
      errors.push(
        err(
          forbidden,
          "UNSUPPORTED_FIELD",
          `Champ non modifiable dans C1.7 : ${forbidden}`,
        ),
      );
    }
  }

  const changes = normalizeGuardianContactChanges(command.changes);
  const merged = {
    phone: "phone" in changes ? changes.phone ?? null : current.phone,
    email: "email" in changes ? changes.email ?? null : current.email,
    address: "address" in changes ? changes.address ?? null : current.address,
    isEmergencyContact:
      "isEmergencyContact" in changes
        ? Boolean(changes.isEmergencyContact)
        : current.isEmergencyContact,
    pickupAuthorized:
      "pickupAuthorized" in changes
        ? Boolean(changes.pickupAuthorized)
        : current.pickupAuthorized,
    priority:
      "priority" in changes
        ? changes.priority === null || changes.priority === undefined
          ? current.priority
          : changes.priority
        : current.priority,
  };

  if (merged.email) {
    const email = normalizeEmail(merged.email);
    if (!email || !EMAIL_RE.test(email)) {
      errors.push(err("email", "INVALID_EMAIL", "Adresse e-mail invalide."));
    }
  }

  if (merged.phone) {
    const phone = normalizePhone(merged.phone);
    if (!phone || !PHONE_RE.test(phone)) {
      errors.push(err("phone", "INVALID_PHONE", "Téléphone invalide."));
    }
  }

  if (merged.isEmergencyContact && !merged.phone) {
    errors.push(
      err(
        "phone",
        "EMERGENCY_PHONE_REQUIRED",
        "Un contact d'urgence doit posséder un téléphone.",
      ),
    );
  }

  if (!Number.isFinite(merged.priority) || merged.priority < 1) {
    errors.push(
      err("priority", "INVALID_PRIORITY", "La priorité doit être un entier positif."),
    );
  }

  if (merged.priority === 1) {
    const siblings = options.siblingGuardians ?? [];
    const conflict = siblings.some(
      (item) =>
        item.relationId !== current.relationId &&
        item.isActive &&
        item.priority === 1,
    );
    if (conflict) {
      errors.push(
        err(
          "priority",
          "PRIORITY_CONFLICT",
          "Une seule relation peut avoir la priorité 1.",
        ),
      );
    }
  }

  if (merged.address && merged.address.length > MAX_TEXT) {
    errors.push(err("address", "MAX_LENGTH", "Adresse trop longue."));
  }

  const changeSet =
    options.changeSet ?? buildChangeSetForCommand(command, current);

  if (changeSet.isEmpty && unsupported.length === 0) {
    errors.push(
      err(null, "NO_CHANGES", "Aucun changement réel à enregistrer."),
    );
  }

  if (
    (options.enforceReason ?? true) &&
    changeSet.requiresReason &&
    !String(command.reason ?? "").trim()
  ) {
    errors.push(
      err(
        "reason",
        "REASON_REQUIRED",
        "Une raison est requise pour les changements sensibles.",
      ),
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateAdministrativeCommand(
  command: Extract<
    StudentWorkspaceCommand,
    { type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS" }
  >,
  options: ValidateCommandOptions,
): CommandValidationResult {
  const errors: StudentEditValidationError[] = [];
  const warnings: CommandValidationResult["warnings"] = [];
  const current = options.administrative;

  if (!current) {
    return {
      valid: false,
      errors: [err(null, "NOT_FOUND", "Détails administratifs introuvables.")],
      warnings,
    };
  }

  const unsupported = listUnsupportedFields(
    command.changes as Record<string, unknown>,
    ALLOWED_ADMINISTRATIVE_CHANGE_FIELDS,
  );
  for (const field of unsupported) {
    errors.push(
      err(field, "UNSUPPORTED_FIELD", `Champ non autorisé : ${field}`),
    );
  }

  const changes = normalizeAdministrativeChanges(command.changes);
  const notes =
    "administrativeNotes" in changes
      ? changes.administrativeNotes
      : current.administrativeNotes;

  if (notes && notes.length > MAX_NOTES) {
    errors.push(
      err("administrativeNotes", "MAX_LENGTH", "Notes trop longues."),
    );
  }

  if (notes && HTML_RE.test(notes)) {
    errors.push(
      err(
        "administrativeNotes",
        "HTML_FORBIDDEN",
        "Les notes doivent être du texte brut (HTML interdit).",
      ),
    );
  }

  const changeSet =
    options.changeSet ?? buildChangeSetForCommand(command, current);

  if (changeSet.isEmpty && unsupported.length === 0) {
    errors.push(
      err(null, "NO_CHANGES", "Aucun changement réel à enregistrer."),
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateValidateEnrollmentCommand(
  command: Extract<StudentWorkspaceCommand, { type: "VALIDATE_ENROLLMENT" }>,
  options: ValidateCommandOptions,
): CommandValidationResult {
  const errors: StudentEditValidationError[] = [];
  const warnings: CommandValidationResult["warnings"] = [];
  const current = options.enrollment;

  if (!current || current.enrollmentId !== command.enrollmentId) {
    return {
      valid: false,
      errors: [err(null, "NOT_FOUND", "Inscription introuvable.")],
      warnings,
    };
  }

  if (current.studentId !== command.studentId) {
    errors.push(
      err(null, "STUDENT_MISMATCH", "L'inscription n'appartient pas à cet élève."),
    );
  }

  if (!canValidateEnrollmentStatus(current.status)) {
    errors.push(
      err(
        "status",
        "INVALID_TRANSITION",
        `Validation interdite depuis le statut ${current.status}. Transitions autorisées depuis préinscrit / en examen / dossier incomplet uniquement.`,
      ),
    );
  }

  if (current.endedAt) {
    errors.push(
      err(null, "ENROLLMENT_CLOSED", "Inscription clôturée : validation impossible."),
    );
  }

  const changeSet =
    options.changeSet ?? buildChangeSetForCommand(command, current);

  if (changeSet.isEmpty && errors.length === 0) {
    errors.push(
      err(null, "NO_CHANGES", "Aucun changement réel à enregistrer."),
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateAssignEnrollmentClassCommand(
  command: Extract<
    StudentWorkspaceCommand,
    { type: "ASSIGN_ENROLLMENT_CLASS" }
  >,
  options: ValidateCommandOptions,
): CommandValidationResult {
  const errors: StudentEditValidationError[] = [];
  const warnings: CommandValidationResult["warnings"] = [];
  const current = options.enrollment;

  if (!current || current.enrollmentId !== command.enrollmentId) {
    return {
      valid: false,
      errors: [err(null, "NOT_FOUND", "Inscription introuvable.")],
      warnings,
    };
  }

  if (current.studentId !== command.studentId) {
    errors.push(
      err(null, "STUDENT_MISMATCH", "L'inscription n'appartient pas à cet élève."),
    );
  }

  if (!canAssignClassEnrollmentStatus(current.status)) {
    errors.push(
      err(
        "status",
        "INVALID_TRANSITION",
        `Affectation interdite depuis le statut ${current.status}. Validez d'abord l'inscription.`,
      ),
    );
  }

  if (current.endedAt) {
    errors.push(
      err(
        null,
        "ENROLLMENT_CLOSED",
        "Inscription clôturée : affectation impossible.",
      ),
    );
  }

  const unsupported = listUnsupportedFields(
    command.changes as Record<string, unknown>,
    ALLOWED_ENROLLMENT_CLASS_CHANGE_FIELDS,
  );
  for (const field of unsupported) {
    errors.push(
      err(field, "UNSUPPORTED_FIELD", `Champ non autorisé : ${field}`),
    );
  }

  const changes = normalizeEnrollmentClassChanges(command.changes);
  const resolved = resolveSchoolClass(
    {
      classId: "classId" in changes ? changes.classId : current.classId,
      className: "className" in changes ? changes.className : current.className,
    },
    options.schoolClasses ?? [],
    current.schoolCode,
  );

  if (!resolved.ok) {
    errors.push(err("classId", resolved.code, resolved.message));
  } else if (
    resolved.classId === current.classId &&
    resolved.className === current.className &&
    current.status === "ENROLLED"
  ) {
    // Pas de changement réel de classe ni de statut.
  }

  const changeSet =
    options.changeSet ?? buildChangeSetForCommand(command, current);

  if (changeSet.isEmpty && unsupported.length === 0 && errors.length === 0) {
    errors.push(
      err(null, "NO_CHANGES", "Aucun changement réel à enregistrer."),
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateStudentWorkspaceCommand(
  command: StudentWorkspaceCommand,
  options: ValidateCommandOptions = {},
): CommandValidationResult {
  if (command.type === "UPDATE_STUDENT_IDENTITY") {
    return validateIdentityCommand(command, options);
  }
  if (command.type === "UPDATE_GUARDIAN_CONTACT") {
    return validateGuardianCommand(command, options);
  }
  if (command.type === "VALIDATE_ENROLLMENT") {
    return validateValidateEnrollmentCommand(command, options);
  }
  if (command.type === "ASSIGN_ENROLLMENT_CLASS") {
    return validateAssignEnrollmentClassCommand(command, options);
  }
  return validateAdministrativeCommand(command, options);
}
