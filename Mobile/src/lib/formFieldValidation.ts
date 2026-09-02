import { formatFieldLabel } from "./formFieldTokens";

export function trimField(value: unknown): string {
  return String(value ?? "").trim();
}

export function hasFieldErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some((value) => Boolean(value && String(value).trim()));
}

export function firstErrorKey(
  order: string[],
  errors: Record<string, string | undefined>,
): string | undefined {
  return order.find((key) => Boolean(errors[key] && String(errors[key]).trim()));
}

export function requiredError(label: string): string {
  return `${label} est obligatoire.`;
}

export function validateRequired(value: unknown, label: string): string {
  return trimField(value) ? "" : requiredError(label);
}

const PHONE_DIGITS_MIN = 8;
const PHONE_DIGITS_MAX = 15;

/**
 * Valide le format d'un téléphone. Plusieurs élèves (frères/sœurs) peuvent
 * partager le même numéro de parent : aucune unicité n'est exigée ici.
 */
export function validatePhone(value: unknown, label: string, required = false): string {
  const trimmed = trimField(value);
  if (!trimmed) return required ? requiredError(label) : "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < PHONE_DIGITS_MIN || digits.length > PHONE_DIGITS_MAX) {
    return `${label} : indiquez un numéro valide (ex. +243 8xx xxx xxx).`;
  }
  return "";
}

export function validateEmail(value: unknown, label: string, required = false): string {
  const trimmed = trimField(value);
  if (!trimmed) return required ? requiredError(label) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return `${label} : indiquez une adresse email valide.`;
  }
  return "";
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validateDate(value: unknown, label: string, required = false): string {
  const trimmed = trimField(value);
  if (!trimmed) return required ? requiredError(label) : "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : dmy
      ? { year: Number(dmy[3]), month: Number(dmy[2]), day: Number(dmy[1]) }
      : null;
  if (!parts || !isRealCalendarDate(parts.year, parts.month, parts.day)) {
    return `${label} : utilisez AAAA-MM-JJ.`;
  }
  return "";
}

export function validateTime(value: unknown, label: string, required = false): string {
  const trimmed = trimField(value);
  if (!trimmed) return required ? requiredError(label) : "";
  const match = /^(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return `${label} : utilisez HH:MM.`;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return `${label} : heure invalide.`;
  return "";
}

export function validateAmount(value: unknown, label: string, required = false): string {
  const trimmed = trimField(value).replace(",", ".");
  if (!trimmed) return required ? requiredError(label) : "";
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return `${label} : indiquez un montant positif.`;
  }
  return "";
}

export function validatePassword(value: unknown, label: string, required = true): string {
  return trimField(value) ? "" : required ? requiredError(label) : "";
}

/** Classe du contexte uniquement. Jamais la première classe de la liste. */
export function resolvePreferredClassCode(
  contextClassName: string | undefined,
  options: Array<{ id: string; label: string }>,
): string {
  const wanted = trimField(contextClassName);
  if (!wanted) return "";
  return options.find((item) => item.label === wanted || item.id === wanted)?.id ?? "";
}

