/**
 * Projections UI depuis les DTO L1 minimaux.
 * Libellés dérivés uniquement des codes stables. Jamais de noms inventés.
 */
import type { SchoolClass, Student, TeacherAssignment } from "../../data/catalog";
import type { CanonicalWeeklySlot } from "../../lib/planningV2";
import type { SchoolClassCourseRecord } from "../../services/schoolSettingsApi";
import type { L1Partition, SqlValue } from "./types";
import { readL1Resource, type L1ReadDeps, type L1ReadOk, type L1SessionLike } from "./readModel";

function cell(row: Record<string, SqlValue>, key: string): string {
  const value = row[key];
  if (value == null) return "";
  return String(value).trim();
}

function displayCourseLabel(row: Record<string, SqlValue>): string {
  return cell(row, "subject_code") || cell(row, "course_code") || "Cours";
}

function classLookup(classRows: Record<string, SqlValue>[]): {
  byId: Map<string, Record<string, SqlValue>>;
  byCode: Map<string, Record<string, SqlValue>>;
} {
  const byId = new Map<string, Record<string, SqlValue>>();
  const byCode = new Map<string, Record<string, SqlValue>>();
  for (const row of classRows) {
    const id = cell(row, "id");
    const code = cell(row, "class_code");
    if (id) byId.set(id, row);
    if (code) byCode.set(code, row);
  }
  return { byId, byCode };
}

function joinedClassName(
  row: Record<string, SqlValue>,
  lookup: ReturnType<typeof classLookup>,
): string {
  const classId = cell(row, "class_id");
  const classCode = cell(row, "class_code");
  const matched = (classId ? lookup.byId.get(classId) : undefined) ?? (classCode ? lookup.byCode.get(classCode) : undefined);
  return cell(matched ?? {}, "name") || classCode;
}

export function projectL1Class(row: Record<string, SqlValue>, partition: L1Partition): SchoolClass {
  const classCode = cell(row, "class_code");
  const name = cell(row, "name") || classCode;
  return {
    id: cell(row, "id"),
    publicId: classCode || cell(row, "id"),
    classCode,
    name,
    level: "",
    track: "",
    teacherId: "",
    academicYearId: cell(row, "academic_year_id") || undefined,
    levelId: cell(row, "level_id") || null,
    streamId: cell(row, "stream_id") || null,
    groupId: cell(row, "group_id") || null,
    status: cell(row, "status") || undefined,
    schoolCode: partition.schoolCode,
  };
}

export function projectL1Classes(read: L1ReadOk): SchoolClass[] {
  return read.rows.map((row) => projectL1Class(row, read.partition));
}

export function projectL1Student(
  row: Record<string, SqlValue>,
  partition: L1Partition,
  lookup: ReturnType<typeof classLookup>,
): Student {
  const studentCode = cell(row, "student_code");
  const firstName = cell(row, "first_name");
  const lastName = cell(row, "last_name");
  const name = [firstName, lastName].filter(Boolean).join(" ").trim() || studentCode;
  return {
    id: cell(row, "id"),
    publicId: studentCode || cell(row, "id"),
    name,
    firstName,
    lastName,
    matricule: studentCode,
    studentCode,
    gender: "",
    birthDate: "",
    classId: cell(row, "class_id") || null,
    classCode: cell(row, "class_code") || undefined,
    className: joinedClassName(row, lookup),
    academicYearId: cell(row, "academic_year_id") || undefined,
    schoolCode: partition.schoolCode,
    parentName: "",
    parentPhone: "",
    parentEmail: "",
    status: cell(row, "status") || undefined,
  };
}

export function projectL1Students(read: L1ReadOk, classRows: Record<string, SqlValue>[] = []): Student[] {
  const lookup = classLookup(classRows);
  return read.rows.map((row) => projectL1Student(row, read.partition, lookup));
}

export function projectL1Assignment(
  row: Record<string, SqlValue>,
  lookup: ReturnType<typeof classLookup>,
): TeacherAssignment {
  const subjectCode = cell(row, "subject_code");
  const classCode = cell(row, "class_code");
  return {
    id: cell(row, "id") || undefined,
    teacherId: cell(row, "teacher_id") || undefined,
    teacherCode: cell(row, "teacher_code") || undefined,
    teacherUserId: cell(row, "teacher_user_id") || undefined,
    classId: cell(row, "class_id") || null,
    classCode: classCode || undefined,
    className: joinedClassName(row, lookup),
    course: subjectCode,
    subject: subjectCode || undefined,
    subjectId: cell(row, "subject_id") || undefined,
    subjectCode: subjectCode || undefined,
    academicYearId: cell(row, "academic_year_id") || undefined,
    assignmentRole: cell(row, "assignment_role") || undefined,
    status: cell(row, "status") || undefined,
  };
}

export function projectL1Assignments(read: L1ReadOk, classRows: Record<string, SqlValue>[] = []): TeacherAssignment[] {
  const lookup = classLookup(classRows);
  return read.rows.map((row) => projectL1Assignment(row, lookup));
}

export function projectL1SchoolCourse(
  row: Record<string, SqlValue>,
  lookup: ReturnType<typeof classLookup>,
): SchoolClassCourseRecord {
  const courseCode = cell(row, "course_code") || undefined;
  const subjectCode = cell(row, "subject_code") || undefined;
  return {
    id: cell(row, "id"),
    publicId: courseCode,
    className: joinedClassName(row, lookup),
    name: displayCourseLabel(row),
    courseCode,
    subjectCode,
    teacherCode: cell(row, "teacher_code") || undefined,
    coefficient: (() => {
      const raw = cell(row, "coefficient");
      if (!raw) return undefined;
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    })(),
    status: cell(row, "status") || undefined,
  };
}

export function projectL1SchoolCourses(
  read: L1ReadOk,
  classRows: Record<string, SqlValue>[] = [],
): SchoolClassCourseRecord[] {
  const lookup = classLookup(classRows);
  return read.rows.map((row) => projectL1SchoolCourse(row, lookup));
}

export function projectL1CourseSchedule(
  row: Record<string, SqlValue>,
  lookup: ReturnType<typeof classLookup>,
): CanonicalWeeklySlot {
  const teacherCode = cell(row, "teacher_code");
  const roomCode = cell(row, "room_code");
  return {
    id: cell(row, "id"),
    academicYearId: cell(row, "academic_year_id"),
    dayOfWeek: Number(row.day_of_week) || 0,
    startTime: cell(row, "start_time"),
    endTime: cell(row, "end_time"),
    classId: cell(row, "class_id"),
    classCode: cell(row, "class_code"),
    className: joinedClassName(row, lookup),
    schoolCourseId: cell(row, "school_course_id"),
    courseName: displayCourseLabel(row),
    teacherId: cell(row, "teacher_id"),
    teacherCode,
    teacherName: teacherCode,
    roomId: cell(row, "room_id") || null,
    roomName: roomCode,
    status: cell(row, "status"),
  };
}

export function projectL1CourseSchedules(
  read: L1ReadOk,
  classRows: Record<string, SqlValue>[] = [],
): CanonicalWeeklySlot[] {
  const lookup = classLookup(classRows);
  return read.rows.map((row) => projectL1CourseSchedule(row, lookup));
}

export async function classRowsForJoin(
  session: L1SessionLike,
  deps?: L1ReadDeps,
): Promise<Record<string, SqlValue>[]> {
  const classesRead = await readL1Resource({ session, resource: "classes", deps });
  return classesRead.ok ? classesRead.rows : [];
}
