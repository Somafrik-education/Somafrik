import type { BackOfficeState, School, SessionUser, UserAccount } from "../types";
import { isActiveUserAccount, normalize } from "./format";
import { dedupeClassesByName } from "./classRules";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "./orgHierarchy";
import { scopedSchools } from "./scope";

type Row = Record<string, unknown>;

function scopedByCountrySchools(user: SessionUser | null, state: BackOfficeState, rows: Row[]): Row[] {
  if (!user || user.role !== COUNTRY_ADMIN_ROLE) return rows;
  if (user.schoolCode && user.schoolCode !== "*") {
    return rows.filter((row) => normalize(row.schoolCode) === normalize(user.schoolCode));
  }
  const schoolCodes = new Set(scopedSchools(user, state).map((school) => normalize(school.code)));
  return rows.filter((row) => {
    const code = normalize(String(row.schoolCode ?? ""));
    return !code || schoolCodes.has(code);
  });
}

export function getCurrentSchool(user: SessionUser | null, state: BackOfficeState): School | null {
  if (!user) return state.schools[0] ?? null;
  const scoped = scopedSchools(user, state);
  if (scoped.length) return scoped[0];
  if (!user.schoolCode || user.schoolCode === "*") {
    return state.schools[0] ?? null;
  }
  return state.schools.find((school) => normalize(school.code) === normalize(user.schoolCode)) ?? null;
}

import { isTeacherUserRole } from "./userTeacherSync";

/** Rôle enseignant : ne voit que ses classes/élèves affectés dans « Mon établissement ». */
function isTeacherRole(role?: string): boolean {
  return isTeacherUserRole(role);
}

/** Retrouve la fiche enseignant liée au compte connecté (par userId puis identifiant). */
export function resolveTeacherRecordForUser(user: SessionUser | null, state: BackOfficeState): Row | null {
  if (!user) return null;
  const userId = String(user.id ?? "").trim();
  const identifier = normalize(user.identifier);
  const teachers = (state.teachers ?? []) as Row[];
  return (
    teachers.find((teacher) => {
      if (userId && String(teacher.userId ?? "") === userId) return true;
      if (identifier && normalize(teacher.identifier) === identifier) return true;
      return false;
    }) ?? null
  );
}

/**
 * Ensemble des noms de classes affectées à l'enseignant connecté (normalisés).
 * Retourne `null` si l'utilisateur n'est pas un enseignant OU si aucune classe
 * ne peut lui être rattachée : dans ce dernier cas on n'applique pas de
 * restriction (on retombe sur la portée établissement) pour ne pas verrouiller
 * un enseignant non encore affecté hors de ses écrans (appel, etc.).
 */
export function teacherScopedClassNames(
  user: SessionUser | null,
  state: BackOfficeState,
): Set<string> | null {
  if (!isTeacherRole(user?.role)) return null;
  const names = new Set<string>();
  const teacher = resolveTeacherRecordForUser(user, state);

  // Clés d'identité (id interne, publicId, identifiant) côté compte ET fiche.
  // Les affectations peuvent référencer teacherId sous forme d'UUID ou de publicId.
  const idKeys = new Set<string>();
  [
    teacher?.id,
    teacher?.publicId,
    teacher?.identifier,
    user?.id,
    user?.identifier,
    user?.publicId,
  ]
    .map((value) => normalize(value))
    .filter(Boolean)
    .forEach((value) => idKeys.add(value));

  const nameKeys = new Set<string>();
  [teacher?.name, teacher?.firstName, teacher?.lastName, user?.firstName, user?.lastName]
    .map((value) => normalize(value))
    .filter(Boolean)
    .forEach((value) => nameKeys.add(value));
  const first = normalize(teacher?.firstName ?? user?.firstName);
  const last = normalize(teacher?.name ?? teacher?.lastName ?? user?.lastName);
  if (first && last) {
    nameKeys.add(`${first} ${last}`.trim());
    nameKeys.add(`${last} ${first}`.trim());
  }

  const addName = (value: unknown) => {
    const name = normalize(value);
    if (name) names.add(name);
  };

  if (teacher && Array.isArray(teacher.assignedClasses)) {
    (teacher.assignedClasses as unknown[]).forEach(addName);
  }
  if (teacher && Array.isArray(teacher.assignments)) {
    (teacher.assignments as Row[]).forEach((assignment) => addName(assignment.className));
  }

  ((state.classes ?? []) as Row[]).forEach((cls) => {
    if (idKeys.has(normalize(cls.teacherId))) addName(cls.name ?? cls.className);
  });

  ((state.assignments ?? []) as Row[]).forEach((assignment) => {
    const matchesId = idKeys.has(normalize(assignment.teacherId));
    const matchesName = nameKeys.has(normalize(assignment.teacherName));
    if (matchesId || matchesName) addName(assignment.className);
  });

  return names.size ? names : null;
}

/**
 * Libellés affichables des classes affectées à l'enseignant (casse / accents préservés).
 * Les clés internes de teacherScopedClassNames sont normalisées — ne pas les utiliser en UI.
 */
