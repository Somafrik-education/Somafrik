/**
 * Synchronisation compte utilisateur (rôle Enseignant) → fiche teachers[].
 *
 * FIX V2.1 IDENTITY — CONTRAT-FIX-V2.1-IDENTITY.md
 * - Canon pédagogique : TEACHERS-*
 * - Historique TEACHER-* seul : pas de création auto TEACHERS-* (AC-HIST-02)
 * - Ambiguïté multi-TEACHERS-* : erreur structurée (pas de created_at)
 */

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isTeachersCode(id) {
  return /^TEACHERS-/i.test(String(id ?? "").trim());
}

function isTeacherTwinCode(id) {
  const s = String(id ?? "").trim();
  return /^TEACHER-/i.test(s) && !/^TEACHERS-/i.test(s);
}

function sameSchool(teacherSchool, schoolCode) {
  return normalize(teacherSchool) === normalize(schoolCode);
}

function isTeacherUserRole(role) {
  const key = normalize(role);
  return key === "enseignant" || key.includes("prof");
}

function syncError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function teacherMatchesUser(teacher, user) {
  if (user.id && String(teacher.userId ?? "") === String(user.id)) {
    return true;
  }
  const userIdentifier = normalize(user.identifier);
  const teacherIdentifier = normalize(teacher.identifier);
  if (!userIdentifier || userIdentifier !== teacherIdentifier) {
    return false;
  }
  const linkedUserId = String(teacher.userId ?? "");
  return !linkedUserId || linkedUserId === String(user.id ?? "");
}

function teachersLinkedByUserId(teachers, user, schoolCode) {
  const userId = String(user?.id ?? "").trim();
  if (!userId) return [];
  return (teachers ?? []).filter(
    (teacher) =>
      String(teacher.userId ?? "").trim() === userId &&
      sameSchool(teacher.schoolCode, schoolCode),
  );
}

function teachersCodeLinked(teachers, user, schoolCode) {
  return teachersLinkedByUserId(teachers, user, schoolCode).filter((teacher) =>
    isTeachersCode(teacher.id),
  );
}

function twinOnlyLinked(teachers, user, schoolCode) {
  const linked = teachersLinkedByUserId(teachers, user, schoolCode);
  if (!linked.length) return false;
  const hasTeachers = linked.some((teacher) => isTeachersCode(teacher.id));
  const hasTwin = linked.some((teacher) => isTeacherTwinCode(teacher.id));
  return hasTwin && !hasTeachers;
}

/**
 * §4.1 — sélection déterministe du canon TEACHERS-*.
 * @returns {object|null} fiche canon ou null si aucune
 * @throws TEACHER_CANON_AMBIGUOUS
 */
function resolveCanonicalTeachersRow(teachers, user, schoolCode, assignments = []) {
  const linked = teachersCodeLinked(teachers, user, schoolCode);
  // Même id répété dans le tableau ≠ pluralité d'identités
  const byId = new Map();
  for (const teacher of linked) {
    const id = String(teacher.id ?? "").trim();
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, teacher);
  }
  const candidates = [...byId.values()];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const activeTeacherIds = new Set(
    (assignments ?? [])
      .filter((assignment) => {
        if (!sameSchool(assignment.schoolCode, schoolCode)) return false;
        const status = normalize(assignment.status ?? "active");
        return status === "" || status === "active" || status === "actif";
      })
      .map((assignment) => String(assignment.teacherId ?? "").trim())
      .filter(Boolean),
  );

  const viaAssignment = candidates.filter((teacher) =>
    activeTeacherIds.has(String(teacher.id ?? "").trim()),
  );
  if (viaAssignment.length === 1) return viaAssignment[0];

  throw syncError(
    "TEACHER_CANON_AMBIGUOUS",
    "Plusieurs identités pédagogiques TEACHERS-* pour ce compte ; impossible de choisir un canon sans ambiguïté",
  );
}

function nextTeacherLoginId(schoolCode, teachers) {
  const normalizedSchool = String(schoolCode ?? "").trim().toUpperCase();
  let max = 0;
  for (const teacher of teachers) {
    if (
      normalizedSchool &&
      teacher.schoolCode &&
      normalize(teacher.schoolCode) !== normalize(normalizedSchool)
    ) {
      continue;
    }
    for (const candidate of [teacher.publicId, teacher.identifier, teacher.id]) {
      const match = String(candidate ?? "").match(/ENS-(\d+)$/i);
      if (match?.[1]) {
        max = Math.max(max, Number(match[1]));
      }
    }
  }
  const sequence = max + 1;
  const identifier = `ENS-${String(sequence).padStart(4, "0")}`;
  return {
    identifier,
    publicId: normalizedSchool ? `${normalizedSchool}-${identifier}` : identifier,
  };
}

