/**
 * AUDIT-SETUP-GUIDED-10-01 / A6 — règles de notification de l'établissement (Mobile natif).
 * Parité stricte avec le Web (`web/src/lib/schoolNotificationSettingsApi.ts`,
 * `SettingsNotificationsPage`) : mêmes événements, destinataires, canaux et patchs.
 * La validation et les droits restent ceux du Backend (PATCH notification-settings).
 */

export type SchoolNotificationChannel = "IN_APP" | "PUSH" | "EMAIL";
export type SchoolNotificationRecipient = "PARENT" | "STUDENT" | "TEACHER" | "SCHOOL_ADMIN";
export type SchoolNotificationEvent =
  | "STUDENT_ABSENT"
  | "STUDENT_LATE"
  | "GRADE_PUBLISHED"
  | "REPORT_CARD_PUBLISHED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_DUE"
  | "ANNOUNCEMENT_PUBLISHED"
  | "TIMETABLE_CHANGED"
  | "TEACHER_REPLACEMENT";

export type SchoolNotificationChannels = Record<SchoolNotificationChannel, boolean>;

export type SchoolNotificationEventRule = {
  allowedRecipients: SchoolNotificationRecipient[];
} & Partial<Record<SchoolNotificationRecipient, Partial<SchoolNotificationChannels>>>;

export type SchoolNotificationSettings = {
  schoolCode: string;
  events: Partial<Record<SchoolNotificationEvent, SchoolNotificationEventRule>>;
  /** false = règles par défaut affichées, aucune règle enregistrée pour l'établissement. */
  configured?: boolean;
};

export type SchoolNotificationSettingsPatch = {
  events: Partial<
    Record<SchoolNotificationEvent, Partial<Record<SchoolNotificationRecipient, Partial<SchoolNotificationChannels>>>>
  >;
};

export const NOTIFICATION_EVENT_ORDER: SchoolNotificationEvent[] = [
  "STUDENT_ABSENT",
  "STUDENT_LATE",
  "GRADE_PUBLISHED",
  "REPORT_CARD_PUBLISHED",
  "PAYMENT_RECEIVED",
  "PAYMENT_DUE",
  "ANNOUNCEMENT_PUBLISHED",
  "TIMETABLE_CHANGED",
  "TEACHER_REPLACEMENT",
];

export const NOTIFICATION_EVENT_LABELS: Record<SchoolNotificationEvent, string> = {
  STUDENT_ABSENT: "Absence d'un élève",
  STUDENT_LATE: "Retard d'un élève",
  GRADE_PUBLISHED: "Note publiée",
  REPORT_CARD_PUBLISHED: "Bulletin publié",
  PAYMENT_RECEIVED: "Paiement reçu",
  PAYMENT_DUE: "Paiement à régler",
  ANNOUNCEMENT_PUBLISHED: "Annonce publiée",
  TIMETABLE_CHANGED: "Emploi du temps modifié",
  TEACHER_REPLACEMENT: "Remplacement d'enseignant",
};

export const NOTIFICATION_RECIPIENT_LABELS: Record<SchoolNotificationRecipient, string> = {
  PARENT: "Parents",
  STUDENT: "Élèves",
  TEACHER: "Enseignants",
  SCHOOL_ADMIN: "Administration",
};

export const NOTIFICATION_CHANNELS: Array<{ key: SchoolNotificationChannel; label: string }> = [
  { key: "IN_APP", label: "Application" },
  { key: "PUSH", label: "Push" },
  { key: "EMAIL", label: "E-mail" },
];

export type NotificationRow = { id: string; event: SchoolNotificationEvent; recipient: SchoolNotificationRecipient };

export function notificationRowsFromSettings(settings: SchoolNotificationSettings | null): NotificationRow[] {
  if (!settings) return [];
  const rows: NotificationRow[] = [];
  for (const event of NOTIFICATION_EVENT_ORDER) {
    const rule = settings.events[event];
    if (!rule) continue;
    for (const recipient of rule.allowedRecipients) {
      rows.push({ id: `${event}:${recipient}`, event, recipient });
    }
  }
  return rows;
}

/** Canal absent = activé, comme à l'écran Web. */
export function notificationChannelOf(
  rule: SchoolNotificationEventRule | undefined,
  recipient: SchoolNotificationRecipient,
  channel: SchoolNotificationChannel,
): boolean {
  return rule?.[recipient]?.[channel] ?? true;
}

/** Toutes les règles affichées (défauts compris), pour les enregistrer telles quelles. */
export function notificationPatchFromDisplayedRules(settings: SchoolNotificationSettings): SchoolNotificationSettingsPatch {
  const events: SchoolNotificationSettingsPatch["events"] = {};
  for (const [event, rule] of Object.entries(settings.events) as Array<[SchoolNotificationEvent, SchoolNotificationEventRule]>) {
    if (!rule) continue;
    const byRecipient: Partial<Record<SchoolNotificationRecipient, Partial<SchoolNotificationChannels>>> = {};
    for (const recipient of rule.allowedRecipients) {
      byRecipient[recipient] = Object.fromEntries(
        NOTIFICATION_CHANNELS.map(({ key }) => [key, notificationChannelOf(rule, recipient, key)]),
      ) as SchoolNotificationChannels;
    }
    events[event] = byRecipient;
  }
  return { events };
}

/** Patch d'un seul interrupteur : valeur inversée de la cellule affichée. */
export function notificationTogglePatch(
  settings: SchoolNotificationSettings,
  event: SchoolNotificationEvent,
  recipient: SchoolNotificationRecipient,
  channel: SchoolNotificationChannel,
): SchoolNotificationSettingsPatch {
  const nextValue = !notificationChannelOf(settings.events[event], recipient, channel);
  return { events: { [event]: { [recipient]: { [channel]: nextValue } } } };
}

/** État local optimiste après un interrupteur (rétabli si le Backend refuse). */
export function notificationSettingsWithToggle(
  settings: SchoolNotificationSettings,
  event: SchoolNotificationEvent,
  recipient: SchoolNotificationRecipient,
  channel: SchoolNotificationChannel,
): SchoolNotificationSettings {
  const rule = settings.events[event];
  if (!rule) return settings;
  const nextValue = !notificationChannelOf(rule, recipient, channel);
  return {
    ...settings,
    events: {
      ...settings.events,
      [event]: { ...rule, [recipient]: { ...rule[recipient], [channel]: nextValue } },
    },
  };
}