export function listTeacherScopedClassLabels(
  user: SessionUser | null,
  state: BackOfficeState,
  students: Row[] = [],
  classes: Row[] = [],
): string[] | null {
  const teacherClasses = teacherScopedClassNames(user, state);
  if (!teacherClasses?.size) return null;

  const labels = new Map<string, string>();
  const addLabel = (value: unknown) => {
    const label = String(value ?? "").trim();
    const key = normalize(label);
    if (key && teacherClasses.has(key)) {
      labels.set(key, label);
    }
  };

  students.forEach((student) => addLabel(student.className));
  classes.forEach((row) => addLabel(row.name ?? row.className));
  ((state.assignments ?? []) as Row[]).forEach((assignment) => addLabel(assignment.className));
  ((state.classes ?? []) as Row[]).forEach((row) => addLabel(row.name ?? row.className));

  teacherClasses.forEach((key) => {
    if (labels.has(key)) return;
    const fromClasses = ((state.classes ?? []) as Row[]).find(
      (row) => normalize(row.name ?? row.className) === key,
    );
    if (fromClasses) {
      addLabel(fromClasses.name ?? fromClasses.className);
    }
  });

  return [...labels.values()].sort((left, right) => left.localeCompare(right, "fr"));
}

export function scopedStudents(user: SessionUser | null, state: BackOfficeState): Row[] {
  const schoolCode = user?.schoolCode;
  const rows = (state.students ?? []) as Row[];
  const bySchool =
    !schoolCode || schoolCode === "*"
      ? rows
      : rows.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
  const teacherClassNames = teacherScopedClassNames(user, state);
  if (teacherClassNames) {
    return bySchool.filter((row) => teacherClassNames.has(normalize(row.className)));
  }
  return bySchool;
}

/** Contacts CRM rattachés au compte (schoolCode). Portée plateforme si aucun code. */
export function scopedContacts(user: SessionUser | null, state: BackOfficeState): Row[] {
  const schoolCode = user?.schoolCode;
  const rows = (state.contacts ?? []) as unknown as Row[];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}

/** Relations CRM rattachées au compte (schoolCode). Portée plateforme si aucun code. */
export function scopedRelations(user: SessionUser | null, state: BackOfficeState): Row[] {
  const schoolCode = user?.schoolCode;
  const rows = (state.relations ?? []) as unknown as Row[];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}

export function scopedTeachers(user: SessionUser | null, state: BackOfficeState, students?: Row[]): Row[] {
  const schoolCode = user?.schoolCode;
  const scopedStudentsList = students ?? scopedStudents(user, state);
  const classNames = new Set(scopedStudentsList.map((s) => String(s.className ?? "")).filter(Boolean));
  const rows = (state.teachers ?? []) as Row[];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter(
    (teacher) =>
      normalize(teacher.schoolCode) === normalize(schoolCode) ||
      (Array.isArray(teacher.assignedClasses) &&
        (teacher.assignedClasses as string[]).some((name) => classNames.has(name))) ||
      (Array.isArray(teacher.assignments) &&
        (teacher.assignments as Row[]).some((a) => classNames.has(String(a.className ?? "")))),
  );
}

export function scopedClasses(user: SessionUser | null, state: BackOfficeState, students?: Row[]): Row[] {
  const schoolCode = user?.schoolCode;
  const scopedStudentsList = students ?? scopedStudents(user, state);
  const classNames = new Set(scopedStudentsList.map((s) => String(s.className ?? "")).filter(Boolean));
  const base =
    !schoolCode || schoolCode === "*"
      ? ((state.classes ?? []) as Row[])
      : ((state.classes ?? []) as Row[]).filter(
          (item) =>
            normalize(item.schoolCode) === normalize(schoolCode) || classNames.has(String(item.name ?? "")),
        );

  const rows = [...base];
  classNames.forEach((className) => {
    if (!rows.some((item) => normalize(String(item.name ?? "")) === normalize(className))) {
      rows.push({ id: `CLASS-${className}`, name: className, schoolCode });
    }
  });
  const deduped = dedupeClassesByName(rows);
  const teacherClassNames = teacherScopedClassNames(user, state);
  if (teacherClassNames) {
    return deduped.filter((item) => teacherClassNames.has(normalize(item.name ?? item.className)));
  }
  return deduped;
}

function scopedByStudentIds(user: SessionUser | null, state: BackOfficeState, key: keyof BackOfficeState): Row[] {
  const schoolCode = user?.schoolCode;
  const students = scopedStudents(user, state);
  const studentIds = new Set(students.map((s) => String(s.id ?? "")).filter(Boolean));
  const rows = (state[key] ?? []) as Row[];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter(
    (row) =>
      normalize(row.schoolCode) === normalize(schoolCode) ||
      (row.studentId && studentIds.has(String(row.studentId))),
  );
}

export function scopedPayments(user: SessionUser | null, state: BackOfficeState): Row[] {
  return scopedByStudentIds(user, state, "payments");
}

