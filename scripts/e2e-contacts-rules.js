/**
 * Règles métier Contacts (alignées sur web/src/lib/contacts.ts et entityModules.ts).
 * Utilisées par les tests E2E API pour reproduire le comportement UI.
 */
const { normalize } = require("./e2e-api-helpers");

const CONTACT_PROVISIONED_ENTITY_KEYS = new Set(["students", "teachers"]);
const STUDENT_CONTACT_TYPES = new Set(["Élève", "Étudiant"]);
const TEACHER_CONTACT_TYPES = new Set(["Enseignant"]);

function entityCreateViaContactsOnly(entityKey) {
  return CONTACT_PROVISIONED_ENTITY_KEYS.has(String(entityKey ?? ""));
}

function prepareContactForSave(form, state = {}) {
  const schoolCode = String(form.schoolCode ?? "").trim();
  const school = (state.schools ?? []).find(
    (row) => normalize(row.code) === normalize(schoolCode),
  );
  return {
    ...form,
    lastName: String(form.lastName ?? "").trim(),
    firstName: String(form.firstName ?? "").trim(),
    contactType: String(form.contactType ?? "").trim(),
    schoolCode,
    accountName: school ? String(school.name ?? school.code ?? schoolCode) : "",
    phone: String(form.phone ?? "").trim(),
    email: String(form.email ?? "").trim(),
    status: String(form.status ?? "Actif").trim() || "Actif",
  };
}

function validateContactDuplicate(item, contacts, editingId) {
  const schoolCode = normalize(String(item.schoolCode ?? ""));
  const phone = normalize(String(item.phone ?? ""));
  const email = normalize(String(item.email ?? ""));
  const lastName = normalize(String(item.lastName ?? ""));
  const firstName = normalize(String(item.firstName ?? ""));
  const birthDate = normalize(String(item.birthDate ?? ""));

  const others = contacts.filter((row) => !editingId || String(row.id) !== editingId);

  for (const row of others) {
    const sameAccount = normalize(String(row.schoolCode ?? "")) === schoolCode;
    const rowPhone = normalize(String(row.phone ?? ""));
    const rowEmail = normalize(String(row.email ?? ""));

    if (phone && rowPhone === phone && sameAccount) {
      return { block: "Un contact avec ce téléphone existe déjà dans ce compte (doublon)." };
    }
    if (email && rowEmail === email && sameAccount) {
      return { block: "Un contact avec cet email existe déjà dans ce compte (doublon)." };
    }
  }

  for (const row of others) {
    const rowPhone = normalize(String(row.phone ?? ""));
    const sameAccount = normalize(String(row.schoolCode ?? "")) === schoolCode;
    if (phone && rowPhone === phone && !sameAccount) {
      return {
        warn: "Ce téléphone est déjà utilisé dans un autre compte. Créer quand même ce contact ?",
      };
    }
  }

  for (const row of others) {
    const sameIdentity =
      lastName &&
      firstName &&
      birthDate &&
      normalize(String(row.lastName ?? "")) === lastName &&
      normalize(String(row.firstName ?? "")) === firstName &&
      normalize(String(row.birthDate ?? "")) === birthDate;
    if (sameIdentity) {
      return {
        warn: "Un contact avec les mêmes nom, prénom et date de naissance existe déjà. Continuer ?",
      };
    }
  }

  return {};
}

function getLinkableContactOptions(state, schoolCode, kind) {
  const types = kind === "student" ? STUDENT_CONTACT_TYPES : TEACHER_CONTACT_TYPES;
  const linkKey = kind === "student" ? "studentId" : "teacherId";
  const ficheRows = kind === "student" ? state.students ?? [] : state.teachers ?? [];
  const linkedContactIds = new Set(
    ficheRows.map((row) => normalize(String(row.contactId ?? ""))).filter(Boolean),
  );
  const school = normalize(schoolCode);

  return (state.contacts ?? []).filter((contact) => {
    if (!contact.id) return false;
    if (!types.has(String(contact.contactType ?? "").trim())) return false;
    const contactSchool = normalize(String(contact.schoolCode ?? ""));
    if (school && school !== "*" && contactSchool && contactSchool !== school) return false;
    if (String(contact[linkKey] ?? "").trim()) return false;
    if (linkedContactIds.has(normalize(String(contact.id ?? "")))) return false;
    return true;
  });
}

function getRelationParentContactOptions(state, schoolCode) {
  const school = normalize(schoolCode);
  return (state.contacts ?? []).filter((contact) => {
    const type = String(contact.contactType ?? "").trim();
    if (STUDENT_CONTACT_TYPES.has(type)) return false;
    const contactSchool = normalize(String(contact.schoolCode ?? ""));
    if (school && school !== "*" && contactSchool && contactSchool !== school) return false;
    return Boolean(contact.id);
  });
}

/** Simule le garde-fou UI EntityPage (création directe interdite). */
function simulateDirectEntityCreateGuard(entityKey, isNewRecord = true) {
  if (!isNewRecord) return { allowed: true };
  if (entityCreateViaContactsOnly(entityKey)) {
    return {
      allowed: false,
      reason:
        "Créez d'abord un contact (type Élève ou Enseignant) dans Contacts pour éviter les doublons.",
    };
  }
  return { allowed: true };
}

function assertContactRequiredFields(contact) {
  if (!contact.lastName || !contact.firstName || !contact.contactType) {
    return "Nom, prénom et type de contact sont obligatoires.";
  }
  if (!contact.schoolCode) {
    return "Le compte lié est obligatoire : un contact ne peut pas être isolé.";
  }
  return null;
}

module.exports = {
  entityCreateViaContactsOnly,
  prepareContactForSave,
  validateContactDuplicate,
  getLinkableContactOptions,
  getRelationParentContactOptions,
  simulateDirectEntityCreateGuard,
  assertContactRequiredFields,
  STUDENT_CONTACT_TYPES,
  TEACHER_CONTACT_TYPES,
};