export function validateStudentEnrollmentDraft(input: {
  firstName: unknown;
  lastName: unknown;
  parentPhone: unknown;
  classCode: unknown;
  editing: boolean;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const firstName = validateRequired(input.firstName, "Prénom");
  const lastName = validateRequired(input.lastName, "Nom");
  const parentPhone = validatePhone(input.parentPhone, "Téléphone du parent", false);
  if (firstName) errors.firstName = firstName;
  if (lastName) errors.lastName = lastName;
  if (parentPhone) errors.parentPhone = parentPhone;
  if (!input.editing && !trimField(input.classCode)) {
    errors.classCode = requiredError("Classe");
  }
  return errors;
}

export function validateTeacherIdentityDraft(input: {
  firstName: unknown;
  lastName: unknown;
  phone: unknown;
  email: unknown;
  birthDate: unknown;
  temporaryPassword: unknown;
  editing: boolean;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const firstName = validateRequired(input.firstName, "Prénom");
  const lastName = validateRequired(input.lastName, "Nom");
  const phone = validatePhone(input.phone, "Téléphone", false);
  const email = validateEmail(input.email, "Email", false);
  const birthDate = validateDate(input.birthDate, "Date de naissance", false);
  if (firstName) errors.firstName = firstName;
  if (lastName) errors.lastName = lastName;
  if (phone) errors.phone = phone;
  if (email) errors.email = email;
  if (birthDate) errors.birthDate = birthDate;
  if (!input.editing) {
    const temporaryPassword = validatePassword(input.temporaryPassword, "Mot de passe temporaire", true);
    if (temporaryPassword) errors.temporaryPassword = temporaryPassword;
  }
  return errors;
}

export function validateUserIdentityDraft(input: {
  firstName: unknown;
  lastName: unknown;
  email: unknown;
  phone: unknown;
  temporaryPassword: unknown;
  editing: boolean;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const firstName = validateRequired(input.firstName, "Prénom");
  const lastName = validateRequired(input.lastName, "Nom");
  const email = validateEmail(input.email, "Email", false);
  const phone = validatePhone(input.phone, "Téléphone", false);
  if (firstName) errors.firstName = firstName;
  if (lastName) errors.lastName = lastName;
  if (email) errors.email = email;
  if (phone) errors.phone = phone;
  if (!input.editing) {
    const temporaryPassword = validatePassword(input.temporaryPassword, "Mot de passe temporaire", true);
    if (temporaryPassword) errors.temporaryPassword = temporaryPassword;
  }
  return errors;
}

const UNALLOCATED_TARGET = "__unallocated__";

function isUnallocatedObligationId(obligationId: unknown): boolean {
  return trimField(obligationId) === UNALLOCATED_TARGET;
}

export function validatePaymentDraft(input: {
  studentId: unknown;
  amount: unknown;
  classId?: unknown;
  classOptions?: Array<{ classId: string }>;
  obligationId?: unknown;
  obligationOptions?: Array<{ obligationId: string }>;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!trimField(input.studentId)) errors.studentId = requiredError("Élève");
  const amount = validateAmount(input.amount, "Montant", true);
  if (amount) errors.amount = amount;
  if (trimField(input.studentId)) {
    const options = Array.isArray(input.classOptions) ? input.classOptions : [];
    if (!options.length) {
      errors.classId = "Cet élève n'a aucune inscription active.";
    } else if (!trimField(input.classId)) {
      errors.classId = requiredError("Classe");
    } else if (!options.some((row) => trimField(row.classId) === trimField(input.classId))) {
      errors.classId = "Classe invalide pour cet élève.";
    }
    const fees = Array.isArray(input.obligationOptions) ? input.obligationOptions : [];
    const obligationId = trimField(input.obligationId);
    if (!isUnallocatedObligationId(input.obligationId) && !obligationId) {
      errors.obligationId = "FINANCE_OBLIGATION_ID_REQUIRED";
    } else if (!isUnallocatedObligationId(input.obligationId) && fees.length) {
      if (!fees.some((row) => trimField(row.obligationId) === obligationId)) {
        errors.obligationId = "Frais invalide pour cet élève.";
      }
    }
  }
  return errors;
}

export function validateFinancePaymentLinesDraft(input: {
  studentId: unknown;
  classId?: unknown;
  classOptions?: Array<{ classId: string }>;
  lines?: Array<{ obligationId?: unknown; amount?: unknown }>;
  obligationOptions?: Array<{ obligationId: string }>;
}): Record<string, string> {
  const first = input.lines?.[0];
  const errors = validatePaymentDraft({
    studentId: input.studentId,
    amount: first?.amount,
    classId: input.classId,
    classOptions: input.classOptions,
    obligationId: first?.obligationId,
    obligationOptions: input.obligationOptions,
  });
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) {
    errors.lines = "Ajoutez au moins une ligne.";
    return errors;
  }
  const fees = Array.isArray(input.obligationOptions) ? input.obligationOptions : [];
  lines.forEach((line, index) => {
    const amount = validateAmount(line.amount, "Montant", true);
    if (amount) errors[`amount-${index}`] = amount;
    if (!isUnallocatedObligationId(line.obligationId) && !trimField(line.obligationId)) {
      errors[`obligationId-${index}`] = "FINANCE_OBLIGATION_ID_REQUIRED";
    } else if (!isUnallocatedObligationId(line.obligationId) && fees.length) {
      if (!fees.some((row) => trimField(row.obligationId) === trimField(line.obligationId))) {
        errors[`obligationId-${index}`] = "Frais invalide pour cet élève.";
      }
    }
  });
  return errors;
}

export function validateAnnouncementDraft(input: { title: unknown; message: unknown }): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = validateRequired(input.title, "Titre");
  const message = validateRequired(input.message, "Message");
  if (title) errors.title = title;
  if (message) errors.message = message;
  return errors;
}

export function studentEnrollmentLabels() {
  return {
    firstName: formatFieldLabel("Prénom", { required: true }),
    lastName: formatFieldLabel("Nom", { required: true }),
    parentPhone: formatFieldLabel("Téléphone du parent", { optional: true }),
    classCode: formatFieldLabel("Classe", { required: true }),
  };
}
