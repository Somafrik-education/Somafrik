import {
  ALLOWED_ADMINISTRATIVE_CHANGE_FIELDS,
  ALLOWED_ENROLLMENT_CLASS_CHANGE_FIELDS,
  ALLOWED_ENROLLMENT_CLOSE_CHANGE_FIELDS,
  ALLOWED_ENROLLMENT_TRANSFER_CHANGE_FIELDS,
  ALLOWED_GUARDIAN_CONTACT_CHANGE_FIELDS,
  ALLOWED_IDENTITY_CHANGE_FIELDS,
  FIELD_LABELS,
  isSensitiveStudentField,
  type EditableEnrollment,
  type EditableGuardianContact,
  type EditableStudentAdministrativeDetails,
  type EditableStudentIdentity,
  type StudentEditSensitivity,
  type StudentGender,
  type PreferredContactChannel,
} from "./studentEditing";
import type {
  AssignEnrollmentClassCommand,
  CloseEnrollmentCommand,
  StudentWorkspaceCommand,
  TransferEnrollmentCommand,
  UpdateGuardianContactCommand,
  UpdateStudentAdministrativeDetailsCommand,
  UpdateStudentIdentityCommand,
} from "./studentEditingCommands";
import {
  nextStatusAfterAssignClass,
  nextStatusAfterClose,
  nextStatusAfterTransfer,
  nextStatusAfterValidate,
} from "./studentEnrollmentTransitions";
import { parseCivilDate } from "./studentWorkspaceDates";

export interface StudentChange {
  field: string;
  label: string;
  previousValue: string | number | boolean | null;
  nextValue: string | number | boolean | null;
  sensitivity: StudentEditSensitivity;
}

export interface StudentChangeSet {
  commandType: StudentWorkspaceCommand["type"];
  studentId: string;
  changes: StudentChange[];
  hasSensitiveChange: boolean;
  requiresReason: boolean;
  isEmpty: boolean;
}

const MAX_TEXT = 500;
const MAX_NOTES = 2000;

/** Trim ; chaîne vide → null pour champs facultatifs. */
export function normalizeOptionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text || null;
}

export function normalizeRequiredText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeEmail(value: unknown): string | null {
  const text = normalizeOptionalText(value);
  return text ? text.toLowerCase() : null;
}

/**
 * Normalisation téléphone : conserve + et chiffres, retire espaces/séparateurs.
 * Ex. "+243 800 000 000" → "+243800000000"
 */
export function normalizePhone(value: unknown): string | null {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  const compact = text.replace(/[\s().-]/g, "");
  if (!/^\+?[0-9]{7,15}$/.test(compact)) {
    // Conserve la forme compactée pour validation ultérieure.
    return compact;
  }
  return compact;
}

export function normalizeCivilDate(value: unknown): string | null {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && parseCivilDate(text)) {
    return text;
  }
  const parsed = parseCivilDate(text.slice(0, 10));
  if (!parsed) return text;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function normalizeGender(value: unknown): StudentGender | null {
  const text = normalizeOptionalText(value)?.toUpperCase();
  if (!text) return null;
  if (text === "M" || text === "F" || text === "OTHER" || text === "UNKNOWN") {
    return text;
  }
  if (text === "H" || text === "HOMME" || text === "MASCULIN") return "M";
  if (text === "FEMME" || text === "FEMININ" || text === "FÉMININ") return "F";
  return "OTHER";
}

export function normalizePreferredChannel(
  value: unknown,
): PreferredContactChannel | null {
  const text = normalizeOptionalText(value)?.toUpperCase();
  if (text === "PHONE" || text === "EMAIL" || text === "SMS") return text;
  return null;
}

function valuesEqual(
  left: string | number | boolean | null,
  right: string | number | boolean | null,
): boolean {
  return left === right;
}

