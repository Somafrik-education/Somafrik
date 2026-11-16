import { ApiError } from "../api/client";
import { hasBackOfficePermission, type PermissionContext } from "./permissions";
import type { StudentCardHolder, StudentCardMedium, StudentCardStatus } from "./studentCardsApi";
import type { SchoolSettings } from "./schoolSettingsApi";
import { studentCardNameStepOf } from "./studentCardDesign";

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

export type StudentCardHolderKind = "eleve" | "etudiant";

/** CARTE-CYCLE-01 — libellés du réglage (en-tête imprimé : STUDENT_CARD_HOLDER_TITLES). */
export const STUDENT_CARD_HOLDER_LABELS: Record<StudentCardHolderKind, string> = {
  eleve: "Élève",
  etudiant: "Étudiant",
};

export const STUDENT_CARD_HOLDER_UNDETERMINED_NOTICE =
  "Titulaire de carte non configuré : précisez « élève » ou « étudiant » dans Paramètres, section Carte élève, avant d’émettre ou de remplacer une carte. Les cartes existantes ne sont pas modifiées.";

/** Seuls « eleve » et « etudiant » autorisent une émission ; absent ou inconnu = non déterminé. */
export function isStudentCardHolderDetermined(holder: StudentCardHolder | null | undefined): boolean {
  return holder?.kind === "eleve" || holder?.kind === "etudiant";
}

export const STUDENT_CARD_FINANCE_NOTICE =
  "Le contrôle financier est informatif. Il ne bloque pas la prise de présence.";

const ERROR_MESSAGES: Record<string, string> = {
  STUDENT_CARD_DISABLED: "La carte élève est désactivée pour cet établissement.",
  STUDENT_CARD_ACTIVE_ALREADY_EXISTS: "Une carte active existe déjà. La liste a été actualisée.",
  STUDENT_CARD_INVALID_STATE: "Cette carte n’est plus dans un état qui autorise cette action.",
  STUDENT_CARD_NOT_FOUND: "Carte introuvable.",
  STUDENT_CARD_HOLDER_UNDETERMINED: STUDENT_CARD_HOLDER_UNDETERMINED_NOTICE,
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

export function studentCardDocumentTitle(studentCode: string | null | undefined, holderKind?: StudentCardHolderKind | null): string {
  const safe = String(studentCode ?? "")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefix = holderKind === "etudiant" ? "Carte-etudiant" : "Carte-eleve";
  return `${prefix}-${safe || (holderKind === "etudiant" ? "etudiant" : "eleve")}`;
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

/**
 * CARTE-UI-01 — en-tête imprimé, déterminé UNIQUEMENT par le titulaire résolu par le Backend
 * (CARTE-CYCLE-01). Aucune déduction Web (nom d'établissement, classe, type) : absent = null.
 */
export const STUDENT_CARD_HOLDER_TITLES: Record<StudentCardHolderKind, string> = {
  eleve: "CARTE D’ÉLÈVE",
  etudiant: "CARTE D’ÉTUDIANT",
};

export function studentCardHolderTitle(holder: StudentCardHolder | null | undefined): string | null {
  if (!isStudentCardHolderDetermined(holder)) return null;
  return STUDENT_CARD_HOLDER_TITLES[holder!.kind as StudentCardHolderKind];
}

export const STUDENT_CARD_HOLDER_PRINT_REFUSED_NOTICE =
  "Titulaire de carte non déterminé : impression impossible. Précisez « élève » ou « étudiant » dans Paramètres, section Carte élève.";

/** Référence de carte abrégée : 6 derniers caractères de l'identifiant public (jamais le jeton). */
export function studentCardRef(publicId: string | null | undefined): string {
  const value = String(publicId ?? "").trim();
  return value.length > 6 ? value.slice(-6) : value;
}

/**
 * Libellés d'écran utilisés quand une donnée manque (studentWorkspaceViewModel). Ils ne doivent
 * jamais être imprimés : la ligne correspondante est masquée.
 */
export const STUDENT_CARD_SCREEN_PLACEHOLDERS: readonly string[] = Object.freeze([
  "Non renseigné",
  "Aucune inscription active",
]);

export function studentCardOptionalText(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.normalize("NFC").trim() : "";
  if (!text || STUDENT_CARD_SCREEN_PLACEHOLDERS.includes(text)) return null;
  return text;
}

/** Paliers typographiques : le texte n'est jamais tronqué, il diminue puis passe à la ligne (≥ 6,5 pt). */
export type StudentCardTextStep = "l1" | "l2" | "l3" | "l4";

export function studentCardNameStep(displayName: string): StudentCardTextStep {
  return studentCardNameStepOf(displayName);
}

export function studentCardValueStep(value: string, threshold: number): "l1" | "l2" {
  return Array.from(value.trim()).length <= threshold ? "l1" : "l2";
}

export interface StudentCardPrintIdentity {
  displayName: string;
  classLabel: string | null;
  studentCode: string | null;
  schoolName: string | null;
  photoUrl: string | null;
  publicId: string;
}

export interface StudentCardPrintIdentityInput {
  displayName: string;
  classLabel?: string | null;
  studentCode?: string | null;
  schoolName?: string | null;
  photoUrl?: string | null;
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

/** Données strictement nécessaires à l'affichage ; les valeurs absentes ou de remplacement deviennent null. */
export function buildStudentCardPrintIdentity(input: StudentCardPrintIdentityInput): StudentCardPrintIdentity {
  return {
    displayName: studentCardOptionalText(input.displayName) ?? "",
    classLabel: studentCardOptionalText(input.classLabel),
    studentCode: studentCardOptionalText(input.studentCode),
    schoolName: studentCardOptionalText(input.schoolName),
    photoUrl: input.photoUrl?.trim() || null,
    publicId: String(input.publicId ?? "").trim(),
  };
}

export function studentCardPrintIdentityKeys(): readonly string[] {
  return PRINT_IDENTITY_KEYS;
}
