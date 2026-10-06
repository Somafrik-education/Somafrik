import { ApiError } from "../api/client";
import { hasBackOfficePermission, type PermissionContext } from "./permissions";
import type { StudentCardMedium, StudentCardStatus } from "./studentCardsApi";
import type { SchoolSettings } from "./schoolSettingsApi";

export const STUDENT_CARD_CR80 = {
  width: "85.60mm",
  height: "53.98mm",
} as const;

export const STUDENT_CARD_REPRINT_NOTICE =
  "Le QR sécurisé n’est disponible qu’au moment de l’émission. Pour générer un nouveau QR, remplacez la carte ; l’ancienne deviendra inutilisable.";

export const STUDENT_CARD_PREVIEW_CLOSE_NOTICE =
  "Le QR sécurisé ne pourra plus être affiché après fermeture ou rechargement.";

export const STUDENT_CARD_NFC_ONLY_NOTICE =
  "L’émission NFC seule sera disponible avec le lot NFC. Activez également le QR pour émettre et imprimer une carte depuis le Web.";

export const STUDENT_CARD_MASTER_OFF_NOTICE =
  "Carte élève désactivée pour cet établissement.";

export const STUDENT_CARD_SETTINGS_UNAVAILABLE_NOTICE =
  "Les paramètres de carte élève sont indisponibles. Aucune émission n’est possible.";

export const STUDENT_CARD_FINANCE_NOTICE =
  "Le contrôle financier est informatif. Il ne bloque pas la prise de présence.";

const ERROR_MESSAGES: Record<string, string> = {
  STUDENT_CARD_DISABLED: "La carte élève est désactivée pour cet établissement.",
  STUDENT_CARD_ACTIVE_ALREADY_EXISTS: "Une carte active existe déjà. La liste a été actualisée.",
  STUDENT_CARD_INVALID_STATE: "Cette carte n’est plus dans un état qui autorise cette action.",
  STUDENT_CARD_NOT_FOUND: "Carte introuvable.",
  PERMISSION_DENIED: "Action non autorisée.",
  PLATFORM_PERSONAL_DATA_DENIED: "Accès refusé.",
};

export type StudentCardWebIssueMedium = Extract<StudentCardMedium, "qr" | "nfc_qr">;

export type StudentCardSettingsGate =
  | { state: "ready"; medium: StudentCardWebIssueMedium | null; nfcOnly: boolean }
  | { state: "disabled" }
  | { state: "unavailable" };

export function isStudentCardMasterEnabled(settings: Pick<SchoolSettings, "studentCardEnabled"> | null | undefined): boolean {
  return settings?.studentCardEnabled === true;
}

export function resolveStudentCardSettingsGate(
  settings: SchoolSettings | null | undefined,
  failed = false,
): StudentCardSettingsGate {
  if (failed || !settings) return { state: "unavailable" };
  if (!isStudentCardMasterEnabled(settings)) return { state: "disabled" };
  const qr = settings.studentCardQrEnabled === true;
  const nfc = settings.studentCardNfcEnabled === true;
  if (qr && nfc) return { state: "ready", medium: "nfc_qr", nfcOnly: false };
  if (qr) return { state: "ready", medium: "qr", nfcOnly: false };
  if (nfc) return { state: "ready", medium: null, nfcOnly: true };
  return { state: "ready", medium: null, nfcOnly: false };
}

export function canManageStudentCards(ctx: PermissionContext): boolean {
  return hasBackOfficePermission(ctx, "Élèves", "UPDATE");
}

export function studentCardStatusLabel(status: StudentCardStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "lost":
      return "Perdue";
    case "revoked":
      return "Révoquée";
    case "replaced":
      return "Remplacée";
    case "issued":
      return "Émise";
    default:
      return status;
  }
}

export function studentCardMediumLabel(medium: StudentCardMedium): string {
  switch (medium) {
    case "qr":
      return "QR";
    case "nfc":
      return "NFC";
    case "nfc_qr":
      return "QR et NFC";
    default:
      return medium;
  }
}

export type StudentCardAction = "lost" | "revoke" | "replace";

export function studentCardActions(status: StudentCardStatus): readonly StudentCardAction[] {
  if (status === "active") return ["lost", "revoke", "replace"];
  if (status === "lost") return ["replace"];
  return [];
}

export function studentCardErrorMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return "L’opération carte n’a pas abouti.";
}

export function studentCardDocumentTitle(studentCode: string): string {
  const safe = String(studentCode ?? "")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `Carte-eleve-${safe || "eleve"}`;
}

export function studentCardInitials(displayName: string): string {
  const parts = String(displayName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  const initials = parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return initials || "?";
}

export interface StudentCardPrintIdentity {
  displayName: string;
  classLabel: string;
  studentCode: string;
  schoolName: string;
  photoUrl: string | null;
  publicId: string;
}

const PRINT_IDENTITY_KEYS = [
  "displayName",
  "classLabel",
  "studentCode",
  "schoolName",
  "photoUrl",
  "publicId",
] as const;

export function buildStudentCardPrintIdentity(input: StudentCardPrintIdentity): StudentCardPrintIdentity {
  return {
    displayName: input.displayName.trim(),
    classLabel: input.classLabel.trim(),
    studentCode: input.studentCode.trim(),
    schoolName: input.schoolName.trim(),
    photoUrl: input.photoUrl?.trim() || null,
    publicId: input.publicId.trim(),
  };
}

export function studentCardPrintIdentityKeys(): readonly string[] {
  return PRINT_IDENTITY_KEYS;
}
