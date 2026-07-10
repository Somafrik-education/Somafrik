/**
 * Synchronisation compte utilisateur (rôle Enseignant) → fiche teachers[].
 */

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isTeacherUserRole(role) {
  const key = normalize(role);
  return key === "enseignant" || key.includes("prof");
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

function buildTeacherFromUser(user, existing) {
  const schoolCode = String(user.schoolCode ?? "").trim();
  const ids = existing?.identifier
    ? { identifier: existing.identifier, publicId: existing.publicId }
    : nextTeacherLoginId(schoolCode, []);

  const resolvedIdentifier = String(user.identifier ?? ids.identifier);
  const resolvedPublicId = String(user.publicId ?? ids.publicId);
  const contactId = String(user.contactId ?? existing?.contactId ?? "").trim();

  return {
    ...(existing ?? {}),
    id: String(existing?.id ?? `TEACHER-${Date.now()}`),
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

class UserTeacherSyncService {
  upsertTeacherFromUser(teachers = [], user) {
    if (!isTeacherUserRole(user?.role)) {
      return teachers;
    }
    const schoolCode = String(user.schoolCode ?? "").trim();
    if (!schoolCode || schoolCode === "*") {
      return teachers;
    }

    const next = [...teachers];
    const index = next.findIndex((teacher) => teacherMatchesUser(teacher, user));
    const row = buildTeacherFromUser(user, index >= 0 ? next[index] : undefined);

    if (index >= 0) {
      next[index] = row;
      return next;
    }

    return [row, ...next];
  }

  syncTeachersFromUserAccounts(state = {}) {
    let teachers = Array.isArray(state.teachers) ? [...state.teachers] : [];
    let contacts = Array.isArray(state.contacts) ? [...state.contacts] : [];
    const users = Array.isArray(state.users) ? state.users : [];
    for (const user of users) {
      if (!isTeacherUserRole(user.role)) continue;
      teachers = this.upsertTeacherFromUser(teachers, user);
      const index = teachers.findIndex((teacher) => teacherMatchesUser(teacher, user));
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

module.exports = { UserTeacherSyncService, isTeacherUserRole };
