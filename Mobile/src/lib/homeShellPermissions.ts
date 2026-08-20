import { canReadRoute } from "../domain/security/permissions";

/** Fail-closed Accueil : un KPI ou une action n’existe que si la route de destination est lisible. */

export function canShowHomeCoursesKpi(session: any, isTeacher: boolean) {
  return isTeacher
    ? canReadRoute(session, "TeacherGrades")
    : canReadRoute(session, "Timetable");
}

export function homeCoursesRoute(isTeacher: boolean) {
  return isTeacher ? "TeacherGrades" : "Timetable";
}

export function canShowHomeNotesKpi(session: any) {
  return canReadRoute(session, "StudentNotes");
}

export function canShowHomePresenceKpi(session: any) {
  return canReadRoute(session, "TeacherAttendance") || canReadRoute(session, "StudentPresences");
}

export function homePresenceRoute(session: any, isParentLike: boolean) {
  return isParentLike && canReadRoute(session, "StudentPresences")
    ? "StudentPresences"
    : "TeacherAttendance";
}

export type HomeStudentActionKey = "profile" | "notes" | "presences" | "studentPayments";

const STUDENT_ACTION_ROUTES: Record<HomeStudentActionKey, string> = {
  profile: "StudentDetail",
  notes: "StudentNotes",
  presences: "StudentPresences",
  studentPayments: "StudentPayments",
};

export function canShowHomeStudentAction(
  session: any,
  key: HomeStudentActionKey,
  selectedStudentId?: string | null,
) {
  return Boolean(selectedStudentId) && canReadRoute(session, STUDENT_ACTION_ROUTES[key]);
}

export function canOpenHomeStudentDetail(session: any, selectedStudentId?: string | null) {
  return canShowHomeStudentAction(session, "profile", selectedStudentId);
}

export function canOpenHomeStudentNotes(session: any, selectedStudentId?: string | null) {
  return canShowHomeStudentAction(session, "notes", selectedStudentId);
}
