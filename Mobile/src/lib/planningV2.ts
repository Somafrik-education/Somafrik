import { classifyLoadFailure } from "./dataTruth";

export const PLANNING_V2_COPY = {
  empty: "Aucun créneau planifié",
  error: "Impossible de charger le planning",
  retry: "Réessayer",
  saving: "Enregistrement…",
  usualTeacher: "Enseignant habituel",
  replacedBy: "Remplacé par",
  conflictClass: "Classe déjà occupée",
  conflictTeacher: "Enseignant déjà occupé",
  conflictRoom: "Salle déjà occupée",
  conflictGeneric: "Conflit d'emploi du temps",
} as const;

export const PLANNING_V2_TEST_IDS = {
  dayChip: "planning-day-chip",
  slotCard: "planning-slot-card",
  replacementBadge: "planning-replacement-badge",
  createButton: "planning-create",
  saveButton: "planning-save",
  conflictError: "planning-conflict-error",
} as const;

export const PLANNING_WEEKDAY_CHIPS = [
  { dayOfWeek: 1, short: "Lun" },
  { dayOfWeek: 2, short: "Mar" },
  { dayOfWeek: 3, short: "Mer" },
  { dayOfWeek: 4, short: "Jeu" },
  { dayOfWeek: 5, short: "Ven" },
  { dayOfWeek: 6, short: "Sam" },
] as const;

export type CanonicalWeeklySlot = {
  id: string;
  academicYearId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  classId: string;
  classCode: string;
  className: string;
  schoolCourseId: string;
  courseName: string;
  teacherId: string;
  teacherCode: string;
  teacherName: string;
  roomId: string | null;
  roomName: string;
  status: string;
};

export type PlanningCourseOption = {
  schoolCourseId: string;
  academicYearId: string;
  classId: string;
  classCode: string;
  className: string;
  courseName: string;
  teacherId: string;
  teacherCode: string;
  teacherName: string;
};

export type CanonicalSchoolRoom = {
  id: string;
  name: string;
  kind: string;
  capacity: number | null;
  status: string;
};

export type ReplacementTeacherOption = {
  teacherId: string;
  teacherCode: string;
  name: string;
  selectable: boolean;
};

export function normalizeReplacementTeacherOption(raw: unknown): ReplacementTeacherOption | null {
  const row = asRecord(raw);
  const teacherId = asString(row.teacherId);
  if (!teacherId) return null;
  return {
    teacherId,
    teacherCode: asString(row.teacherCode),
    name: asString(row.name || row.teacherName),
    selectable: row.selectable !== false,
  };
}

export type CanonicalReplacement = {
  id: string;
  weeklySlotId: string;
  occurrenceDate: string;
  originalTeacherId: string;
  originalTeacherName: string;
  substituteTeacherId: string;
  substituteTeacherName: string;
  reason: string;
  status: string;
};

export type DisplayedOccurrence = CanonicalWeeklySlot & {
  occurrenceDate?: string;
  isReplacement: boolean;
  originalTeacherId: string;
  originalTeacherName: string;
  substituteTeacherName: string;
};

export type WeeklySlotWriteInput = {
  schoolCourseId: string;
  academicYearId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  roomId?: string | null;
};

export type ReplacementWriteInput = {
  weeklySlotId: string;
  occurrenceDate: string;
  substituteTeacherId: string;
  reason?: string;
};

const CLIENT_SCOPE_KEYS = new Set([
  "schoolCode",
  "school_code",
  "tenantId",
  "tenant",
  "establishmentId",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNullableString(value: unknown): string | null {
  const text = asString(value);
  return text || null;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function unwrapPlanningList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.data)) return record.data;
  return [];
}

