/**
 * CONTACT-004 / RB-003 — provisionnement via Contacts uniquement (API).
 */
const { ESTABLISHMENT_BACKOFFICE_ROLES } = require("./establishmentRoles");
const {
  isPlatformUser,
  studentLinkedToContacts,
  teacherLinkedToContacts,
} = require("./contactRegistrySync");

const WEB_CONTACT_USER_ROLES = new Set(
  ["Enseignant", "Parent", "Élève / Étudiant", "Élève", "Étudiant", "Surveillant"].map((role) =>
    normalizeRole(role),
  ),
);

function normalizeRole(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function rowKey(row = {}) {
  return String(row.id ?? row.publicId ?? row.matricule ?? row.code ?? "").trim();
}

function userRequiresContact(user = {}) {
  if (isPlatformUser(user)) return false;
  const role = String(user.role ?? "").trim();
  if (ESTABLISHMENT_BACKOFFICE_ROLES.includes(role)) return false;
  return WEB_CONTACT_USER_ROLES.has(normalizeRole(role));
}

function listNewRows(stateRows = [], payloadRows = []) {
  const currentIds = new Set((stateRows ?? []).map((row) => rowKey(row)).filter(Boolean));
  return (payloadRows ?? []).filter((row) => {
    const key = rowKey(row);
    return key && !currentIds.has(key);
  });
}

function buildEffectiveState(state = {}, payload = {}, touchedKeys = []) {
  const merged = { ...state };
  for (const key of ["teachers", "students", "users", "contacts", "classes", "schools", "evaluations"]) {
    if (touchedKeys.includes(key) && Array.isArray(payload[key])) {
      merged[key] = payload[key];
    }
  }
  return merged;
}

function validateContactProvision(state = {}, payload = {}, touchedKeys = []) {
  const errors = [];
  const effectiveState = buildEffectiveState(state, payload, touchedKeys);
  const contacts = effectiveState.contacts ?? [];

  if (touchedKeys.includes("users")) {
    for (const user of listNewRows(state.users, payload.users)) {
      if (!userRequiresContact(user)) continue;
      const contactId = String(user.contactId ?? "").trim();
      const contactExists = contactId && contacts.some((row) => String(row.id ?? "") === contactId);
      if (!contactExists) {
        errors.push({
          entity: "users",
          id: rowKey(user),
          message:
            "Compte utilisateur métier (enseignant, parent, élève) : créez d'abord un contact avec accès (CONTACT-004).",
        });
      }
    }
  }

  if (touchedKeys.includes("students")) {
    for (const student of listNewRows(state.students, payload.students)) {
      if (studentLinkedToContacts(student, contacts)) continue;
      errors.push({
        entity: "students",
        id: rowKey(student),
        message:
          "Fiche élève : créez ou reliez un contact de type Élève dans Contacts avant d'ajouter la fiche (CONTACT-004).",
      });
    }
  }

  if (touchedKeys.includes("teachers")) {
    for (const teacher of listNewRows(state.teachers, payload.teachers)) {
      if (teacherLinkedToContacts(teacher, contacts)) continue;
      errors.push({
        entity: "teachers",
        id: rowKey(teacher),
        message:
          "Fiche enseignant : créez ou reliez un contact de type Enseignant dans Contacts avant d'ajouter la fiche (CONTACT-004).",
      });
    }
  }

  return errors;
}

module.exports = {
  userRequiresContact,
  listNewRows,
  validateContactProvision,
  buildEffectiveState,
};
