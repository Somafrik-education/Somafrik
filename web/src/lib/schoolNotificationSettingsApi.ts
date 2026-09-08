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
