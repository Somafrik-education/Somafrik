import type { BackOfficeState, SessionUser } from "../types";
import { getCurrentSchool, scopedClasses, scopedPresences, scopedStudents } from "./establishment";
import {
  getTodayEstablishmentPresenceKpi,
  type ExpectedStudent,
  type PresenceRow,
} from "./presenceMetrics";

/** Source unique des widgets secondaires du tableau de bord établissement. */
export function buildSchoolDashboardSecondaryMetrics(
  user: SessionUser | null,
  state: BackOfficeState,
) {
  const students = scopedStudents(user, state);
  const classes = scopedClasses(user, state, students);
  const classByKey = new Map<string, Record<string, unknown>>();
  for (const schoolClass of classes) {
    for (const value of [schoolClass.id, schoolClass.classCode, schoolClass.code, schoolClass.name]) {
      const key = String(value ?? "").trim().toLocaleLowerCase("fr");
      if (key) classByKey.set(key, schoolClass);
    }
  }

  const levelCounts = new Map<string, number>();
  for (const student of students) {
    const classKey = [student.classId, student.classCode, student.className]
      .map((value) => String(value ?? "").trim().toLocaleLowerCase("fr"))
      .find((key) => key && classByKey.has(key));
    const schoolClass = classKey ? classByKey.get(classKey) : undefined;
    const label = String(schoolClass?.level ?? student.level ?? "").trim() || "Non renseigné";
    levelCounts.set(label, (levelCounts.get(label) ?? 0) + 1);
  }

  const levels = [...levelCounts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name, "fr"));

  const school = getCurrentSchool(user, state);
  const attendance = getTodayEstablishmentPresenceKpi({
    students: students as ExpectedStudent[],
    presences: scopedPresences(user, state) as PresenceRow[],
    schoolCode: school?.code ?? user?.schoolCode,
    timeZone: school?.timezone,
  });
  return { levels, attendance };
}
