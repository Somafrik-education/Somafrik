import { normalize } from "./format";
import { isTeacherUserRole } from "./userTeacherSync";
import { sessionRoleToPlatformRole } from "./orgHierarchy";
import type { Student, Teacher, TeacherAssignment, SchoolClass } from "../data/catalog";
import { projectScopedStudentsForSession } from "./studentsScope";

type Row = Record<string, unknown>;

export interface TeacherScopeState {
  teachers?: Teacher[];
  assignments?: TeacherAssignment[];
  classes?: SchoolClass[];
  /**
   * Provenance des affectations. En `network`, GET /assignments est déjà
   * tenant/RBAC-filtré côté serveur. En `l1-cache`, un enseignant n'est matché
   * que par `teacherUserId === session.user.id` (fail-closed).
   */
  assignmentsSource?: "network" | "l1-cache";
}

export function isTeacherSession(session: { role?: string; user?: { role?: string } } | null): boolean {
  if (!session) return false;
  if (session.role === "teacher") return true;
  return isTeacherUserRole(session.user?.role) || isTeacherUserRole(sessionRoleToPlatformRole(session.role));
}

export function classNameMatches(left?: string, right?: string): boolean {
  return normalize(left) === normalize(right);
}

/** Retrouve la fiche enseignant liée à la session (userId puis identifiant). */
export function resolveTeacherRecordForSession(
  session: { user?: Row } | null,
  teachers: Teacher[] = [],
): Teacher | null {
  const user = session?.user;
  if (!user) return null;
  const userId = String(user.id ?? "").trim();
  const identifier = normalize(String(user.identifier ?? ""));
  return (
    teachers.find((teacher) => {
      const row = teacher as Row;
      if (userId && String(row.userId ?? "") === userId) return true;
      if (identifier && normalize(String(row.identifier ?? "")) === identifier) return true;
      return false;
    }) ?? null
  );
}

const INACTIVE_ASSIGNMENT_STATUSES = new Set([
  "archived",
  "archive",
  "inactive",
  "inactif",
  "deleted",
  "closed",
  "ferme",
  "fermee",
  "historique",
]);

/** Affectation pédagogique active : GET /assignments, hors archivées / inactives. */
export function isCanonicalActiveAssignment(assignment: TeacherAssignment | Row | null | undefined): boolean {
  if (!assignment || typeof assignment !== "object") return false;
  const row = assignment as Row;
  const status = String(row.status ?? row.assignmentStatus ?? row.assignment_status ?? "active")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (!status) return false;
  return !INACTIVE_ASSIGNMENT_STATUSES.has(status);
}

function collectSessionTeacherRefKeys(
  session: { user?: Row } | null,
  teacher: Teacher | null,
): Set<string> {
  const refs = new Set<string>();
  const user = session?.user ?? {};
  const teacherRow = (teacher ?? {}) as Row;
  for (const value of [
    user.id,
    user.publicId,
    user.identifier,
    user.teacherId,
    user.teacherCode,
    teacherRow.id,
    teacherRow.publicId,
    teacherRow.userId,
    teacherRow.identifier,
    teacherRow.teacherCode,
    teacherRow.teacherId,
  ]) {
    const key = String(value ?? "").trim();
    if (key) refs.add(key);
  }
  return refs;
}

function assignmentBelongsToTeacher(assignment: TeacherAssignment | Row, refKeys: Set<string>): boolean {
  if (!refKeys.size) return false;
  const row = assignment as Row;
  for (const value of [
    row.teacherId,
    row.teacherCode,
    row.teacherUserId,
    row.teacher_id,
    row.teacher_code,
    row.teacher_user_id,
  ]) {
    const key = String(value ?? "").trim();
    if (key && refKeys.has(key)) return true;
  }
  return false;
}

function asTeacherScopeState(assignmentsOrState: TeacherAssignment[] | TeacherScopeState = {}): TeacherScopeState {
  return Array.isArray(assignmentsOrState) ? { assignments: assignmentsOrState } : assignmentsOrState;
}

/**
 * Affectations pédagogiques canoniques actives de l'enseignant connecté.
 * Autorité unique : `state.assignments` (GET /assignments). Pas de listes
 * dénormalisées, pas de titulaire de classe, pas de matching nominatif.
 *
 * En ligne, l'API a déjà appliqué le scope principal live : ne pas refaire un
 * matching client avec une représentation d'identité différente de celle du JWT.
 * Hors ligne, le cache L1 reste fail-closed sur teacherUserId.
 */