export function normalizeHhMm(value: unknown): string {
  const raw = asString(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

export function isValidDayOfWeek(value: unknown): value is number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 7;
}

export function normalizeWeeklySlot(raw: unknown): CanonicalWeeklySlot | null {
  const row = asRecord(raw);
  const id = asString(row.id);
  const schoolCourseId = asString(row.schoolCourseId);
  const dayOfWeek = Number(row.dayOfWeek);
  const startTime = normalizeHhMm(row.startTime ?? row.from);
  const endTime = normalizeHhMm(row.endTime ?? row.to);
  if (!id || !schoolCourseId || !isValidDayOfWeek(dayOfWeek) || !startTime || !endTime) {
    return null;
  }
  return {
    id,
    academicYearId: asString(row.academicYearId),
    dayOfWeek,
    startTime,
    endTime,
    classId: asString(row.classId),
    classCode: asString(row.classCode || row.class_code),
    className: asString(row.className),
    schoolCourseId,
    courseName: asString(row.courseName || row.subject),
    teacherId: asString(row.teacherId),
    teacherCode: asString(row.teacherCode),
    teacherName: asString(row.teacherName),
    roomId: asNullableString(row.roomId),
    roomName: asString(row.roomName || row.room),
    status: asString(row.status) || "active",
  };
}

export function normalizePlanningCourseOption(raw: unknown): PlanningCourseOption | null {
  const row = asRecord(raw);
  const schoolCourseId = asString(row.schoolCourseId);
  const academicYearId = asString(row.academicYearId);
  if (!schoolCourseId || !academicYearId) return null;
  const rawTeacherId = asString(row.teacherId);
  const teacherLooksLikeCode = /^ENS-/i.test(rawTeacherId);
  return {
    schoolCourseId,
    academicYearId,
    classId: asString(row.classId),
    classCode: asString(row.classCode),
    className: asString(row.className),
    courseName: asString(row.courseName || row.name || row.subject),
    teacherId: teacherLooksLikeCode ? "" : rawTeacherId,
    teacherCode: asString(row.teacherCode) || (teacherLooksLikeCode ? rawTeacherId : ""),
    teacherName: asString(row.teacherName),
  };
}

export function normalizeSchoolRoom(raw: unknown): CanonicalSchoolRoom | null {
  const row = asRecord(raw);
  const id = asString(row.id);
  const name = asString(row.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    kind: asString(row.kind || row.roomType),
    capacity: row.capacity == null ? null : asNumber(row.capacity),
    status: asString(row.status) || "active",
  };
}

export function normalizeReplacement(raw: unknown): CanonicalReplacement | null {
  const row = asRecord(raw);
  const id = asString(row.id);
  const weeklySlotId = asString(row.weeklySlotId);
  const occurrenceDate = asString(row.occurrenceDate);
  if (!id || !weeklySlotId || !occurrenceDate) return null;
  return {
    id,
    weeklySlotId,
    occurrenceDate,
    originalTeacherId: asString(row.originalTeacherId),
    originalTeacherName: asString(row.originalTeacherName),
    substituteTeacherId: asString(row.substituteTeacherId),
    substituteTeacherName: asString(row.substituteTeacherName),
    reason: asString(row.reason),
    status: asString(row.status) || "scheduled",
  };
}

export function selectableRooms(
  rooms: CanonicalSchoolRoom[],
  currentRoomId?: string | null,
): CanonicalSchoolRoom[] {
  return rooms.filter((room) => room.status !== "archived" || room.id === currentRoomId);
}

export function slotsForDay(slots: CanonicalWeeklySlot[], dayOfWeek: number): CanonicalWeeklySlot[] {
  return slots
    .filter((slot) => slot.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
}

export function formatSlotHours(slot: Pick<CanonicalWeeklySlot, "startTime" | "endTime">): string {
  return `${slot.startTime} – ${slot.endTime}`;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function overlayReplacementForDate(
  slot: CanonicalWeeklySlot,
  replacements: CanonicalReplacement[],
  occurrenceDate: string,
): DisplayedOccurrence {
  const match = replacements.find(
    (item) =>
      item.weeklySlotId === slot.id &&
      item.occurrenceDate === occurrenceDate &&
      item.status !== "cancelled",
  );
  if (!match) {
    return {
      ...slot,
      occurrenceDate,
      isReplacement: false,
      originalTeacherId: slot.teacherId,
      originalTeacherName: slot.teacherName,
      substituteTeacherName: "",
    };
  }
  return {
    ...slot,
    occurrenceDate,
    isReplacement: true,
    teacherId: slot.teacherId,
    teacherName: slot.teacherName,
    originalTeacherId: match.originalTeacherId || slot.teacherId,
    originalTeacherName: match.originalTeacherName || slot.teacherName,
    substituteTeacherName: match.substituteTeacherName,
  };
}

export function displayedOccurrencesForDay(params: {
  slots: CanonicalWeeklySlot[];
  replacements: CanonicalReplacement[];
  dayOfWeek: number;
  occurrenceDate: string;
}): DisplayedOccurrence[] {
  return slotsForDay(params.slots, params.dayOfWeek).map((slot) =>
    overlayReplacementForDate(slot, params.replacements, params.occurrenceDate),
  );
}

export function nearestOccurrenceDate(dayOfWeek: number, from = new Date()): string {
  const current = from.getDay() === 0 ? 7 : from.getDay();
  const delta = (dayOfWeek - current + 7) % 7;
  const target = new Date(from);
  target.setDate(from.getDate() + delta);
  return isoDate(target);
}

export function stripPlanningClientScope<T extends Record<string, unknown>>(payload: T): T {
  const next = { ...payload };
  for (const key of Object.keys(next)) {
    if (CLIENT_SCOPE_KEYS.has(key)) delete next[key];
  }
  delete (next as { teacherId?: unknown }).teacherId;
  delete (next as { teacherCode?: unknown }).teacherCode;
  delete (next as { className?: unknown }).className;
  delete (next as { subject?: unknown }).subject;
  delete (next as { room?: unknown }).room;
  delete (next as { schoolCode?: unknown }).schoolCode;
  return next;
}

export function buildCreateWeeklySlotPayload(input: WeeklySlotWriteInput): Record<string, unknown> {
  if (!input.schoolCourseId.trim()) {
    throw new Error("schoolCourseId requis");
  }
  if (!input.academicYearId.trim()) {
    throw new Error("academicYearId requis");
  }
  if (!isValidDayOfWeek(input.dayOfWeek)) {
    throw new Error("dayOfWeek invalide");
  }
  const startTime = normalizeHhMm(input.startTime);
  const endTime = normalizeHhMm(input.endTime);
  if (!startTime || !endTime) {
    throw new Error("heures invalides");
  }
  const payload: Record<string, unknown> = {
    schoolCourseId: input.schoolCourseId.trim(),
    academicYearId: input.academicYearId.trim(),
    dayOfWeek: Number(input.dayOfWeek),
    startTime,
    endTime,
  };
  if (input.roomId) payload.roomId = input.roomId;
  return stripPlanningClientScope(payload);
}

export function buildUpdateWeeklySlotPayload(
  input: Partial<WeeklySlotWriteInput> & { roomId?: string | null },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.schoolCourseId) payload.schoolCourseId = input.schoolCourseId.trim();
  if (input.academicYearId) payload.academicYearId = input.academicYearId.trim();
  if (input.dayOfWeek != null) payload.dayOfWeek = Number(input.dayOfWeek);
  if (input.startTime) payload.startTime = normalizeHhMm(input.startTime);
  if (input.endTime) payload.endTime = normalizeHhMm(input.endTime);
  if (input.roomId !== undefined) payload.roomId = input.roomId || null;
  return stripPlanningClientScope(payload);
}

export function buildCreateReplacementPayload(input: ReplacementWriteInput): Record<string, unknown> {
  return {
    weeklySlotId: input.weeklySlotId.trim(),
    occurrenceDate: input.occurrenceDate.trim(),
    substituteTeacherId: input.substituteTeacherId.trim(),
    ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
  };
}

export function mapPlanningConflictMessage(error: unknown): string {
  const record = error && typeof error === "object" ? (error as { message?: unknown; status?: unknown; code?: unknown }) : {};
  const message = error instanceof Error ? error.message : typeof record.message === "string" ? record.message : "";
  const status = Number(record.status);
  const code = typeof record.code === "string" ? record.code : "";
  const haystack = `${code} ${message}`.toLowerCase();
  if (haystack.includes("classe déjà occupée") || haystack.includes("class already")) {
    return PLANNING_V2_COPY.conflictClass;
  }
  if (haystack.includes("enseignant déjà occupé") || haystack.includes("teacher already")) {
    return PLANNING_V2_COPY.conflictTeacher;
  }
  if (haystack.includes("salle déjà occupée") || haystack.includes("room already")) {
    return PLANNING_V2_COPY.conflictRoom;
  }
  if (status === 409 || code === "COURSE_SCHEDULE_CONFLICT") {
    return message || PLANNING_V2_COPY.conflictGeneric;
  }
  return classifyLoadFailure(error).status === "offline"
    ? "Hors ligne"
    : message || "Impossible d'enregistrer le créneau";
}

export function assertNoLegacyPlanningIdentity(payload: Record<string, unknown>): void {
  if ("schoolCode" in payload || "school_code" in payload) {
    throw new Error("schoolCode client interdit");
  }
  if ("subject" in payload || "room" in payload || "className" in payload) {
    throw new Error("identifiants libres interdits");
  }
  if ("teacherId" in payload || "teacherCode" in payload) {
    throw new Error("teacherId client interdit");
  }
}
