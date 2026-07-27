/**
 * Synchronisation compte utilisateur (rôle Enseignant) → fiche teachers[].
 *
 * FIX V2.1 IDENTITY — CONTRAT-FIX-V2.1-IDENTITY.md
 * - Canon pédagogique : TEACHERS-*
 * - Historique TEACHER-* seul : pas de création auto TEACHERS-* (AC-HIST-02)
 * - Ambiguïté multi-TEACHERS-* : erreur structurée (pas de created_at)
 * - PUT bulk : §4.1.b — throw si écriture liée à l'enseignant ambigu, sinon no-op tracé
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

function uniqueByTeacherId(rows = []) {
  const byId = new Map();
  for (const teacher of rows) {
    const id = String(teacher.id ?? "").trim();
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, teacher);
  }
  return [...byId.values()];
}

/**
 * §4.1.b — une écriture « liée » à l'identité enseignant de ce user.
 * PUT totalement étranger → false (ambiguïté peut être ignorée sans mutation).
 */
function isIdentityRelatedWrite(user, options = {}) {
  const userId = String(user?.id ?? "").trim();
  if (!userId) return true;
  if (options.forceStrict === true) return true;
  if (options.identityRelatedUserIds instanceof Set) {
    return options.identityRelatedUserIds.has(userId);
  }

  const previousUsers = options.previousUsers ?? [];
  const previousTeachers = options.previousTeachers ?? [];
  const nextUsers = options.nextUsers ?? [];
  const nextTeachers = options.nextTeachers ?? [];
  const usersTouched = options.usersTouched === true;
  const teachersTouched = options.teachersTouched === true;

  // Sans contexte de diff : comportement strict (écriture identitaire).
  if (
    options.previousUsers == null &&
    options.previousTeachers == null &&
    options.identityRelatedUserIds == null &&
    options.forceStrict !== false
  ) {
    return true;
  }

  if (usersTouched) {
    const prev = previousUsers.find((row) => String(row.id ?? "").trim() === userId);
    const next = nextUsers.find((row) => String(row.id ?? "").trim() === userId);
    if (next && !prev) return true;
    if (prev && next) {
      const keys = ["role", "schoolCode", "identifier", "status", "firstName", "lastName", "contactId"];
      if (keys.some((key) => String(prev[key] ?? "") !== String(next[key] ?? ""))) {
        return true;
      }
    }
  }

  if (teachersTouched) {
    const prevIds = new Set(
      previousTeachers
        .filter((row) => String(row.userId ?? "").trim() === userId)
        .map((row) => String(row.id ?? "").trim())
        .filter(Boolean),
    );
    const nextIds = new Set(
      nextTeachers
        .filter((row) => String(row.userId ?? "").trim() === userId)
        .map((row) => String(row.id ?? "").trim())
        .filter(Boolean),
    );
    if (prevIds.size !== nextIds.size) return true;
    for (const id of nextIds) {
      if (!prevIds.has(id)) return true;
    }
    for (const id of nextIds) {
      const prev = previousTeachers.find((row) => String(row.id ?? "").trim() === id);
      const next = nextTeachers.find((row) => String(row.id ?? "").trim() === id);
      if (!prev || !next) continue;
      const keys = ["userId", "schoolCode", "identifier", "status", "name", "firstName", "contactId"];
      if (keys.some((key) => String(prev[key] ?? "") !== String(next[key] ?? ""))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * §4.1 — sélection déterministe du canon TEACHERS-*.
 * @returns {object|null} fiche canon ou null si aucune
 * @throws TEACHER_CANON_AMBIGUOUS
 */
function resolveCanonicalTeachersRow(teachers, user, schoolCode, assignments = []) {
  const candidates = uniqueByTeacherId(teachersCodeLinked(teachers, user, schoolCode));
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

function recordSkip(skips, entry) {
  if (Array.isArray(skips)) skips.push(entry);
}

class UserTeacherSyncService {
  /**
   * @param {object[]} teachers
   * @param {object} user
   * @param {{ assignments?: object[], skips?: object[] }} [options]
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
    const skips = options.skips;
    const canon = resolveCanonicalTeachersRow(teachers, user, schoolCode, assignments);

    // Canon TEACHERS-* déterminé → réutiliser uniquement
    if (canon) {
      const row = buildTeacherFromUser(user, canon);
      return replaceTeacher(teachers, canon.id, row);
    }

    // AC-HIST-02 : historique TEACHER-* seul → ne pas créer TEACHERS-*
    if (twinOnlyLinked(teachers, user, schoolCode)) {
      const twins = uniqueByTeacherId(
        teachersLinkedByUserId(teachers, user, schoolCode).filter((teacher) =>
          isTeacherTwinCode(teacher.id),
        ),
      );
      if (twins.length === 1) {
        const existingTwin = twins[0];
        const row = buildTeacherFromUser(user, existingTwin);
        return replaceTeacher(teachers, existingTwin.id, row);
      }
      // Plusieurs TEACHER-* : aucune mutation automatique, pas de twins[0]
      recordSkip(skips, {
        code: "TEACHER_HISTORICAL_MULTI_TWIN",
        userId: String(user.id ?? ""),
        schoolCode,
        twinIds: twins.map((teacher) => String(teacher.id)),
        action: "noop",
      });
      return teachers;
    }

    // Compte nouveau : aucune fiche liée → créer un seul TEACHERS-*
    const linked = uniqueByTeacherId(teachersLinkedByUserId(teachers, user, schoolCode));
    if (linked.length === 0) {
      const row = buildTeacherFromUser(user, undefined, { forceNewTeachersId: true });
      if (!isTeachersCode(row.id)) {
        throw syncError("TEACHER_CANON_REQUIRED", "Nouvelle fiche enseignant doit être TEACHERS-*");
      }
      return [row, ...teachers];
    }

    // Une seule fiche liée résiduelle → mise à jour conservatrice (pas d'ordre)
    if (linked.length === 1) {
      const row = buildTeacherFromUser(user, linked[0]);
      return replaceTeacher(teachers, linked[0].id, row);
    }

    // Plusieurs fiches liées non départageables → no-op tracé (pas de choix silencieux)
    recordSkip(skips, {
      code: "TEACHER_LINK_AMBIGUOUS",
      userId: String(user.id ?? ""),
      schoolCode,
      teacherIds: linked.map((teacher) => String(teacher.id)),
      action: "noop",
    });
    return teachers;
  }

  /**
   * @param {object} state
   * @param {{
   *   previousUsers?: object[],
   *   previousTeachers?: object[],
   *   usersTouched?: boolean,
   *   teachersTouched?: boolean,
   *   identityRelatedUserIds?: Set<string>,
   *   forceStrict?: boolean,
   * }} [options]
   */
  syncTeachersFromUserAccounts(state = {}, options = {}) {
    let teachers = Array.isArray(state.teachers) ? [...state.teachers] : [];
    let contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
    const users = Array.isArray(state.users) ? state.users : [];
    const assignments = Array.isArray(state.assignments) ? state.assignments : [];
    const skips = [];
    const syncOptions = {
      ...options,
      nextUsers: users,
      nextTeachers: teachers,
    };

    for (const user of users) {
      if (!isTeacherUserRole(user.role)) continue;
      try {
        teachers = this.upsertTeacherFromUser(teachers, user, { assignments, skips });
      } catch (error) {
        if (error?.code === "TEACHER_CANON_AMBIGUOUS") {
          if (isIdentityRelatedWrite(user, syncOptions)) {
            // Écriture qui nécessite / modifie l'identité ambiguë → refus structuré
            throw error;
          }
          // PUT étranger : ne pas modifier les fiches de cet enseignant
          recordSkip(skips, {
            code: "TEACHER_CANON_AMBIGUOUS_SKIPPED_UNRELATED",
            userId: String(user.id ?? ""),
            schoolCode: String(user.schoolCode ?? ""),
            action: "noop",
          });
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
        const matches = teachers.filter((teacher) => teacherMatchesUser(teacher, user));
        if (matches.length === 1) {
          index = teachers.findIndex((teacher) => String(teacher.id) === String(matches[0].id));
        }
      }
      if (index < 0) continue;
      const teacher = teachers[index];
      const contactId = String(user.contactId ?? teacher.contactId ?? "").trim();
      if (contactId) {
        teachers[index] = { ...teacher, contactId };
        contacts = linkTeacherToContact(contacts, user, teachers[index]);
      }
    }
    return { teachers, contacts, skips };
  }
}

module.exports = {
  UserTeacherSyncService,
  isTeacherUserRole,
  isTeachersCode,
  isTeacherTwinCode,
  resolveCanonicalTeachersRow,
  twinOnlyLinked,
  isIdentityRelatedWrite,
  syncError,
};