function pushChange(
  changes: StudentChange[],
  field: string,
  previousValue: string | number | boolean | null,
  nextValue: string | number | boolean | null,
): void {
  if (valuesEqual(previousValue, nextValue)) return;
  changes.push({
    field,
    label: FIELD_LABELS[field] ?? field,
    previousValue,
    nextValue,
    sensitivity: isSensitiveStudentField(field) ? "SENSITIVE" : "STANDARD",
  });
}

export function normalizeIdentityChanges(
  changes: UpdateStudentIdentityCommand["changes"],
): UpdateStudentIdentityCommand["changes"] {
  const normalized: UpdateStudentIdentityCommand["changes"] = {};
  if ("firstName" in changes) {
    normalized.firstName = normalizeRequiredText(changes.firstName);
  }
  if ("lastName" in changes) {
    normalized.lastName = normalizeRequiredText(changes.lastName);
  }
  if ("preferredName" in changes) {
    normalized.preferredName = normalizeOptionalText(changes.preferredName);
  }
  if ("gender" in changes) {
    normalized.gender = normalizeGender(changes.gender);
  }
  if ("birthDate" in changes) {
    normalized.birthDate = normalizeCivilDate(changes.birthDate);
  }
  if ("birthPlace" in changes) {
    normalized.birthPlace = normalizeOptionalText(changes.birthPlace);
  }
  if ("nationality" in changes) {
    normalized.nationality = normalizeOptionalText(changes.nationality);
  }
  if ("address" in changes) {
    normalized.address = normalizeOptionalText(changes.address);
  }
  if ("phone" in changes) {
    normalized.phone = normalizePhone(changes.phone);
  }
  if ("email" in changes) {
    normalized.email = normalizeEmail(changes.email);
  }
  return normalized;
}

export function normalizeGuardianContactChanges(
  changes: UpdateGuardianContactCommand["changes"],
): UpdateGuardianContactCommand["changes"] {
  const normalized: UpdateGuardianContactCommand["changes"] = {};
  if ("phone" in changes) {
    normalized.phone = normalizePhone(changes.phone);
  }
  if ("email" in changes) {
    normalized.email = normalizeEmail(changes.email);
  }
  if ("address" in changes) {
    normalized.address = normalizeOptionalText(changes.address);
  }
  if ("isEmergencyContact" in changes) {
    normalized.isEmergencyContact = Boolean(changes.isEmergencyContact);
  }
  if ("pickupAuthorized" in changes) {
    normalized.pickupAuthorized = Boolean(changes.pickupAuthorized);
  }
  if ("priority" in changes) {
    const raw = changes.priority;
    normalized.priority =
      raw === null || raw === undefined || Number.isNaN(Number(raw))
        ? null
        : Math.trunc(Number(raw));
  }
  return normalized;
}

export function normalizeAdministrativeChanges(
  changes: UpdateStudentAdministrativeDetailsCommand["changes"],
): UpdateStudentAdministrativeDetailsCommand["changes"] {
  const normalized: UpdateStudentAdministrativeDetailsCommand["changes"] = {};
  if ("administrativeNotes" in changes) {
    const text = normalizeOptionalText(changes.administrativeNotes);
    normalized.administrativeNotes = text;
  }
  if ("preferredContactChannel" in changes) {
    normalized.preferredContactChannel = normalizePreferredChannel(
      changes.preferredContactChannel,
    );
  }
  return normalized;
}

export function listUnsupportedFields(
  changes: Record<string, unknown>,
  allowed: readonly string[],
): string[] {
  return Object.keys(changes).filter((key) => !allowed.includes(key));
}