export function listCanonicalTeacherAssignments(
  session: { role?: string; user?: Row } | null,
  assignmentsOrState: TeacherAssignment[] | TeacherScopeState = {},
): TeacherAssignment[] {
  const state = asTeacherScopeState(assignmentsOrState);
  const active = (state.assignments ?? []).filter((row) => isCanonicalActiveAssignment(row));
  if (!isTeacherSession(session)) return active;

  if (state.assignmentsSource === "network") {
    return active;
  }
  if (state.assignmentsSource === "l1-cache") {
    return active.filter((assignment) => l1AssignmentBelongsToTeacherSession(assignment, session));
  }

  const teacher = resolveTeacherRecordForSession(session, state.teachers ?? []);
  const refKeys = collectSessionTeacherRefKeys(session, teacher);
  if (!refKeys.size) return [];
  return active.filter((assignment) => assignmentBelongsToTeacher(assignment, refKeys));
}

/** Identifiant utilisateur enseignant porté par une affectation L1. */
export function l1TeacherUserIdOf(assignment: TeacherAssignment | Row | null | undefined): string {
  if (!assignment || typeof assignment !== "object") return "";
  const row = assignment as Row;
  return String(row.teacherUserId ?? row.teacher_user_id ?? "").trim();
}

/**
 * Consommation L1 enseignant : fail-closed sur `teacherUserId === session.user.id`.
 * Absence, null ou mismatch ⇒ aucune affectation, même si `teacherCode` / `teacherId` collent.
 * Ne pas utiliser pour le matching en ligne KILOMBO (`teacherCode`).
 */
export function l1AssignmentBelongsToTeacherSession(
  assignment: TeacherAssignment | Row | null | undefined,
  session: { user?: { id?: unknown } | null } | null,
): boolean {
  const userId = String(session?.user?.id ?? "").trim();
  const teacherUserId = l1TeacherUserIdOf(assignment);
  return Boolean(userId && teacherUserId && teacherUserId === userId);
}

export function filterL1AssignmentsForTeacherSession(
  assignments: TeacherAssignment[],
  session: { role?: string; user?: { id?: unknown; role?: string } } | null,
): TeacherAssignment[] {
  if (!isTeacherSession(session)) return [...assignments];
  return assignments.filter((assignment) => l1AssignmentBelongsToTeacherSession(assignment, session));
}

/**
 * Affectations L1 d'une session enseignant. Fail-closed sur teacherUserId.
 * Les non-enseignants reçoivent les affectations actives sans filtre utilisateur.
 */
export function listL1TeacherAssignments(
  session: { role?: string; user?: { id?: unknown; role?: string } } | null,
  assignmentsOrState: TeacherAssignment[] | TeacherScopeState = {},
): TeacherAssignment[] {
  const state = asTeacherScopeState(assignmentsOrState);
  const active = (state.assignments ?? []).filter((row) => isCanonicalActiveAssignment(row));
  return filterL1AssignmentsForTeacherSession(active, session);
}

/**
 * Noms de classes affectées à l'enseignant (clés normalisées).
 * Retourne `null` si l'utilisateur n'est pas enseignant.
 * Un enseignant sans affectation canonique active reçoit un Set vide (fail-closed).
 */
export function teacherScopedClassNames(
  session: { role?: string; user?: Row } | null,
  state: TeacherScopeState = {},
): Set<string> | null {
  if (!isTeacherSession(session)) return null;

  const names = new Set<string>();
  const addName = (value: unknown) => {
    const name = normalize(value);
    if (name) names.add(name);
  };
  const catalog = state.classes ?? [];

  for (const assignment of listCanonicalTeacherAssignments(session, state)) {
    addName(assignment.className);
    const classId = String(assignment.classId ?? "").trim();
    const classCode = String(assignment.classCode ?? "").trim();
    if (!classId && !classCode) continue;
    const match = catalog.find((schoolClass) => {
      const row = schoolClass as Row;
      if (classId && (String(row.id ?? "") === classId || String(row.publicId ?? "") === classId)) return true;
      if (classCode && (String(row.classCode ?? "") === classCode || String(row.publicId ?? "") === classCode)) {
        return true;
      }
      return false;
    });
    if (match) addName(match.name);
  }

  return names;
}

/**
 * Libellés affichables des classes enseignant.
 * Une classe attribuée sans élève reste listée et compte dans le KPI.
 */
