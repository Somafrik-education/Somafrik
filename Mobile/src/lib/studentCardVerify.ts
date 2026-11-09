/**
 * CARTE-PR2 — vérification de carte : affichage de ce que le serveur a autorisé, rien de plus.
 * Le serveur filtre chaque section selon les droits effectifs ; le Mobile n’infère aucun droit.
 */

export const CARD_VERIFY_COPY = {
  button: "Vérifier une carte",
  title: "Vérifier une carte",
  instructionsNfc: "Approchez la carte NFC du téléphone.",
  instructionsQr: "Présentez le QR code de la carte devant la caméra.",
  checking: "Vérification en cours…",
  valid: "Carte valide",
  invalid: "Carte invalide",
  invalidHint: "Carte inconnue, remplacée, perdue, révoquée ou d'un autre établissement.",
  outOfScope: "Carte valide — élève hors de votre périmètre : aucune information affichée.",
  another: "Vérifier une autre carte",
  close: "Fermer",
  forbidden: "Votre rôle ne permet pas de vérifier une carte.",
  offline: "Connexion indisponible : la carte n'a pas été vérifiée.",
  failed: "La vérification n'a pas abouti. Réessayez.",
  notSomafrik: "Cette carte n'est pas une carte élève Somafrik.",
  nfcUnavailable: "NFC indisponible ou désactivé sur cet appareil.",
} as const;

export type CardVerifyResponse = {
  card: { valid: boolean; medium?: string };
  scope: "none" | "class" | "school";
  student?: { studentCode?: string; firstName?: string; lastName?: string };
  class?: { classCode?: string; className?: string };
  attendance?: { date: string; status: string | null };
  finance?: { code: string; label: string };
  cardHistory?: { medium?: string; status?: string }[];
  guardians?: { name: string; phone: string; isPrincipal?: boolean }[];
};

export type CardVerifyView = {
  tone: "valid" | "invalid" | "neutral";
  headline: string;
  hint?: string;
  rows: { label: string; value: string }[];
};

const ATTENDANCE_LABELS: Record<string, string> = {
  present: "Présent",
  late: "En retard",
  absent: "Absent",
  excused: "Absence justifiée",
};
const CARD_STATUS_LABELS: Record<string, string> = {
  active: "active",
  replaced: "remplacée",
  revoked: "révoquée",
  lost: "perdue",
  issued: "non activée",
};

export function describeCardVerification(response: CardVerifyResponse): CardVerifyView {
  if (!response?.card?.valid) {
    return { tone: "invalid", headline: CARD_VERIFY_COPY.invalid, hint: CARD_VERIFY_COPY.invalidHint, rows: [] };
  }
  if (response.scope === "none") {
    return { tone: "neutral", headline: CARD_VERIFY_COPY.valid, hint: CARD_VERIFY_COPY.outOfScope, rows: [] };
  }
  const rows: CardVerifyView["rows"] = [];
  if (response.student) {
    const name = [response.student.firstName, response.student.lastName].filter(Boolean).join(" ").trim();
    if (name) rows.push({ label: "Élève", value: name });
    if (response.student.studentCode) rows.push({ label: "Matricule", value: response.student.studentCode });
  }
  if (response.class?.className || response.class?.classCode) {
    rows.push({ label: "Classe", value: String(response.class.className || response.class.classCode) });
  }
  if (response.attendance) {
    const status = response.attendance.status ? ATTENDANCE_LABELS[response.attendance.status] ?? response.attendance.status : "Non pointé";
    rows.push({ label: "Présence du jour", value: status });
  }
  if (response.finance?.label) rows.push({ label: "Situation financière", value: response.finance.label });
  if (Array.isArray(response.cardHistory)) {
    const summary = response.cardHistory
      .map((card) => CARD_STATUS_LABELS[String(card.status ?? "")] ?? String(card.status ?? ""))
      .filter(Boolean)
      .join(", ");
    rows.push({ label: "Historique des cartes", value: summary || "Aucune autre carte" });
  }
  for (const guardian of response.guardians ?? []) {
    rows.push({
      label: guardian.isPrincipal ? "Responsable principal" : "Responsable",
      value: [guardian.name, guardian.phone].filter(Boolean).join(" · "),
    });
  }
  return { tone: "valid", headline: CARD_VERIFY_COPY.valid, rows };
}

export function cardVerifyErrorMessage(error: unknown): string {
  const { status, code } = (error && typeof error === "object" ? error : {}) as { status?: number; code?: string };
  if (status === 401 || status === 403 || code === "CARD_VERIFY_FORBIDDEN") return CARD_VERIFY_COPY.forbidden;
  if (status === 400) return CARD_VERIFY_COPY.notSomafrik;
  if (status === 0 || code === "NETWORK_UNAVAILABLE") return CARD_VERIFY_COPY.offline;
  return CARD_VERIFY_COPY.failed;
}