export function buildIdentityChangeSet(
  studentId: string,
  current: EditableStudentIdentity,
  rawChanges: UpdateStudentIdentityCommand["changes"],
): StudentChangeSet {
  const changes = normalizeIdentityChanges(rawChanges);
  const unsupported = listUnsupportedFields(
    changes as Record<string, unknown>,
    ALLOWED_IDENTITY_CHANGE_FIELDS,
  );
  if (unsupported.length > 0) {
    // Les champs non autorisés sont signalés via validation ; ChangeSet vide côté métier.
    return {
      commandType: "UPDATE_STUDENT_IDENTITY",
      studentId,
      changes: [],
      hasSensitiveChange: false,
      requiresReason: false,
      isEmpty: true,
    };
  }

  const items: StudentChange[] = [];
  if ("firstName" in changes) {
    pushChange(items, "firstName", current.firstName, changes.firstName ?? "");
  }
  if ("lastName" in changes) {
    pushChange(items, "lastName", current.lastName, changes.lastName ?? "");
  }
  if ("preferredName" in changes) {
    pushChange(items, "preferredName", current.preferredName, changes.preferredName ?? null);
  }
  if ("gender" in changes) {
    pushChange(items, "gender", current.gender, changes.gender ?? null);
  }
  if ("birthDate" in changes) {
    pushChange(items, "birthDate", current.birthDate, changes.birthDate ?? null);
  }
  if ("birthPlace" in changes) {
    pushChange(items, "birthPlace", current.birthPlace, changes.birthPlace ?? null);
  }
  if ("nationality" in changes) {
    pushChange(items, "nationality", current.nationality, changes.nationality ?? null);
  }
  if ("address" in changes) {
    pushChange(items, "address", current.address, changes.address ?? null);
  }
  if ("phone" in changes) {
    pushChange(items, "phone", current.phone, changes.phone ?? null);
  }
  if ("email" in changes) {
    pushChange(items, "email", current.email, changes.email ?? null);
  }

  const hasSensitiveChange = items.some((item) => item.sensitivity === "SENSITIVE");
  return {
    commandType: "UPDATE_STUDENT_IDENTITY",
    studentId,
    changes: items,
    hasSensitiveChange,
    requiresReason: hasSensitiveChange,
    isEmpty: items.length === 0,
  };
}

export function buildGuardianContactChangeSet(
  studentId: string,
  current: EditableGuardianContact,
  rawChanges: UpdateGuardianContactCommand["changes"],
): StudentChangeSet {
  const changes = normalizeGuardianContactChanges(rawChanges);
  const items: StudentChange[] = [];

  if ("phone" in changes) {
    pushChange(items, "phone", current.phone, changes.phone ?? null);
  }
  if ("email" in changes) {
    pushChange(items, "email", current.email, changes.email ?? null);
  }
  if ("address" in changes) {
    pushChange(items, "address", current.address, changes.address ?? null);
  }
  if ("isEmergencyContact" in changes) {
    pushChange(
      items,
      "isEmergencyContact",
      current.isEmergencyContact,
      changes.isEmergencyContact ?? false,
    );
  }
  if ("pickupAuthorized" in changes) {
    pushChange(
      items,
      "pickupAuthorized",
      current.pickupAuthorized,
      changes.pickupAuthorized ?? false,
    );
  }
  if ("priority" in changes) {
    pushChange(items, "priority", current.priority, changes.priority ?? null);
  }

  const hasSensitiveChange = items.some((item) => item.sensitivity === "SENSITIVE");
  return {
    commandType: "UPDATE_GUARDIAN_CONTACT",
    studentId,
    changes: items,
    hasSensitiveChange,
    requiresReason: hasSensitiveChange,
    isEmpty: items.length === 0,
  };
}

export function buildAdministrativeChangeSet(
  studentId: string,
  current: EditableStudentAdministrativeDetails,
  rawChanges: UpdateStudentAdministrativeDetailsCommand["changes"],
): StudentChangeSet {
  const changes = normalizeAdministrativeChanges(rawChanges);
  const items: StudentChange[] = [];

  if ("administrativeNotes" in changes) {
    pushChange(
      items,
      "administrativeNotes",
      current.administrativeNotes,
      changes.administrativeNotes ?? null,
    );
  }
  if ("preferredContactChannel" in changes) {
    pushChange(
      items,
      "preferredContactChannel",
      current.preferredContactChannel,
      changes.preferredContactChannel ?? null,
    );
  }

  return {
    commandType: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
    studentId,
    changes: items,
    hasSensitiveChange: false,
    requiresReason: false,
    isEmpty: items.length === 0,
  };
}