export function teacherScopedClassLabels(
  session: { role?: string; user?: Row } | null,
  students: Student[],
  state: TeacherScopeState = {},
): string[] {
  const scopedKeys = teacherScopedClassNames(session, state);
  if (!scopedKeys) {
    return [...new Set(students.map((student) => String(student.className ?? "").trim()).filter(Boolean))].sort(
      (left, right) => left.localeCompare(right, "fr"),
    );
  }

  const labels = new Map<string, string>();
  for (const schoolClass of state.classes ?? []) {
    const label = String(schoolClass.name ?? "").trim();
    const key = normalize(label);
    if (key && scopedKeys.has(key)) labels.set(key, label);
  }
  students.forEach((student) => {
    const label = String(student.className ?? "").trim();
    const key = normalize(label);
    if (key && scopedKeys.has(key) && !labels.has(key)) {
      labels.set(key, label);
    }
  });
  for (const assignment of listCanonicalTeacherAssignments(session, state)) {
    const label = String(assignment.className ?? "").trim();
    const key = normalize(label);
    if (key && scopedKeys.has(key) && !labels.has(key)) labels.set(key, label);
  }
  scopedKeys.forEach((key) => {
    if (!labels.has(key)) labels.set(key, key);
  });

  return [...labels.values()].sort((left, right) => left.localeCompare(right, "fr"));
}

export function scopedStudentsForSession(
  session: { role?: string; user?: Row; school?: { id?: string; code?: string } } | null,
  students: Student[],
  state: TeacherScopeState = {},
): Student[] {
  let rows = projectScopedStudentsForSession(session, students).students;

  const teacherClasses = teacherScopedClassNames(session, state);
  if (teacherClasses) {
    if (!teacherClasses.size) return [];
    rows = rows.filter((student) => teacherClasses.has(normalize(student.className)));
  }
  return rows;
}

/**
 * Affectations enseignant pour la session : uniquement GET /assignments, actives.
 * `assignmentsOrState` accepte encore un tableau (compat) ou un TeacherScopeState
 * (recommandé, pour résoudre teacherId via la fiche enseignant).
 */
