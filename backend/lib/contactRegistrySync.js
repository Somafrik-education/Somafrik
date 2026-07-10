/**
 * Synchronise le registre Contacts comme source de vérité :
 * - relie contacts ↔ élèves / enseignants / utilisateurs
 * - supprime les fiches orphelines (sans contact)
 * - nettoie les données dépendantes (notes, présences, etc.)
 */
const { PedagogyGovernanceService } = require("../services/pedagogyGovernanceService");
const { SUPER_ADMIN_ROLES } = require("./establishmentRoles");

const pedagogyGovernanceService = new PedagogyGovernanceService();

const STUDENT_CONTACT_TYPES = new Set(["Élève", "Étudiant"]);
const TEACHER_CONTACT_TYPES = new Set(["Enseignant"]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function rowKey(row = {}) {
  return String(row.id ?? row.publicId ?? row.matricule ?? row.code ?? "").trim();
}

function newRecordId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateTeacherIdentifiers(schoolCode, teachers = []) {
  const year = new Date().getFullYear();
  const compactSchool = String(schoolCode ?? "SCHOOL")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();
  const prefix = `ENS-${compactSchool}-${year}`;
  const used = new Set(
    teachers.map((teacher) => String(teacher.publicId ?? teacher.identifier ?? "").trim()).filter(Boolean),
  );
  let seq = teachers.length + 1;
  let publicId = `${prefix}-${String(seq).padStart(3, "0")}`;
  while (used.has(publicId)) {
    seq += 1;
    publicId = `${prefix}-${String(seq).padStart(3, "0")}`;
  }
  return { publicId, identifier: `teacher${String(seq).padStart(3, "0")}` };
}

function findFicheIndex(rows, contact, contactId, schoolCode) {
  if (contactId) {
    const byContact = rows.findIndex((row) => normalize(row.contactId) === normalize(contactId));
    if (byContact >= 0) return byContact;
  }
  const lastName = normalize(contact.lastName);
  const firstName = normalize(contact.firstName);
  const school = normalize(schoolCode);
  if (!lastName) return -1;
  return rows.findIndex((row) => {
    const rowSchool = normalize(row.schoolCode);
    const sameSchool = !school || !rowSchool || rowSchool === school;
    return (
      sameSchool &&
      normalize(row.name) === lastName &&
      normalize(row.firstName) === firstName
    );
  });
}

function linkContactToOperationalRecord(contact, state) {
  const contactType = String(contact.contactType ?? "").trim();
  const contactId = String(contact.id ?? "").trim();
  const schoolCode = String(contact.schoolCode ?? "").trim();
  if (!contactId || !schoolCode) return { contact, students: null, teachers: null };

  const lastName = String(contact.lastName ?? "").trim();
  const firstName = String(contact.firstName ?? "").trim();

  if (STUDENT_CONTACT_TYPES.has(contactType)) {
    const students = [...(state.students ?? [])];
    const idx = findFicheIndex(students, contact, contactId, schoolCode);
    if (idx >= 0) {
      const existing = students[idx];
      students[idx] = {
        ...existing,
        name: existing.name || lastName,
        firstName: existing.firstName || firstName,
        schoolCode: existing.schoolCode ?? schoolCode,
        gender: existing.gender ?? contact.gender,
        birthDate: existing.birthDate ?? contact.birthDate,
        phone: existing.phone ?? contact.phone,
        email: existing.email ?? contact.email,
        contactId,
      };
      return {
        contact: { ...contact, studentId: String(existing.id ?? "") },
        students,
        teachers: null,
        linkedType: "student",
      };
    }
    const id = newRecordId("STUDENTS");
    const record = {
      id,
      name: lastName,
      firstName,
      className: "",
      schoolCode,
      gender: contact.gender ?? "Non renseigné",
      birthDate: contact.birthDate ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      matricule: id,
      publicId: id,
      archived: false,
      contactId,
    };
    return {
      contact: { ...contact, studentId: id },
      students: [record, ...students],
      teachers: null,
      linkedType: "student",
      created: true,
    };
  }

  if (TEACHER_CONTACT_TYPES.has(contactType)) {
    const teachers = [...(state.teachers ?? [])];
    const idx = findFicheIndex(teachers, contact, contactId, schoolCode);
    if (idx >= 0) {
      const existing = teachers[idx];
      teachers[idx] = {
        ...existing,
        name: existing.name || lastName,
        firstName: existing.firstName || firstName,
        schoolCode: existing.schoolCode ?? schoolCode,
        gender: existing.gender ?? contact.gender,
        birthDate: existing.birthDate ?? contact.birthDate,
        phone: existing.phone ?? contact.phone,
        email: existing.email ?? contact.email,
        contactId,
      };
      return {
        contact: { ...contact, teacherId: String(existing.id ?? "") },
        students: null,
        teachers,
        linkedType: "teacher",
      };
    }
    const id = newRecordId("TEACHERS");
    const identifiers = generateTeacherIdentifiers(schoolCode, teachers);
    const record = {
      id,
      name: lastName,
      firstName,
      schoolCode,
      publicId: identifiers.publicId,
      identifier: identifiers.identifier,
      gender: contact.gender ?? "Non renseigné",
      birthDate: contact.birthDate ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      assignments: [],
      assignedClasses: [],
      contactId,
    };
    return {
      contact: { ...contact, teacherId: id },
      students: null,
      teachers: [record, ...teachers],
      linkedType: "teacher",
      created: true,
    };
  }

  return { contact, students: null, teachers: null };
}

function linkContactToUser(contact, users) {
  const contactId = String(contact.id ?? "").trim();
  const wantsAccess = normalize(contact.hasAccess) === "oui" || Boolean(contact.userId);
  if (!contactId || !wantsAccess) {
    return { contact, users };
  }

  const nextUsers = [...users];
  const idx = nextUsers.findIndex(
    (user) =>
      normalize(user.contactId) === normalize(contactId) ||
      (contact.userId && normalize(user.id) === normalize(contact.userId)),
  );

  if (idx < 0) {
    return { contact, users: nextUsers };
  }

  const existing = nextUsers[idx];
  nextUsers[idx] = {
    ...existing,
    contactId,
    firstName: existing.firstName || contact.firstName,
    lastName: existing.lastName || contact.lastName,
    phone: existing.phone || contact.phone,
    email: existing.email || contact.email,
  };

  return {
    contact: {
      ...contact,
      userId: String(existing.id ?? ""),
      userIdentifier: existing.identifier ?? contact.userIdentifier,
    },
    users: nextUsers,
  };
}

function isPlatformUser(user = {}) {
  const role = String(user.role ?? "").trim();
  const schoolCode = String(user.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") return true;
  if (SUPER_ADMIN_ROLES.includes(role) || role === "Admin Pays") return true;
  return false;
}

function collectStudentKeys(student = {}) {
  return [student.id, student.publicId, student.matricule]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function collectTeacherKeys(teacher = {}) {
  return [teacher.id, teacher.publicId, teacher.identifier]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function collectUserKeys(user = {}) {
  return [user.id, user.publicId, user.identifier]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function studentLinkedToContacts(student, contacts) {
  const studentKeys = new Set(collectStudentKeys(student));
  const contactId = String(student.contactId ?? "").trim();
  if (contactId && contacts.some((contact) => String(contact.id ?? "") === contactId)) {
    return true;
  }
  return contacts.some((contact) => {
    const linkedId = String(contact.studentId ?? "").trim();
    return linkedId && studentKeys.has(linkedId);
  });
}

function teacherLinkedToContacts(teacher, contacts) {
  const teacherKeys = new Set(collectTeacherKeys(teacher));
  const contactId = String(teacher.contactId ?? "").trim();
  if (contactId && contacts.some((contact) => String(contact.id ?? "") === contactId)) {
    return true;
  }
  return contacts.some((contact) => {
    const linkedId = String(contact.teacherId ?? "").trim();
    return linkedId && teacherKeys.has(linkedId);
  });
}

function userLinkedToContacts(user, contacts) {
  if (isPlatformUser(user)) return true;
  const contactId = String(user.contactId ?? "").trim();
  if (contactId && contacts.some((contact) => String(contact.id ?? "") === contactId)) {
    return true;
  }
  const userKeys = new Set(collectUserKeys(user));
  return contacts.some((contact) => {
    const linkedId = String(contact.userId ?? "").trim();
    return linkedId && userKeys.has(linkedId);
  });
}

function filterRowsByStudentKeys(rows = [], keptStudentKeys) {
  return rows.filter((row) => keptStudentKeys.has(String(row.studentId ?? "").trim()));
}

function filterAssignmentsByTeachers(rows = [], keptTeacherKeys) {
  return rows.filter((row) => {
    const teacherId = String(row.teacherId ?? "").trim();
    return !teacherId || keptTeacherKeys.has(teacherId);
  });
}

function mergeRowsByIdentity(primaryRows = [], secondaryRows = []) {
  const rows = new Map();
  [...primaryRows, ...secondaryRows].forEach((row, index) => {
    const key = rowKey(row) || `row-${index}`;
    rows.set(String(key), row);
  });
  return [...rows.values()];
}

/**
 * @param {object} state État BackOffice complet (contacts + entités liées)
 * @returns {{ state: object, report: object }}
 */
function syncContactRegistry(state = {}) {
  const report = {
    contactsLinked: 0,
    fichesCreated: 0,
    usersLinked: 0,
    removed: {
      students: 0,
      teachers: 0,
      users: 0,
      relations: 0,
      notes: 0,
      presences: 0,
      payments: 0,
      bulletins: 0,
      documents: 0,
      assignments: 0,
    },
  };

  let next = {
    ...state,
    contacts: Array.isArray(state.contacts) ? [...state.contacts] : [],
    students: Array.isArray(state.students) ? [...state.students] : [],
    teachers: Array.isArray(state.teachers) ? [...state.teachers] : [],
    users: Array.isArray(state.users) ? [...state.users] : [],
  };

  next.contacts = next.contacts.map((contact) => {
    let current = { ...contact };
    const link = linkContactToOperationalRecord(current, next);
    if (link.students) next.students = link.students;
    if (link.teachers) next.teachers = link.teachers;
    current = link.contact;
    if (link.linkedType) {
      report.contactsLinked += 1;
      if (link.created) report.fichesCreated += 1;
    }

    const userLink = linkContactToUser(current, next.users);
    next.users = userLink.users;
    current = userLink.contact;
    if (normalize(current.userId)) report.usersLinked += 1;

    return current;
  });

  const contacts = next.contacts;
  const beforeStudents = next.students.length;
  const beforeTeachers = next.teachers.length;
  const beforeUsers = next.users.length;

  next.students = next.students.filter((student) => studentLinkedToContacts(student, contacts));
  next.teachers = next.teachers.filter((teacher) => teacherLinkedToContacts(teacher, contacts));
  next.users = next.users.filter((user) => userLinkedToContacts(user, contacts));

  report.removed.students = beforeStudents - next.students.length;
  report.removed.teachers = beforeTeachers - next.teachers.length;
  report.removed.users = beforeUsers - next.users.length;

  const keptStudentKeys = new Set(next.students.flatMap((student) => collectStudentKeys(student)));
  const keptTeacherKeys = new Set(next.teachers.flatMap((teacher) => collectTeacherKeys(teacher)));
  const keptContactIds = new Set(contacts.map((contact) => String(contact.id ?? "").trim()).filter(Boolean));

  const relationsBefore = (next.relations ?? []).length;
  next.relations = (next.relations ?? []).filter((relation) => {
    const fromContactId = String(relation.fromContactId ?? "").trim();
    const toStudentId = String(relation.toStudentId ?? "").trim();
    const fromOk = !fromContactId || keptContactIds.has(fromContactId);
    const toOk = !toStudentId || keptStudentKeys.has(toStudentId);
    return fromOk && toOk;
  });
  report.removed.relations = relationsBefore - next.relations.length;

  const notesBefore = (next.notes ?? []).length;
  next.notes = filterRowsByStudentKeys(next.notes ?? [], keptStudentKeys);
  report.removed.notes = notesBefore - next.notes.length;

  const presencesBefore = (next.presences ?? []).length;
  next.presences = filterRowsByStudentKeys(next.presences ?? [], keptStudentKeys);
  report.removed.presences = presencesBefore - next.presences.length;

  const paymentsBefore = (next.payments ?? []).length;
  next.payments = filterRowsByStudentKeys(next.payments ?? [], keptStudentKeys);
  report.removed.payments = paymentsBefore - next.payments.length;

  const bulletinsBefore = (next.bulletins ?? []).length;
  next.bulletins = filterRowsByStudentKeys(next.bulletins ?? [], keptStudentKeys);
  report.removed.bulletins = bulletinsBefore - next.bulletins.length;

  const documentsBefore = (next.documents ?? []).length;
  next.documents = filterRowsByStudentKeys(next.documents ?? [], keptStudentKeys);
  report.removed.documents = documentsBefore - next.documents.length;

  const assignmentsBefore = (next.assignments ?? []).length;
  next.assignments = filterAssignmentsByTeachers(next.assignments ?? [], keptTeacherKeys);
  report.removed.assignments = assignmentsBefore - next.assignments.length;

  next.courses = pedagogyGovernanceService.dedupeCoursesBySchoolClassSubject(next.courses ?? []);
  next.assignments = pedagogyGovernanceService.dedupeAssignmentsBySchoolClassSubject(next.assignments ?? []);

  next.updatedAt = new Date().toISOString();
  return { state: next, report };
}

module.exports = {
  syncContactRegistry,
  mergeRowsByIdentity,
  linkContactToOperationalRecord,
  linkContactToUser,
  isPlatformUser,
  studentLinkedToContacts,
  teacherLinkedToContacts,
  collectStudentKeys,
  collectTeacherKeys,
  collectUserKeys,
};
