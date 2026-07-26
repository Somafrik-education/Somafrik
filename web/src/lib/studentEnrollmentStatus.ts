/**
 * Statuts canoniques d'inscription scolaire (C1.2).
 * Les libellés historiques français / mojibake sont normalisés vers ces codes.
 */

export type StudentEnrollmentStatus =
  | "PRE_REGISTERED"
  | "PENDING_REVIEW"
  | "INCOMPLETE"
  | "APPROVED"
  | "ENROLLED"
  | "SUSPENDED"
  | "WITHDRAWN"
  | "CLOSED"
  | "TRANSFERRED"
  | "COMPLETED"
  | "GRADUATED"
  | "REJECTED";

export type EnrollmentStatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info";

export interface EnrollmentStatusPresentation {
  label: string;
  tone: EnrollmentStatusTone;
}

export const STUDENT_ENROLLMENT_STATUSES = [
  "PRE_REGISTERED",
  "PENDING_REVIEW",
  "INCOMPLETE",
  "APPROVED",
  "ENROLLED",
  "SUSPENDED",
  "WITHDRAWN",
  "CLOSED",
  "TRANSFERRED",
  "COMPLETED",
  "GRADUATED",
  "REJECTED",
] as const satisfies readonly StudentEnrollmentStatus[];

/** Statuts considérés comme inscription active (année en cours). */
export const ACTIVE_ENROLLMENT_STATUSES = [
  "APPROVED",
  "ENROLLED",
  "SUSPENDED",
] as const satisfies readonly StudentEnrollmentStatus[];

const STATUS_PRESENTATION: Record<
  StudentEnrollmentStatus,
  EnrollmentStatusPresentation
> = {
  PRE_REGISTERED: { label: "Préinscrit", tone: "info" },
  PENDING_REVIEW: { label: "En examen", tone: "warning" },
  INCOMPLETE: { label: "Dossier incomplet", tone: "warning" },
  APPROVED: { label: "Validé", tone: "info" },
  ENROLLED: { label: "Inscrit", tone: "success" },
  SUSPENDED: { label: "Suspendu", tone: "warning" },
  WITHDRAWN: { label: "Désinscrit", tone: "danger" },
  CLOSED: { label: "Clôturé", tone: "danger" },
  TRANSFERRED: { label: "Transféré", tone: "neutral" },
  COMPLETED: { label: "Année terminée", tone: "neutral" },
  GRADUATED: { label: "Diplômé", tone: "success" },
  REJECTED: { label: "Refusé", tone: "danger" },
};

const LEGACY_STATUS_ALIASES: Record<string, StudentEnrollmentStatus> = {
  pre_registered: "PRE_REGISTERED",
  preregistered: "PRE_REGISTERED",
  preinscrit: "PRE_REGISTERED",
  "pre-inscrit": "PRE_REGISTERED",
  // mojibake "Préinscrit"
  "prã©inscrit": "PRE_REGISTERED",
  "prãinscrit": "PRE_REGISTERED",

  pending_review: "PENDING_REVIEW",
  "en attente": "PENDING_REVIEW",
  "en examen": "PENDING_REVIEW",

  incomplete: "INCOMPLETE",
  incomplet: "INCOMPLETE",
  "dossier incomplet": "INCOMPLETE",

  approved: "APPROVED",
  valide: "APPROVED",
  "validé": "APPROVED",
  "validã©": "APPROVED",

  enrolled: "ENROLLED",
  inscrit: "ENROLLED",

  suspended: "SUSPENDED",
  suspendu: "SUSPENDED",

  withdrawn: "WITHDRAWN",
  desinscrit: "WITHDRAWN",
  "désinscrit": "WITHDRAWN",
  "dã©sinscrit": "WITHDRAWN",
  sorti: "WITHDRAWN",
  annule: "WITHDRAWN",
  "annulé": "WITHDRAWN",
  "annulã©": "WITHDRAWN",

  closed: "CLOSED",
  cloture: "CLOSED",
  "clôturé": "CLOSED",
  "clôturée": "CLOSED",
  "clã´turã©": "CLOSED",
  "clã´turã©e": "CLOSED",

  transferred: "TRANSFERRED",
  transfere: "TRANSFERRED",
  "transféré": "TRANSFERRED",
  "transfã©rã©": "TRANSFERRED",

  completed: "COMPLETED",
  "annee terminee": "COMPLETED",
  "année terminée": "COMPLETED",
  terminee: "COMPLETED",
  terminée: "COMPLETED",

  graduated: "GRADUATED",
  diplome: "GRADUATED",
  "diplômé": "GRADUATED",

  rejected: "REJECTED",
  refuse: "REJECTED",
  "refusé": "REJECTED",
  "refusã©": "REJECTED",
};

