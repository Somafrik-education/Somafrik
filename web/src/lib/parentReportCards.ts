import type { PublishedVersionRow } from "./reportCardHistoryApi";
import type {
  RenderingTemplate,
  ReportCardPublicationRow,
  ReportCardPublicationSnapshot,
  SnapshotPayload,
  SnapshotStudent,
} from "./parentReportCardApi";
import {
  parentDashboardStudentKeys,
  type ParentDashboardStudent,
} from "./parentDashboard";
import { isParentRole } from "./format";

function normalizeRef(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export type ParentPublishedReportCard = {
  id: string;
  reportCardId: string;
  version: number;
  studentId: string;
  period: string;
  publishedAt: string;
  verificationStatus: string;
  payload: SnapshotPayload;
  template?: RenderingTemplate | null;
  student: SnapshotStudent;
  history: PublishedVersionRow[];
};

export function reportCardRouteMode(role?: string): "parent" | "staff" {
  return isParentRole(role) ? "parent" : "staff";
}

export function studentSnapshotPeriod(student: SnapshotStudent): string {
  const periods = [
    ...new Set(
      (student.cells ?? [])
        .map((cell) => String(cell.period_id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  return periods.join(" · ");
}

export function cardsFromPublishedSnapshot(
  publication: ReportCardPublicationRow,
  snapshot: ReportCardPublicationSnapshot | null,
  history: PublishedVersionRow[] = [],
): ParentPublishedReportCard[] {
  if (!snapshot?.payload) return [];
  const version = Number(
    publication.published_snapshot_version ??
      snapshot.payload.published_snapshot_version ??
      0,
  );
  return (snapshot.payload.students ?? []).map((student) => {
    const studentId = String(student.student_id ?? "").trim();
    return {
      id: publication.report_card_id + ":" + version + ":" + studentId,
      reportCardId: publication.report_card_id,
      version,
      studentId,
      period: studentSnapshotPeriod(student),
      publishedAt: String(snapshot.payload.published_at ?? ""),
      verificationStatus: String(publication.verification_status ?? "ACTIVE"),
      payload: snapshot.payload,
      template: snapshot.template ?? null,
      student,
      history,
    };
  });
}

export function filterParentPublishedReportCards(
  rows: readonly ParentPublishedReportCard[],
  student: ParentDashboardStudent | null,
  period = "",
): ParentPublishedReportCard[] {
  const keys = new Set(parentDashboardStudentKeys(student));
  if (!keys.size) return [];
  const targetPeriod = String(period ?? "").trim();
  return rows.filter((row) => {
    if (!keys.has(normalizeRef(row.studentId))) return false;
    if (targetPeriod && row.period !== targetPeriod) return false;
    return true;
  });
}

export function parentReportCardPeriods(
  rows: readonly ParentPublishedReportCard[],
  student: ParentDashboardStudent | null,
): string[] {
  return [
    ...new Set(
      filterParentPublishedReportCards(rows, student)
        .map((row) => row.period)
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right, "fr"));
}

export function snapshotForParentStudent(
  payload: SnapshotPayload | null | undefined,
  student: ParentDashboardStudent | null,
): SnapshotPayload | null {
  if (!payload || !student) return null;
  const keys = new Set(parentDashboardStudentKeys(student));
  const students = (payload.students ?? []).filter((row) =>
    keys.has(normalizeRef(row.student_id)),
  );
  if (!students.length) return null;
  return { ...payload, students };
}
