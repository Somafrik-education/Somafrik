/**
 * Overlay outbox → roster d'appel. queued/failed depuis la file persistante,
 * jamais depuis un state React seul.
 */
import type { AttendanceStatus, RollCallEntry } from "./attendanceTruth";
import { markRollCallSyncState, normalizeAttendanceDateKey, presenceMatchesStudent } from "./attendanceTruth";
import type { OutboxEntry } from "./outbox";
import { presenceIntentionId, type AttendanceClassIdentity } from "./attendanceClassIdentity";
import type { Student } from "../data/catalog";

type PresenceBatchPayload = {
  classId?: string;
  classCode?: string;
  date?: string;
  items?: Array<{ studentId?: string; status?: AttendanceStatus | string }>;
};

export function presencePayloadOf(entry: OutboxEntry): PresenceBatchPayload | null {
  if (entry.domain !== "presences") return null;
  if (!entry.payload || typeof entry.payload !== "object") return null;
  return entry.payload as PresenceBatchPayload;
}

export function outboxMatchesAttendanceClass(
  entry: OutboxEntry,
  identity: Pick<AttendanceClassIdentity, "classId" | "classCode">,
  todayLabel: string,
) {
  const payload = presencePayloadOf(entry);
  if (!payload) return false;
  const classId = String(payload.classId ?? "").trim();
  const classCode = String(payload.classCode ?? "").trim();
  const sameClass =
    (classId && classId === identity.classId) || (classCode && classCode === identity.classCode);
  if (!sameClass && entry.intentionId !== presenceIntentionId(identity.classId, todayLabel)) {
    return false;
  }
  return normalizeAttendanceDateKey(payload.date) === normalizeAttendanceDateKey(todayLabel);
}

export function overlayPresenceOutboxOnAttendance(input: {
  attendance: Record<string, RollCallEntry>;
  students: Array<Pick<Student, "id" | "matricule" | "publicId">>;
  entries: OutboxEntry[];
  identity: Pick<AttendanceClassIdentity, "classId" | "classCode">;
  todayLabel: string;
}): Record<string, RollCallEntry> {
  let next = { ...input.attendance };
  for (const entry of input.entries) {
    if (!outboxMatchesAttendanceClass(entry, input.identity, input.todayLabel)) continue;
    const payload = presencePayloadOf(entry);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const matchedIds: string[] = [];
    for (const item of items) {
      const student = input.students.find((row) => presenceMatchesStudent({ studentId: item.studentId }, row));
      if (!student?.id) continue;
      matchedIds.push(student.id);
      const status = (item.status as AttendanceStatus | undefined) ?? next[student.id]?.status ?? null;
      if (!status) continue;
      const current = next[student.id];
      if (entry.status === "pending" || entry.status === "sending") {
        if (current?.source === "draft") continue;
        next[student.id] = {
          ...(current ?? { status: null, source: "unset" }),
          status,
          source: "queued",
        };
      } else if (entry.status === "failed") {
        if (current?.source === "draft") continue;
        next[student.id] = {
          ...(current ?? { status: null, source: "unset" }),
          status,
          source: "failed",
        };
      }
    }
    if (entry.status === "sent" && matchedIds.length) {
      next = Object.fromEntries(
        Object.entries(next).map(([studentId, row]) => {
          if (!matchedIds.includes(studentId)) return [studentId, row];
          return [
            studentId,
            {
              ...row,
              source: "postgres" as const,
              modifiedAt: undefined,
              modifiedBy: undefined,
              previousStatus: undefined,
            },
          ];
        }),
      );
    }
  }
  return next;
}

export function markAttendanceFromOutboxStatus(
  attendance: Record<string, RollCallEntry>,
  studentIds: string[],
  status: OutboxEntry["status"],
) {
  if (status === "pending" || status === "sending") {
    return markRollCallSyncState(attendance, studentIds, "queued");
  }
  if (status === "failed") {
    return markRollCallSyncState(attendance, studentIds, "failed");
  }
  return attendance;
}