export function normalizeEnrollmentClassChanges(
  changes: AssignEnrollmentClassCommand["changes"],
): AssignEnrollmentClassCommand["changes"] {
  const normalized: AssignEnrollmentClassCommand["changes"] = {};
  if ("classId" in changes) {
    normalized.classId = normalizeOptionalText(changes.classId);
  }
  if ("className" in changes) {
    normalized.className = normalizeOptionalText(changes.className);
  }
  return normalized;
}

export function buildValidateEnrollmentChangeSet(
  studentId: string,
  current: EditableEnrollment,
  validatedAt: string,
): StudentChangeSet {
  const items: StudentChange[] = [];
  const nextStatus = nextStatusAfterValidate();
  pushChange(items, "status", current.status, nextStatus);
  pushChange(items, "validatedAt", current.validatedAt, validatedAt.slice(0, 10));

  return {
    commandType: "VALIDATE_ENROLLMENT",
    studentId,
    changes: items,
    hasSensitiveChange: false,
    requiresReason: false,
    isEmpty: items.length === 0,
  };
}

export function buildAssignEnrollmentClassChangeSet(
  studentId: string,
  current: EditableEnrollment,
  rawChanges: AssignEnrollmentClassCommand["changes"],
  enrolledAt: string,
): StudentChangeSet {
  const changes = normalizeEnrollmentClassChanges(rawChanges);
  const unsupported = listUnsupportedFields(
    changes as Record<string, unknown>,
    ALLOWED_ENROLLMENT_CLASS_CHANGE_FIELDS,
  );
  if (unsupported.length > 0) {
    return {
      commandType: "ASSIGN_ENROLLMENT_CLASS",
      studentId,
      changes: [],
      hasSensitiveChange: false,
      requiresReason: false,
      isEmpty: true,
    };
  }

  const items: StudentChange[] = [];
  const nextClassId =
    "classId" in changes ? changes.classId ?? null : current.classId;
  const nextClassName =
    "className" in changes ? changes.className ?? null : current.className;

  if ("classId" in changes) {
    pushChange(items, "classId", current.classId, nextClassId);
  }
  if ("className" in changes) {
    pushChange(items, "className", current.className, nextClassName);
  }

  if (
    current.status === "APPROVED" ||
    current.status === "ENROLLED"
  ) {
    const nextStatus = nextStatusAfterAssignClass(current.status);
    pushChange(items, "status", current.status, nextStatus);
    if (!current.enrolledAt) {
      pushChange(items, "enrolledAt", current.enrolledAt, enrolledAt.slice(0, 10));
    }
  }

  return {
    commandType: "ASSIGN_ENROLLMENT_CLASS",
    studentId,
    changes: items,
    hasSensitiveChange: false,
    requiresReason: false,
    isEmpty: items.length === 0,
  };
}

/** Libellé d'historique / affichage — ne mute jamais enrollment.notes. */
export function formatTransferDestinationLabel(
  destinationSchoolName: string,
): string {
  return `Transfert vers : ${destinationSchoolName.trim()}`;
}

export function buildTransferEnrollmentChangeSet(
  studentId: string,
  current: EditableEnrollment,
  rawChanges: TransferEnrollmentCommand["changes"],
): StudentChangeSet {
  const unsupported = listUnsupportedFields(
    rawChanges as Record<string, unknown>,
    ALLOWED_ENROLLMENT_TRANSFER_CHANGE_FIELDS,
  );
  if (unsupported.length > 0) {
    return {
      commandType: "TRANSFER_ENROLLMENT",
      studentId,
      changes: [],
      hasSensitiveChange: false,
      requiresReason: true,
      isEmpty: true,
    };
  }

  const destination = normalizeOptionalText(rawChanges.destinationSchoolName);
  const transferDate = normalizeCivilDate(rawChanges.transferDate);
  const items: StudentChange[] = [];
  pushChange(items, "status", current.status, nextStatusAfterTransfer());
  if (transferDate) {
    pushChange(items, "transferDate", current.transferDate, transferDate);
    pushChange(items, "endedAt", current.endedAt, transferDate);
  }
  if (destination) {
    pushChange(
      items,
      "destinationSchoolName",
      current.destinationSchoolName,
      destination,
    );
  }

  return {
    commandType: "TRANSFER_ENROLLMENT",
    studentId,
    changes: items,
    hasSensitiveChange: false,
    requiresReason: true,
    isEmpty: items.length === 0 || !destination || !transferDate,
  };
}

