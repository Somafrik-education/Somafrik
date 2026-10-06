/**
 * CARTE-PR7 — politique scanner QR Mobile.
 * Le capability reste en mémoire volatile. Aucun stockage, aucun log du token.
 */

export const CANONICAL_CAMERA_PERMISSION =
  "Somafrik utilise l’appareil photo pour prendre la photo du compte et scanner les cartes élève par QR code.";

export const STUDENT_CARD_SCAN_COPY = {
  button: "Scanner une carte",
  title: "Scanner une carte élève",
  subtitle: "Présentez le QR de la carte devant l’appareil photo.",
  permissionRationale: "L’appareil photo sert uniquement à lire le QR de la carte élève.",
  permissionDenied: "Appareil photo refusé. L’appel manuel reste disponible.",
  permissionBlocked: "L’autorisation caméra est bloquée. Vous pouvez l’activer dans les réglages. L’appel manuel reste disponible.",
  openSettings: "Ouvrir les réglages",
  requestPermission: "Autoriser l’appareil photo",
  backToManual: "Retour à l’appel manuel",
  offline: "Réseau indisponible. Le scan QR nécessite une connexion. L’appel manuel reste disponible.",
  rearm: "Scanner une autre carte",
  scanning: "Lecture du QR…",
  resolving: "Identification en cours…",
  present: "Présent",
  late: "Retard",
  modeLabel: "Statut à enregistrer",
  financeNotice: "Le contrôle financier est informatif. Il ne bloque pas la prise de présence.",
  cameraUnavailable: "Scanner QR indisponible.",
} as const;

const SCAN_ERROR_MESSAGES: Record<string, string> = {
  STUDENT_CARD_DISABLED: "La carte élève est désactivée pour cet établissement.",
  STUDENT_CARD_ATTENDANCE_DISABLED: "Le pointage par carte est désactivé.",
  STUDENT_CARD_FINANCE_CHECK_DISABLED: "Le contrôle financier par carte est désactivé.",
  STUDENT_CARD_TOKEN_INVALID: "QR illisible ou carte non reconnue.",
  STUDENT_CARD_NOT_FOUND: "Carte introuvable.",
  STUDENT_CARD_INVALID_STATE: "Cette carte n’est plus utilisable.",
  STUDENT_CARD_TENANT_DENIED: "Cette carte n’appartient pas à cet établissement.",
  STUDENT_CARD_ENROLLMENT_UNRESOLVED: "L’élève n’est pas rattaché à une classe active.",
  ATTENDANCE_TEACHER_UNRESOLVED: "Choisissez l’enseignant auteur de l’appel avant de pointer.",
  STUDENT_CARD_SCAN_INTENTS_CONFLICT: "Présence et finance ne peuvent pas être demandées ensemble.",
  PERMISSION_DENIED: "Action non autorisée.",
  PLATFORM_PERSONAL_DATA_DENIED: "Accès refusé.",
};

export type StudentCardScanSettings = {
  studentCardEnabled?: boolean;
  studentCardQrEnabled?: boolean;
  studentCardAttendanceEnabled?: boolean;
  studentCardFinanceCheckEnabled?: boolean;
};

export function isStudentCardQrScanEnabled(
  settings: StudentCardScanSettings | null | undefined,
): boolean {
  return settings?.studentCardEnabled === true && settings?.studentCardQrEnabled === true;
}

export function isStudentCardScanAttendanceEnabled(
  settings: StudentCardScanSettings | null | undefined,
): boolean {
  return isStudentCardQrScanEnabled(settings) && settings?.studentCardAttendanceEnabled === true;
}

export function isStudentCardScanFinanceEnabled(
  settings: StudentCardScanSettings | null | undefined,
): boolean {
  return isStudentCardQrScanEnabled(settings) && settings?.studentCardFinanceCheckEnabled === true;
}

export function studentCardScanErrorMessage(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  if (code && SCAN_ERROR_MESSAGES[code]) return SCAN_ERROR_MESSAGES[code];
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Le scan n’a pas abouti.";
}

export function extractQrCapability(data: unknown): string {
  return String(data ?? "").trim();
}

export function isQrBarcodeType(type: unknown): boolean {
  const normalized = String(type ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return normalized === "qr" || normalized.endsWith(".qr") || normalized.includes("qrcode");
}

export type VolatileCardToken = { current: string | null };

export function holdCardToken(holder: VolatileCardToken, token: string): boolean {
  const next = extractQrCapability(token);
  if (!next || holder.current) return false;
  holder.current = next;
  return true;
}

export function releaseCardToken(holder: VolatileCardToken): void {
  holder.current = null;
}

export function isoAttendanceDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