export function scopedPresences(user: SessionUser | null, state: BackOfficeState): Row[] {
  return scopedByStudentIds(user, state, "presences");
}

export function scopedNotes(user: SessionUser | null, state: BackOfficeState): Row[] {
  return scopedByStudentIds(user, state, "notes");
}

/** Diffusion système (Super Admin) : marquée explicitement, visible par tous les établissements. */
function isSystemBroadcast(row: Row): boolean {
  return row.systemBroadcast === true || normalize(row.scope) === "system";
}

export function scopedMessages(user: SessionUser | null, state: BackOfficeState): Row[] {
  const schoolCode = user?.schoolCode;
  const students = scopedStudents(user, state);
  const studentIds = new Set(students.map((s) => String(s.id ?? "")).filter(Boolean));
  const rows = (state.messages ?? []) as Row[];
  if (!schoolCode || schoolCode === "*") {
    if (isSuperAdminRole(user?.role)) return rows;
    return scopedByCountrySchools(user, state, rows);
  }
  return rows.filter(
    (row) =>
      normalize(row.schoolCode) === normalize(schoolCode) ||
      (row.studentId && studentIds.has(String(row.studentId))) ||
      isSystemBroadcast(row),
  );
}

export function scopedExams(user: SessionUser | null, state: BackOfficeState): Row[] {
  const schoolCode = user?.schoolCode;
  const classNames = new Set(scopedStudents(user, state).map((s) => String(s.className ?? "")).filter(Boolean));
  const rows = (state.exams ?? []) as Row[];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter(
    (row) =>
      normalize(row.schoolCode) === normalize(schoolCode) || classNames.has(String(row.className ?? "")),
  );
}

export function scopedBulletins(user: SessionUser | null, state: BackOfficeState): Row[] {
  return scopedByStudentIds(user, state, "bulletins");
}

export function scopedDocuments(user: SessionUser | null, state: BackOfficeState): Row[] {
  return scopedByStudentIds(user, state, "documents");
}

export function scopedCourses(user: SessionUser | null, state: BackOfficeState): Row[] {
  const schoolCode = user?.schoolCode;
  const classNames = new Set(scopedStudents(user, state).map((s) => String(s.className ?? "")).filter(Boolean));
  const rows = (state.courses ?? []) as Row[];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter(
    (row) => normalize(row.schoolCode) === normalize(schoolCode) || classNames.has(String(row.className ?? "")),
  );
}

export function scopedAssignments(user: SessionUser | null, state: BackOfficeState): Row[] {
  const schoolCode = user?.schoolCode;
  const scopedStudentsList = scopedStudents(user, state);
  const classNames = new Set(scopedStudentsList.map((s) => String(s.className ?? "")).filter(Boolean));
  const teachers = scopedTeachers(user, state, scopedStudentsList);
  const teacherRefs = new Set<string>();
  for (const teacher of teachers) {
    for (const ref of [teacher.id, teacher.publicId, teacher.identifier, teacher.userId, teacher.contactId]) {
      const value = String(ref ?? "").trim();
      if (value) teacherRefs.add(value);
    }
  }
  const rows = (state.assignments ?? []) as Row[];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter(
    (row) =>
      normalize(row.schoolCode) === normalize(schoolCode) ||
      classNames.has(String(row.className ?? "")) ||
      teacherRefs.has(String(row.teacherId ?? "").trim()),
  );
}

export function scopedAnnouncements(user: SessionUser | null, state: BackOfficeState): Row[] {
  const schoolCode = user?.schoolCode;
  const rows = (state.announcements ?? []) as Row[];
  if (!schoolCode || schoolCode === "*") {
    if (isSuperAdminRole(user?.role)) return rows;
    return scopedByCountrySchools(user, state, rows);
  }
  return rows.filter(
    (row) => normalize(row.schoolCode) === normalize(schoolCode) || isSystemBroadcast(row),
  );
}

export function getEstablishmentMetrics(user: SessionUser | null, state: BackOfficeState, users: UserAccount[]) {
  const students = scopedStudents(user, state);
  const teachers = scopedTeachers(user, state, students);
  const classes = scopedClasses(user, state, students);
  const payments = scopedPayments(user, state);
  const presences = scopedPresences(user, state);
  const notes = scopedNotes(user, state);
  const messages = scopedMessages(user, state);
  const exams = scopedExams(user, state);
  const bulletins = scopedBulletins(user, state);
  const documents = scopedDocuments(user, state);
  const activeUsers = users.filter(isActiveUserAccount);
  const unreadMessages = messages.filter((m) => normalize(m.status) === "non lu").length;
  const pendingBulletins = bulletins.filter((b) => {
    const status = normalize(b.status);
    return status === "en validation" || status === "brouillon";
  }).length;

  return {
    activeUsers: activeUsers.length,
    students: students.length,
    teachers: teachers.length,
    classes: classes.length,
    payments: payments.length,
    presences: presences.length,
    notes: notes.length,
    exams: exams.length,
    bulletins: bulletins.length,
    documents: documents.length,
    pendingBulletins,
    unreadMessages,
  };
}