function newTeachersId() {
  return `TEACHERS-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildTeacherFromUser(user, existing, { forceNewTeachersId = false } = {}) {
  const schoolCode = String(user.schoolCode ?? "").trim();
  const ids = existing?.identifier
    ? { identifier: existing.identifier, publicId: existing.publicId }
    : nextTeacherLoginId(schoolCode, []);

  const resolvedIdentifier = String(user.identifier ?? ids.identifier);
  const resolvedPublicId = String(user.publicId ?? ids.publicId);
  const contactId = String(user.contactId ?? existing?.contactId ?? "").trim();

  let id;
  if (existing?.id && !forceNewTeachersId) {
    id = String(existing.id);
  } else {
    id = newTeachersId();
  }

  return {
    ...(existing ?? {}),
    id,
    userId: user.id,
    contactId: contactId || undefined,
    publicId: resolvedPublicId,
    identifier: resolvedIdentifier,
    schoolCode,
    name: String(user.lastName ?? existing?.name ?? "Enseignant").trim(),
    firstName: String(user.firstName ?? existing?.firstName ?? "").trim(),
    gender: user.gender ?? existing?.gender ?? "Non renseigné",
    phone: user.phone ?? existing?.phone ?? "",
    email: user.email ?? existing?.email ?? "",
    birthDate: user.birthDate ?? existing?.birthDate ?? "",
    status: user.status === "Suspendu" ? "Suspendu" : "Actif",
    password: user.temporaryPassword ?? user.password ?? existing?.password ?? "",
    assignments: Array.isArray(existing?.assignments) ? existing.assignments : [],
    assignedClasses: Array.isArray(existing?.assignedClasses) ? existing.assignedClasses : [],
  };
}

function linkTeacherToContact(contacts = [], user, teacher) {
  const contactId = String(user?.contactId ?? teacher?.contactId ?? "").trim();
  const teacherId = String(teacher?.id ?? "").trim();
  if (!contactId || !teacherId) return contacts;

  return contacts.map((contact) => {
    if (String(contact.id ?? "") !== contactId) return contact;
    return {
      ...contact,
      teacherId,
      userId: user?.id ?? contact.userId,
    };
  });
}

function replaceTeacher(teachers, previousId, row) {
  const next = [...teachers];
  const index = next.findIndex((teacher) => String(teacher.id) === String(previousId));
  if (index >= 0) {
    next[index] = row;
    return next;
  }
  return [row, ...next];
}

class UserTeacherSyncService {
  /**
   * @param {object[]} teachers
   * @param {object} user
   * @param {{ assignments?: object[] }} [options]
   */
  upsertTeacherFromUser(teachers = [], user, options = {}) {
    if (!isTeacherUserRole(user?.role)) {
      return teachers;
    }
    const schoolCode = String(user.schoolCode ?? "").trim();
    if (!schoolCode || schoolCode === "*") {
      return teachers;
    }

    const assignments = options.assignments ?? [];
    const canon = resolveCanonicalTeachersRow(teachers, user, schoolCode, assignments);

    // Canon TEACHERS-* déterminé → réutiliser uniquement
    if (canon) {
      const row = buildTeacherFromUser(user, canon);
      return replaceTeacher(teachers, canon.id, row);
    }

    // AC-HIST-02 : historique TEACHER-* seul → ne pas créer TEACHERS-*
    if (twinOnlyLinked(teachers, user, schoolCode)) {
      const twins = teachersLinkedByUserId(teachers, user, schoolCode).filter((teacher) =>
        isTeacherTwinCode(teacher.id),
      );
      // Mettre à jour le premier twin matché pour préserver le comportement historique
      // (pas de nouvelle identité). Ordre non utilisé pour choisir un canon TEACHERS-*.
      const existingTwin =
        twins.find((teacher) => teacherMatchesUser(teacher, user)) ?? twins[0];
      if (existingTwin) {
        const row = buildTeacherFromUser(user, existingTwin);
        return replaceTeacher(teachers, existingTwin.id, row);
      }
      return teachers;
    }

    // Compte nouveau : aucune fiche liée → créer un seul TEACHERS-*
    const linked = teachersLinkedByUserId(teachers, user, schoolCode);
    if (linked.length === 0) {
      const row = buildTeacherFromUser(user, undefined, { forceNewTeachersId: true });
      if (!isTeachersCode(row.id)) {
        throw syncError("TEACHER_CANON_REQUIRED", "Nouvelle fiche enseignant doit être TEACHERS-*");
      }
      return [row, ...teachers];
    }

    // Fiches liées non TEACHERS-* non twin-only (cas résiduel) : ne pas créer de jumeau
    const match = linked.find((teacher) => teacherMatchesUser(teacher, user)) ?? linked[0];
    const row = buildTeacherFromUser(user, match);
    return replaceTeacher(teachers, match.id, row);
  }

  syncTeachersFromUserAccounts(state = {}) {
    let teachers = Array.isArray(state.teachers) ? [...state.teachers] : [];
    let contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
    const users = Array.isArray(state.users) ? state.users : [];
    const assignments = Array.isArray(state.assignments) ? state.assignments : [];
    for (const user of users) {
      if (!isTeacherUserRole(user.role)) continue;
      try {
        teachers = this.upsertTeacherFromUser(teachers, user, { assignments });
      } catch (error) {
        // Historique multi-TEACHERS-* : ne pas choisir silencieusement, ne pas
        // bloquer un PUT bulk non lié (les écritures qui exigent un canon
        // appellent resolveCanonicalTeachersRow et reçoivent l'erreur).
        if (error?.code === "TEACHER_CANON_AMBIGUOUS") {
          continue;
        }
        throw error;
      }
      let index = -1;
      try {
        const canon = resolveCanonicalTeachersRow(teachers, user, user.schoolCode, assignments);
        if (canon) {
          index = teachers.findIndex((teacher) => String(teacher.id) === String(canon.id));
        }
      } catch {
        index = -1;
      }
      if (index < 0) {
        index = teachers.findIndex((teacher) => teacherMatchesUser(teacher, user));
      }
      if (index < 0) continue;
      const teacher = teachers[index];
      const contactId = String(user.contactId ?? teacher.contactId ?? "").trim();
      if (contactId) {
        teachers[index] = { ...teacher, contactId };
        contacts = linkTeacherToContact(contacts, user, teachers[index]);
      }
    }
    return { teachers, contacts };
  }
}

module.exports = {
  UserTeacherSyncService,
  isTeacherUserRole,
  isTeachersCode,
  isTeacherTwinCode,
  resolveCanonicalTeachersRow,
  twinOnlyLinked,
  syncError,
};