/** Répare les séquences UTF-8 double-encodées fréquentes (ex. PrÃ©inscrit). */
function repairCommonMojibake(value: string): string {
  return value
    .replace(/Ã©/g, "é")
    .replace(/Ã¨/g, "è")
    .replace(/Ãª/g, "ê")
    .replace(/Ã /g, "à")
    .replace(/Ã§/g, "ç")
    .replace(/Ã´/g, "ô")
    .replace(/Ã»/g, "û")
    .replace(/Ã¯/g, "ï");
}

function foldStatusKey(value: string): string {
  return repairCommonMojibake(value)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function isStudentEnrollmentStatus(
  value: unknown,
): value is StudentEnrollmentStatus {
  return (
    typeof value === "string" &&
    (STUDENT_ENROLLMENT_STATUSES as readonly string[]).includes(value)
  );
}

export interface NormalizeStudentEnrollmentStatusOptions {
  /**
   * Statut utilisé lorsque la valeur est vide ou inconnue.
   * Défaut : PENDING_REVIEW (évite de créer silencieusement une inscription active).
   */
  fallback?: StudentEnrollmentStatus;
}

/**
 * Normalise un statut hérité (FR, mojibake, canonique) vers le type fermé.
 * Les valeurs vides / inconnues utilisent `fallback` (PENDING_REVIEW par défaut).
 * Le pont legacy peut passer `fallback: "ENROLLED"` lorsque l'ancien champ est absent.
 */
export function normalizeStudentEnrollmentStatus(
  value: unknown,
  options: NormalizeStudentEnrollmentStatusOptions = {},
): StudentEnrollmentStatus {
  const fallback = options.fallback ?? "PENDING_REVIEW";

  if (isStudentEnrollmentStatus(value)) {
    return value;
  }

  const raw = String(value ?? "").trim();
  if (!raw) {
    return fallback;
  }

  const folded = foldStatusKey(raw);
  if (folded in LEGACY_STATUS_ALIASES) {
    return LEGACY_STATUS_ALIASES[folded];
  }

  // Correspondance partielle pour variantes mojibake restantes
  if (folded.includes("preinscrit") || folded.includes("prã")) {
    return "PRE_REGISTERED";
  }
  if (folded.includes("transfert") || folded.includes("transfer")) {
    return "TRANSFERRED";
  }
  if (folded.includes("clotur") || folded === "closed") {
    return "CLOSED";
  }
  if (folded.includes("annul")) {
    return "WITHDRAWN";
  }
  if (folded.includes("attente") || folded.includes("examen")) {
    return "PENDING_REVIEW";
  }

  return fallback;
}

export function getEnrollmentStatusPresentation(
  status: StudentEnrollmentStatus | null | undefined,
): EnrollmentStatusPresentation {
  if (!status) {
    return { label: "Aucune inscription active", tone: "neutral" };
  }
  return STATUS_PRESENTATION[status];
}

export function isActiveEnrollmentStatus(
  status: StudentEnrollmentStatus,
): boolean {
  return (ACTIVE_ENROLLMENT_STATUSES as readonly StudentEnrollmentStatus[]).includes(
    status,
  );
}

export function listEnrollmentStatusLabels(): Record<
  StudentEnrollmentStatus,
  string
> {
  return Object.fromEntries(
    STUDENT_ENROLLMENT_STATUSES.map((status) => [
      status,
      STATUS_PRESENTATION[status].label,
    ]),
  ) as Record<StudentEnrollmentStatus, string>;
}
