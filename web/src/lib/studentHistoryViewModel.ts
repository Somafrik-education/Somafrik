import {
  diagnoseStudentHistory,
  filterStudentHistoryRecordByVisibility,
  historyEventTimestamp,
  isRecentHistoryEvent,
  sortStudentHistoryEvents,
  type HistoryIconKey,
  type HistorySeverity,
  type HistorySourceModule,
  type HistoryVisibility,
  type StudentHistoryDiagnostics,
  type StudentHistoryEvent,
  type StudentHistoryEventType,
  type StudentHistoryRecord,
  type StudentHistorySummary,
} from "./studentHistory";
import { formatCivilDateLabel, parseCivilDate } from "./studentWorkspaceDates";

export type HistoryGroupKey =
  | "TODAY"
  | "YESTERDAY"
  | "THIS_WEEK"
  | "THIS_MONTH"
  | "OLDER";

export interface StudentHistoryEventViewModel {
  id: string;
  type: StudentHistoryEventType;
  occurredAt: string;
  occurredAtLabel: string;
  dayLabel: string;
  title: string;
  descriptionLabel: string;
  severity: HistorySeverity;
  severityLabel: string;
  sourceModule: HistorySourceModule;
  sourceModuleLabel: string;
  actorLabel: string;
  visibility: HistoryVisibility;
  iconKey: HistoryIconKey;
  isImportant: boolean;
  isRecent: boolean;
}

export interface StudentHistoryGroupViewModel {
  key: HistoryGroupKey;
  label: string;
  events: StudentHistoryEventViewModel[];
}

export interface StudentHistoryViewModel {
  studentId: string;
  summary: StudentHistorySummary;
  groups: StudentHistoryGroupViewModel[];
  timeline: StudentHistoryEventViewModel[];
  diagnostics: StudentHistoryDiagnostics;
  emptyState: string;
  latestImportantEventLabel: string | null;
}

export interface BuildStudentHistoryViewModelOptions {
  missingValueLabel?: string;
  allowedVisibility?: readonly HistoryVisibility[];
  referenceDate?: Date;
}

const MISSING = "Non renseigné";
const DEFAULT_ALLOWED_VISIBILITY: readonly HistoryVisibility[] = [
  "STAFF",
  "ADMIN",
];

const SEVERITY_LABELS: Record<HistorySeverity, string> = {
  INFO: "Information",
  WARNING: "Attention",
  IMPORTANT: "Important",
};

const SOURCE_LABELS: Record<HistorySourceModule, string> = {
  IDENTITY: "Identité",
  ENROLLMENT: "Inscription",
  GUARDIANS: "Responsables",
  MEDICAL: "Médical",
  DOCUMENTS: "Documents",
  SYSTEM: "Système",
};

const GROUP_LABELS: Record<HistoryGroupKey, string> = {
  TODAY: "Aujourd'hui",
  YESTERDAY: "Hier",
  THIS_WEEK: "Cette semaine",
  THIS_MONTH: "Ce mois",
  OLDER: "Plus ancien",
};

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function civilFromOccurredAt(occurredAt: string): Date | null {
  const raw = occurredAt.trim();
  if (!raw) return null;
  const civil = parseCivilDate(raw.slice(0, 10));
  if (civil) return startOfDay(civil);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return startOfDay(parsed);
}

export function resolveHistoryGroupKey(
  occurredAt: string,
  referenceDate: Date = new Date(),
): HistoryGroupKey {
  const eventDay = civilFromOccurredAt(occurredAt);
  if (!eventDay) return "OLDER";

  const today = startOfDay(referenceDate);
  const diffDays = Math.round(
    (today.getTime() - eventDay.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (diffDays === 0) return "TODAY";
  if (diffDays === 1) return "YESTERDAY";
  if (diffDays >= 2 && diffDays < 7) return "THIS_WEEK";
  if (
    eventDay.getFullYear() === today.getFullYear() &&
    eventDay.getMonth() === today.getMonth()
  ) {
    return "THIS_MONTH";
  }
  return "OLDER";
}

function toEventViewModel(
  event: StudentHistoryEvent,
  missingValueLabel: string,
  referenceDate: Date,
): StudentHistoryEventViewModel {
  const dayLabel = formatCivilDateLabel(
    event.occurredAt.slice(0, 10),
    missingValueLabel,
  );

  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    occurredAtLabel: formatCivilDateLabel(
      event.occurredAt.slice(0, 10),
      missingValueLabel,
    ),
    dayLabel,
    title: event.title,
    descriptionLabel: event.description?.trim() || missingValueLabel,
    severity: event.severity,
    severityLabel: SEVERITY_LABELS[event.severity],
    sourceModule: event.sourceModule,
    sourceModuleLabel: SOURCE_LABELS[event.sourceModule],
    actorLabel: event.actor?.trim() || "Administration",
    visibility: event.visibility,
    iconKey: event.iconKey,
    isImportant: event.severity === "IMPORTANT",
    isRecent: isRecentHistoryEvent(event.occurredAt, referenceDate),
  };
}

export function groupStudentHistoryEvents(
  events: readonly StudentHistoryEventViewModel[],
  referenceDate: Date = new Date(),
): StudentHistoryGroupViewModel[] {
  const buckets: Record<HistoryGroupKey, StudentHistoryEventViewModel[]> = {
    TODAY: [],
    YESTERDAY: [],
    THIS_WEEK: [],
    THIS_MONTH: [],
    OLDER: [],
  };

  for (const event of events) {
    const key = resolveHistoryGroupKey(event.occurredAt, referenceDate);
    buckets[key].push(event);
  }

  const order: HistoryGroupKey[] = [
    "TODAY",
    "YESTERDAY",
    "THIS_WEEK",
    "THIS_MONTH",
    "OLDER",
  ];

  return order
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({
      key,
      label: GROUP_LABELS[key],
      events: buckets[key],
    }));
}

export function buildStudentHistoryViewModel(
  record: StudentHistoryRecord,
  options: BuildStudentHistoryViewModelOptions = {},
): StudentHistoryViewModel {
  const missingValueLabel = options.missingValueLabel?.trim() || MISSING;
  const allowedVisibility =
    options.allowedVisibility ?? DEFAULT_ALLOWED_VISIBILITY;
  const referenceDate = options.referenceDate ?? new Date();

  const visibleRecord = filterStudentHistoryRecordByVisibility(
    record,
    allowedVisibility,
    referenceDate,
  );
  const sorted = sortStudentHistoryEvents(visibleRecord.events);
  const timeline = sorted.map((event) =>
    toEventViewModel(event, missingValueLabel, referenceDate),
  );
  const diagnostics = diagnoseStudentHistory(visibleRecord, referenceDate);
  const groups = groupStudentHistoryEvents(timeline, referenceDate);

  return {
    studentId: visibleRecord.studentId,
    summary: visibleRecord.summary,
    groups,
    timeline,
    diagnostics,
    emptyState: "Aucun événement dans l'historique",
    latestImportantEventLabel: diagnostics.latestImportantEvent
      ? diagnostics.latestImportantEvent.title
      : null,
  };
}

export function compareHistoryEventsForTests(
  left: StudentHistoryEvent,
  right: StudentHistoryEvent,
): number {
  const timeDelta =
    historyEventTimestamp(right.occurredAt) -
    historyEventTimestamp(left.occurredAt);
  if (timeDelta !== 0) return timeDelta;
  return left.id.localeCompare(right.id);
}
