import { api } from "../api/client";

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
} & Partial<Record<SchoolNotificationRecipient, SchoolNotificationChannels>>;

export type SchoolNotificationSettings = {
  schoolCode: string;
  events: Record<SchoolNotificationEvent, SchoolNotificationEventRule>;
  /** false = règles par défaut affichées, aucune règle enregistrée pour l'établissement. */
  configured?: boolean;
};

export type SchoolNotificationSettingsPatch = {
  events: Partial<Record<SchoolNotificationEvent, Partial<Record<SchoolNotificationRecipient, Partial<SchoolNotificationChannels>>>>>;
};

export function getSchoolNotificationSettings(schoolCode: string) {
  return api.get<SchoolNotificationSettings>(
    `/backoffice/establishments/${encodeURIComponent(schoolCode)}/notification-settings`,
  );
}

export function patchSchoolNotificationSettings(schoolCode: string, patch: SchoolNotificationSettingsPatch) {
  return api.patch<SchoolNotificationSettings>(
    `/backoffice/establishments/${encodeURIComponent(schoolCode)}/notification-settings`,
    patch,
  );
}

const DISPLAY_CHANNELS: SchoolNotificationChannel[] = ["IN_APP", "PUSH", "EMAIL"];

/**
 * PROD-V25-POSTSMOKE-01 — toutes les règles affichées (valeurs par défaut comprises), limitées aux
 * destinataires autorisés, pour les enregistrer telles quelles (canal absent = activé, comme à l'écran).
 */
export function patchFromDisplayedRules(settings: SchoolNotificationSettings): SchoolNotificationSettingsPatch {
  const events: SchoolNotificationSettingsPatch["events"] = {};
  for (const [event, rule] of Object.entries(settings.events) as Array<[SchoolNotificationEvent, SchoolNotificationEventRule]>) {
    if (!rule) continue;
    const byRecipient: Partial<Record<SchoolNotificationRecipient, Partial<SchoolNotificationChannels>>> = {};
    for (const recipient of rule.allowedRecipients) {
      byRecipient[recipient] = Object.fromEntries(
        DISPLAY_CHANNELS.map((channel) => [channel, rule[recipient]?.[channel] ?? true]),
      ) as SchoolNotificationChannels;
    }
    events[event] = byRecipient;
  }
  return { events };
}