export function buildCloseEnrollmentChangeSet(
  studentId: string,
  current: EditableEnrollment,
  rawChanges: CloseEnrollmentCommand["changes"],
): StudentChangeSet {
  const unsupported = listUnsupportedFields(
    rawChanges as Record<string, unknown>,
    ALLOWED_ENROLLMENT_CLOSE_CHANGE_FIELDS,
  );
  if (unsupported.length > 0) {
    return {
      commandType: "CLOSE_ENROLLMENT",
      studentId,
      changes: [],
      hasSensitiveChange: false,
      requiresReason: true,
      isEmpty: true,
    };
  }

  const closureDate = normalizeCivilDate(rawChanges.closureDate);
  const items: StudentChange[] = [];
  pushChange(items, "status", current.status, nextStatusAfterClose());
  if (closureDate) {
    pushChange(items, "closureDate", current.closureDate, closureDate);
    pushChange(items, "endedAt", current.endedAt, closureDate);
  }

  return {
    commandType: "CLOSE_ENROLLMENT",
    studentId,
    changes: items,
    hasSensitiveChange: false,
    requiresReason: true,
    isEmpty: items.length === 0 || !closureDate,
  };
}

export function buildChangeSetForCommand(
  command: StudentWorkspaceCommand,
  current:
    | EditableStudentIdentity
    | EditableGuardianContact
    | EditableStudentAdministrativeDetails
    | EditableEnrollment,
  options: { now?: string } = {},
): StudentChangeSet {
  const now = options.now ?? new Date().toISOString();

  if (command.type === "UPDATE_STUDENT_IDENTITY") {
    return buildIdentityChangeSet(
      command.studentId,
      current as EditableStudentIdentity,
      command.changes,
    );
  }
  if (command.type === "UPDATE_GUARDIAN_CONTACT") {
    return buildGuardianContactChangeSet(
      command.studentId,
      current as EditableGuardianContact,
      command.changes,
    );
  }
  if (command.type === "VALIDATE_ENROLLMENT") {
    return buildValidateEnrollmentChangeSet(
      command.studentId,
      current as EditableEnrollment,
      now,
    );
  }
  if (command.type === "ASSIGN_ENROLLMENT_CLASS") {
    return buildAssignEnrollmentClassChangeSet(
      command.studentId,
      current as EditableEnrollment,
      command.changes,
      now,
    );
  }
  if (command.type === "TRANSFER_ENROLLMENT") {
    return buildTransferEnrollmentChangeSet(
      command.studentId,
      current as EditableEnrollment,
      command.changes,
    );
  }
  if (command.type === "CLOSE_ENROLLMENT") {
    return buildCloseEnrollmentChangeSet(
      command.studentId,
      current as EditableEnrollment,
      command.changes,
    );
  }
  return buildAdministrativeChangeSet(
    command.studentId,
    current as EditableStudentAdministrativeDetails,
    command.changes,
  );
}

export function formatChangeValue(
  value: string | number | boolean | null,
): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  return String(value);
}

export {
  MAX_TEXT,
  MAX_NOTES,
  ALLOWED_IDENTITY_CHANGE_FIELDS,
  ALLOWED_GUARDIAN_CONTACT_CHANGE_FIELDS,
  ALLOWED_ADMINISTRATIVE_CHANGE_FIELDS,
  ALLOWED_ENROLLMENT_CLASS_CHANGE_FIELDS,
  ALLOWED_ENROLLMENT_TRANSFER_CHANGE_FIELDS,
};
