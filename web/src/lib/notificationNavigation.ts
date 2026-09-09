/**
 * C2 — résolveur unique des destinations de notification.
 *
 * Ouvrir une notification doit conduire à LA ressource concernée. Chaque type de
 * cible produit par le backend est donc traduit ici en une route applicative
 * existante, à laquelle sont joints les identifiants portés par la cible.
 *
 * Deux règles :
 *  - l'identifiant principal est obligatoire ; sans lui, la notification n'est
 *    pas ouvrable et on ne retombe pas sur une liste générique ;
 *  - les paramètres reprennent le nom de l'identifiant métier, comme le fait
 *    déjà `/planning/remplacements` avec `weeklySlotId` et `occurrenceDate`.
 */

export type NotificationNavigationTarget = Record<string, unknown> | null | undefined;

type DestinationSpec = {
  /** Route applicative déclarée dans `App.tsx`. */
  path: string;
  /** Identifiant sans lequel la cible n'est pas ouvrable. */
  requiredKey: string;
  /** Identifiants de contexte joints s'ils sont présents. */
  contextKeys?: readonly string[];
};

const DESTINATIONS: Readonly<Record<string, DestinationSpec>> = {
  conversation: { path: "/messages", requiredKey: "conversationId" },
  announcement: { path: "/annonces", requiredKey: "announcementId" },
  payment: { path: "/finances/paiements", requiredKey: "paymentId", contextKeys: ["studentId"] },
  attendance: { path: "/presences", requiredKey: "attendanceId", contextKeys: ["studentId"] },
  grade: { path: "/notes", requiredKey: "gradeId", contextKeys: ["studentId"] },
  report_card: {
    path: "/bulletins",
    requiredKey: "reportCardId",
    contextKeys: ["studentId", "termId", "academicYearId"],
  },
  finance_obligation: {
    path: "/finances/impayes",
    requiredKey: "obligationId",
    contextKeys: ["studentId"],
  },
  timetable: {
    path: "/planning/emploi-du-temps/calendrier",
    requiredKey: "weeklySlotId",
    contextKeys: ["classId"],
  },
  teacher_replacement: {
    path: "/planning/remplacements",
    requiredKey: "replacementId",
    contextKeys: ["weeklySlotId", "occurrenceDate", "classId"],
  },
};

function readParam(target: Record<string, unknown>, key: string): string {
  const value = target[key];
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Destination applicative d'une cible de navigation, identifiants inclus.
 * Renvoie `null` quand la cible est vide, hors contrat, ou privée de son
 * identifiant principal — notamment après un refus fail-closed côté serveur.
 */
export function resolveNotificationDestination(target: NotificationNavigationTarget): string | null {
  if (!target || typeof target !== "object") return null;
  const spec = DESTINATIONS[String((target as Record<string, unknown>).type ?? "")];
  if (!spec) return null;

  const record = target as Record<string, unknown>;
  const requiredValue = readParam(record, spec.requiredKey);
  if (!requiredValue) return null;

  const params = new URLSearchParams();
  params.set(spec.requiredKey, requiredValue);
  for (const key of spec.contextKeys ?? []) {
    const value = readParam(record, key);
    if (value) params.set(key, value);
  }
  return `${spec.path}?${params.toString()}`;
}

/** Types de cible que l'interface sait ouvrir. */
export function openableNotificationTargetTypes(): string[] {
  return Object.keys(DESTINATIONS);
}