export function resolveTeacherAssignmentsForSession(
  session: { role?: string; user?: Row } | null,
  assignmentsOrState: TeacherAssignment[] | TeacherScopeState = [],
): TeacherAssignment[] {
  const seen = new Set<string>();
  return listCanonicalTeacherAssignments(session, assignmentsOrState).filter((assignment) => {
    const key = assignment.id
      ? `id:${assignment.id}`
      : `${normalize(assignment.className)}|${normalize(assignment.course ?? assignment.subject)}`;
    if (!assignment.className || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Affectations d'une fiche enseignant donnée (pas la session) : fusionne les
 * affectations embarquées sur la fiche et la table globale des affectations
 * (module Affectations), en faisant correspondre par id, publicId, userId ou nom.
 * Aligne l'affichage mobile sur le web (où les matières viennent des Affectations).
 */
export function resolveTeacherAssignmentsForRecord(
  teacher: Teacher | undefined,
  assignments: TeacherAssignment[] = [],
): TeacherAssignment[] {
  const row = (teacher ?? {}) as Row;
  const fromRecord = Array.isArray(row.assignments) ? (row.assignments as TeacherAssignment[]) : [];

  const refKeys = new Set<string>();
  [row.id, row.publicId, row.userId, row.identifier].forEach((value) => {
    const key = String(value ?? "").trim();
    if (key) refKeys.add(key);
  });

  const nameKeys = new Set<string>();
  const addName = (value: unknown) => {
    const key = normalize(value);
    if (key) nameKeys.add(key);
  };
  [row.name, row.firstName, row.lastName].forEach(addName);
  const first = normalize(row.firstName);
  const last = normalize(row.lastName ?? row.name);
  if (first && last) {
    nameKeys.add(`${first} ${last}`.trim());
    nameKeys.add(`${last} ${first}`.trim());
  }

  const fromGlobal = assignments.filter((assignment) => {
    const ref = String((assignment as Row).teacherId ?? "").trim();
    if (ref && refKeys.has(ref)) return true;
    return nameKeys.size > 0 && nameKeys.has(normalize((assignment as Row).teacherName));
  });

  const seen = new Set<string>();
  return [...fromRecord, ...fromGlobal].filter((assignment) => {
    const key = `${normalize(assignment.className)}|${normalize(assignment.course)}`;
    if (!assignment.className || !assignment.course || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Matières distinctes d'un enseignant (fiche + Affectations globales). */
export function resolveTeacherCoursesForRecord(
  teacher: Teacher | undefined,
  assignments: TeacherAssignment[] = [],
): string[] {
  return [
    ...new Set(
      resolveTeacherAssignmentsForRecord(teacher, assignments)
        .map((assignment) => String(assignment.course ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

/** Classes distinctes d'un enseignant (fiche + Affectations globales). */
export function resolveTeacherClassesForRecord(
  teacher: Teacher | undefined,
  assignments: TeacherAssignment[] = [],
): string[] {
  return [
    ...new Set(
      resolveTeacherAssignmentsForRecord(teacher, assignments)
        .map((assignment) => String(assignment.className ?? "").trim())
        .filter(Boolean),
    ),
  ];
}

export function filterStudentsByClassName(students: Student[], className: string): Student[] {
  return students.filter((student) => classNameMatches(student.className, className));
}

function classSchoolCodeOf(item: SchoolClass | Row): string {
  return String((item as Row).schoolCode ?? "").trim();
}

/**
 * Isolation établissement : un `schoolCode` différent ne passe jamais.
 * Fallback legacy : uniquement une classe réellement sans `schoolCode`.
 * Si `legacyNames` est fourni, cette classe sans code n'est gardée que si
 * un élève local porte déjà ce nom.
 */
function classCompatibleWithSessionSchool(
  item: SchoolClass,
  schoolCode: string,
  opts?: { legacyNames?: Set<string> },
): boolean {
  const expected = normalize(schoolCode);
  if (!expected || expected === "*") return true;
  const rowSchool = classSchoolCodeOf(item);
  if (rowSchool) return normalize(rowSchool) === expected;
  if (!opts?.legacyNames) return true;
  const nameKey = normalize(item.name);
  return Boolean(nameKey) && opts.legacyNames.has(nameKey);
}

/** Classes visibles selon établissement et périmètre enseignant (aligné web `scopedClasses`). */
export function scopedClassesForSession(
  session: { role?: string; user?: Row; school?: { code?: string } } | null,
  classes: SchoolClass[],
  students: Student[],
  state: TeacherScopeState = {},
): SchoolClass[] {
  const schoolCode = String(session?.user?.schoolCode ?? session?.school?.code ?? "").trim();
  const scopedStudentsList = scopedStudentsForSession(session, students, state);
  const localClassNameKeys = new Set(
    scopedStudentsList.map((student) => normalize(student.className)).filter(Boolean),
  );
  const classNames = new Set(
    scopedStudentsList.map((student) => String(student.className ?? "").trim()).filter(Boolean),
  );

  const base =
    !schoolCode || schoolCode === "*"
      ? classes
      : classes.filter((item) =>
          classCompatibleWithSessionSchool(item, schoolCode, { legacyNames: localClassNameKeys }),
        );

  const rows = [...base];
  classNames.forEach((className) => {
    if (!rows.some((item) => classNameMatches(item.name, className))) {
      rows.push({
        id: `CLASS-${className}`,
        publicId: `CLASS-${className}`,
        name: className,
        level: "",
        track: "",
        teacherId: "",
      });
    }
  });

  const teacherClassNames = teacherScopedClassNames(session, state);
  if (!teacherClassNames) return rows;
  if (!teacherClassNames.size) return [];

  const ensureAssignedClass = (className: string, catalogRow?: SchoolClass) => {
    if (!className) return;
    if (rows.some((item) => classNameMatches(item.name, className))) return;
    if (catalogRow) {
      if (!classCompatibleWithSessionSchool(catalogRow, schoolCode)) return;
      rows.push(catalogRow);
      return;
    }
    rows.push({
      id: `CLASS-${className}`,
      publicId: `CLASS-${className}`,
      name: className,
      level: "",
      track: "",
      teacherId: "",
    });
  };

  for (const schoolClass of classes) {
    if (!teacherClassNames.has(normalize(schoolClass.name))) continue;
    if (!classCompatibleWithSessionSchool(schoolClass, schoolCode)) continue;
    ensureAssignedClass(String(schoolClass.name ?? "").trim(), schoolClass);
  }
  for (const assignment of listCanonicalTeacherAssignments(session, state)) {
    ensureAssignedClass(String(assignment.className ?? "").trim());
  }

  return rows.filter((item) => teacherClassNames.has(normalize(item.name)));
}

/** Identifiant API stable (aligné enregistrement présences / notes backend). */
export function resolveStudentApiId(student: Pick<Student, "id" | "matricule" | "publicId">): string {
  return String(student.matricule ?? student.publicId ?? student.id ?? "").trim();
}

/** Période par défaut : privilégie une période qui contient déjà des notes. */
export function resolveGradesPeriod(
  notes: { period?: string; schoolCode?: string }[],
  schoolCode: string,
  fallbackPeriod: string,
): string {
  const normalizedSchool = normalize(schoolCode);
  const scopedNotes = notes.filter((note) => {
    if (!normalizedSchool) return true;
    const noteSchool = normalize(String(note.schoolCode ?? ""));
    return !noteSchool || noteSchool === normalizedSchool;
  });

  const periodCounts = new Map<string, number>();
  for (const note of scopedNotes) {
    const periodName = String(note.period ?? "").trim();
    if (!periodName) continue;
    periodCounts.set(periodName, (periodCounts.get(periodName) ?? 0) + 1);
  }

  if (periodCounts.size) {
    return [...periodCounts.entries()].sort((left, right) => right[1] - left[1])[0][0];
  }
  return fallbackPeriod;
}